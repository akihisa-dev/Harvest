import type { PdfImagePage } from "../core/pdf-types.js";
import { fetchImage } from "./image-fetch.js";
import { decodeImage } from "./image-decode.js";
import { checkCancelled, invalidImage, validatePositiveInteger, PdfImageError, type FetchedImage, type PdfImageOptions, type PdfImagePreparationOptions, type PdfImagePreparationResult } from "./pdf-image-contract.js";

export { PdfImageError } from "./pdf-image-contract.js";
export type { PdfImageErrorKind, PdfImageOptions, PdfImagePreparationOptions, PdfImagePreparationResult } from "./pdf-image-contract.js";

const DEFAULT_FETCH_CONCURRENCY = 3;

/**
 * Fetches and converts one image. Existing callers can continue using this
 * helper; options are optional so the old API remains source compatible.
 */
export async function toPdfPage(imageUrl: string, options: PdfImageOptions = {}): Promise<PdfImagePage> {
  const fetched = await fetchImage(imageUrl, options);
  try {
    return await decodeImage(fetched, options);
  } catch (error) {
    if (error instanceof PdfImageError) throw error;
    throw invalidImage("画像をPDF用に変換できませんでした。");
  }
}

class BoundedQueue<T> {
  private readonly values: T[] = [];
  private readonly readers: Array<(value: T | null) => void> = [];
  private readonly writers: Array<{ value: T; resolve: () => void; reject: (error: unknown) => void }> = [];
  private closed = false;
  private closeError: unknown;

  constructor(private readonly capacity: number) {}

  async push(value: T): Promise<void> {
    if (this.closed) throw this.closeError ?? new Error("queue closed");
    const reader = this.readers.shift();
    if (reader) {
      reader(value);
      return;
    }
    if (this.values.length < this.capacity) {
      this.values.push(value);
      return;
    }
    await new Promise<void>((resolve, reject) => this.writers.push({ value, resolve, reject }));
  }

  async pop(): Promise<T | null> {
    const value = this.values.shift();
    if (value !== undefined) {
      this.releaseWriter();
      return value;
    }
    const writer = this.writers.shift();
    if (writer) {
      writer.resolve();
      return writer.value;
    }
    if (this.closed) return null;
    return new Promise<T | null>((resolve) => this.readers.push(resolve));
  }

  close(error?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.closeError = error;
    while (this.readers.length) this.readers.shift()!(null);
    while (this.writers.length) this.writers.shift()!.reject(error ?? new Error("queue closed"));
  }

  private releaseWriter(): void {
    const writer = this.writers.shift();
    if (!writer) return;
    const reader = this.readers.shift();
    if (reader) reader(writer.value);
    else this.values.push(writer.value);
    writer.resolve();
  }
}

/**
 * Prepares images with a small network concurrency limit and one pixel
 * conversion at a time. Results are delivered in input order, so callers can
 * retain successful pages and retry only the items reported as errors.
 */
export async function preparePdfImages<T extends { readonly url: string }>(
  items: readonly T[],
  onResult: (item: T, result: PdfImagePreparationResult) => void,
  options: PdfImagePreparationOptions = {},
): Promise<void> {
  const requestedConcurrency = options.fetchConcurrency ?? DEFAULT_FETCH_CONCURRENCY;
  validatePositiveInteger(requestedConcurrency, "fetchConcurrency");
  if (items.length === 0) return;

  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", abort, {once: true});
  const operationOptions = {...options, signal: controller.signal};
  const queue = new BoundedQueue<FetchedImage & { readonly index: number }>(1);
  const results: Array<PdfImagePreparationResult | undefined> = new Array(items.length);
  let nextIndex = 0;
  let nextResult = 0;
  let workersFinished = 0;
  const workerCount = Math.min(requestedConcurrency, items.length);
  let callbackError: unknown;

  const setResult = (index: number, result: PdfImagePreparationResult): void => {
    if (callbackError !== undefined) throw callbackError;
    results[index] = result;
    while (nextResult < items.length) {
      const current = results[nextResult];
      if (current === undefined) break;
      results[nextResult] = undefined;
      try {
        onResult(items[nextResult]!, current);
      } catch (error) {
        callbackError = error;
        controller.abort();
        queue.close(error);
        throw error;
      }
      nextResult += 1;
    }
  };

  const worker = async (): Promise<void> => {
    try {
      while (true) {
        checkCancelled(controller.signal);
        const index = nextIndex++;
        if (index >= items.length) return;
        const item = items[index]!;
        let fetched: FetchedImage;
        try {
          fetched = await fetchImage(item.url, operationOptions);
        } catch (error) {
          setResult(index, error instanceof PdfImageError ? error : new PdfImageError("network", "画像を取得できませんでした。通信状態と画像URLを確認してください。"));
          continue;
        }
        if (fetched.kind === "original") {
          setResult(index, fetched.page);
          continue;
        }
        await queue.push({ ...fetched, index });
      }
    } finally {
      workersFinished += 1;
      if (workersFinished === workerCount) queue.close();
    }
  };

  const workers = Array.from({ length: workerCount }, () => worker());
  const converter = (async (): Promise<void> => {
    while (true) {
      const queued = await queue.pop();
      if (queued === null) return;
      let result: PdfImagePreparationResult;
      try {
        result = await decodeImage(queued, operationOptions);
      } catch (error) {
        result = error instanceof PdfImageError ? error : invalidImage("画像をPDF用に変換できませんでした。");
      }
      setResult(queued.index, result);
    }
  })();

  const outcomes = await Promise.allSettled([...workers, converter]);
  options.signal?.removeEventListener("abort", abort);
  if (callbackError !== undefined) throw callbackError;
  checkCancelled(controller.signal);
  const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  if (rejected) throw rejected.reason;
}
