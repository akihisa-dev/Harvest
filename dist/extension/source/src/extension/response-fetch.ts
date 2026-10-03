import {checkCancelled, invalidImage} from "./image-data-contract.js";
import {getImageFetchCredentials, getImageFetchTargetAddressSpace, ImageFetchTargetError, validateImageFetchTarget} from "./image-fetch-policy.js";

export interface ResponseFetchState {
  readonly signal: AbortSignal;
  readonly sourceSignal: AbortSignal | undefined;
}

export interface ResponseFetchErrors {
  http(status: number): Error;
  cancelled(): Error;
  timeout(): Error;
  failure(error: unknown, state: ResponseFetchState): unknown;
  settledFailure?(error: unknown, timedOut: boolean): unknown;
}

export async function cancelResponse(response: Response | undefined): Promise<void> {
  try {
    if (response?.body && !response.bodyUsed) await response.body.cancel();
  } catch {
    // Consumed, locked, and already-closed bodies need no additional cleanup here.
  }
}

/** Owns the request and response lifetime, including consumption under the same deadline. */
export async function fetchResponse<T>(
  url: string,
  options: {readonly timeoutMs: number; readonly method?: "HEAD"; readonly signal?: AbortSignal; readonly sourcePage?: string},
  errors: ResponseFetchErrors,
  consume: (response: Response, state: ResponseFetchState) => Promise<T>,
): Promise<T> {
  checkCancelled(options.signal);
  try {
    validateImageFetchTarget(url, options.sourcePage);
  } catch (error) {
    if (error instanceof ImageFetchTargetError) throw invalidImage(error.message);
    throw error;
  }
  const credentials = getImageFetchCredentials(url, options.sourcePage);
  const targetAddressSpace = getImageFetchTargetAddressSpace(url);
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new RangeError("timeoutMs must be a positive finite number.");
  const controller = new AbortController();
  const state = {signal: controller.signal, sourceSignal: options.signal};
  let response: Response | undefined;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let rejectCancellation!: (error: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  const abort = (): void => {
    controller.abort();
    rejectCancellation(errors.cancelled());
  };
  options.signal?.addEventListener("abort", abort, {once: true});
  if (options.signal?.aborted) abort();
  const operation = (async (): Promise<T> => {
    try {
      const request: RequestInit & {targetAddressSpace?: "public"} = {
        credentials,
        ...(options.method ? {method: options.method} : {}),
        // Page credentials may never follow a redirect to an unrelated origin.
        redirect: credentials === "include" ? "error" : "follow",
        signal: controller.signal,
        ...(targetAddressSpace ? {targetAddressSpace} : {}),
      };
      response = await fetch(url, request);
      if (!response.ok) throw errors.http(response.status);
      return await consume(response, state);
    } catch (error) {
      throw errors.failure(error, state);
    } finally {
      void cancelResponse(response);
    }
  })();
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      void cancelResponse(response);
      reject(errors.timeout());
    }, options.timeoutMs);
  });
  try {
    return await Promise.race([operation, cancelled, timeout]);
  } catch (error) {
    throw errors.settledFailure ? errors.settledFailure(error, timedOut) : error;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    options.signal?.removeEventListener("abort", abort);
    void cancelResponse(response);
  }
}
