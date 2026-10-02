import { inspectJpegStructure } from "../core/jpeg.js";
import { getImageDimensions } from "../core/image-dimensions.js";
import {
  checkCancelled,
  IMAGE_TOO_LARGE_MESSAGE,
  imageDimensionsError,
  invalidImage,
  ImageDataError,
  MAX_IMAGE_BYTES,
  type FetchedImage,
  type ImageDataOptions,
} from "./image-data-contract.js";
import {
  getImageFetchCredentials,
  getImageFetchTargetAddressSpace,
  ImageFetchTargetError,
  validateImageFetchTarget,
} from "./image-fetch-policy.js";

const DEFAULT_TIMEOUT_MS = 20_000;
type ImageFetchRequestInit = RequestInit & {targetAddressSpace?: "public"};

function timeoutValue(options: ImageDataOptions): number {
  const value = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("timeoutMs must be a positive finite number.");
  }
  return value;
}

function responseError(status: number): ImageDataError {
  if (status === 401 || status === 403) {
    return new ImageDataError("http", "画像へのアクセスが拒否されました。", status);
  }
  if (status === 404 || status === 410) {
    return new ImageDataError("http", "画像が見つかりませんでした。", status);
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new ImageDataError("http", "画像サーバーが応答できませんでした。", status);
  }
  return new ImageDataError("http", "画像を取得できませんでした。", status);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function cancelResponse(response: Response | undefined): Promise<void> {
  try {
    if (response?.body && !response.bodyUsed) await response.body.cancel();
  } catch {
    // A response that has already been closed needs no further cleanup.
  }
}

function contentLength(response: Response): number | undefined {
  const value = response.headers.get("content-length")?.trim();
  if (!value || !/^\d+$/.test(value)) return undefined;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : undefined;
}

/** Read an image response with a hard byte ceiling; the optional limit can only tighten it. */
export async function readImageBytes(response: Response, requestedLimit = MAX_IMAGE_BYTES): Promise<Uint8Array> {
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit <= 0) {
    throw new RangeError("requestedLimit must be a positive safe integer.");
  }
  const limit = Math.min(requestedLimit, MAX_IMAGE_BYTES);
  const declaredLength = contentLength(response);
  if (declaredLength !== undefined && declaredLength > limit) {
    void cancelResponse(response);
    throw invalidImage(IMAGE_TOO_LARGE_MESSAGE);
  }

  const body = response.body;
  if (!body) {
    // Real fetch responses expose a stream. Keep support for body-less test and
    // embedding responses, while still rejecting them once their size is known.
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw invalidImage(IMAGE_TOO_LARGE_MESSAGE);
    return bytes;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (value.byteLength > limit - length) {
        void reader.cancel().catch(() => {});
        throw invalidImage(IMAGE_TOO_LARGE_MESSAGE);
      }
      chunks.push(value);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchImage(url: string, options: ImageDataOptions): Promise<FetchedImage> {
  checkCancelled(options.signal);
  try {
    validateImageFetchTarget(url, options.sourcePage);
  } catch (error) {
    if (error instanceof ImageFetchTargetError) throw invalidImage(error.message);
    throw error;
  }
  const credentials = getImageFetchCredentials(url, options.sourcePage);
  const targetAddressSpace = getImageFetchTargetAddressSpace(url);
  const timeoutMs = timeoutValue(options);
  const controller = new AbortController();
  let response: Response | undefined;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;

  const sourceSignal = options.signal;
  let rejectAbort: ((error: Error) => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  if (sourceSignal?.aborted) controller.abort();
  else if (sourceSignal) {
    const abort = () => {
      controller.abort();
      rejectAbort?.(new ImageDataError("cancelled", "画像の取得を中止しました。"));
    };
    sourceSignal.addEventListener("abort", abort, { once: true });
    removeAbortListener = () => sourceSignal.removeEventListener("abort", abort);
  }

  const operation = (async (): Promise<FetchedImage> => {
    try {
      const fetchOptions: ImageFetchRequestInit = {
        credentials,
        // A credentialed request must not follow a page-controlled redirect
        // into an unrelated origin, where another site's cookies could be sent.
        redirect: credentials === "include" ? "error" : "follow",
        signal: controller.signal,
        ...(targetAddressSpace ? {targetAddressSpace} : {}),
      };
      response = await fetch(url, fetchOptions);
      if (!response.ok) {
        const error = responseError(response.status);
        void cancelResponse(response);
        throw error;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !contentType.toLowerCase().startsWith("image/")) {
        throw invalidImage("画像データではありません。");
      }

      // Keep the response bytes for direct embedding after structural and decoder validation.
      const bytes = await readImageBytes(response);
      const dimensions = getImageDimensions(bytes);
      if (dimensions) {
        const dimensionsError = imageDimensionsError(dimensions.width, dimensions.height);
        if (dimensionsError) throw invalidImage(dimensionsError);
      }
      const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const jpeg = isJpeg ? inspectJpegStructure(bytes) : null;
      if (isJpeg && !jpeg) throw invalidImage("画像を読み込めませんでした。形式が対応していないか、データが壊れています。");
      if (jpeg?.canEmbed) {
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(new Blob([bytes.buffer as ArrayBuffer], {type: "image/jpeg"}));
        } catch {
          checkCancelled(sourceSignal);
          throw invalidImage("画像を読み込めませんでした。形式が対応していないか、データが壊れています。");
        }
        try {
          checkCancelled(controller.signal);
          const dimensionsError = imageDimensionsError(bitmap.width, bitmap.height);
          if (dimensionsError) throw invalidImage(dimensionsError);
          if (bitmap.width !== jpeg.width || bitmap.height !== jpeg.height) throw invalidImage("画像の大きさが不正です。");
        } finally {
          bitmap.close();
        }
        return {kind: "original", page: {jpeg: bytes, width: jpeg.width, height: jpeg.height}};
      }
      // PDF embedding has stricter JPEG requirements than saving a JPEG file.
      // Preserve other JPEGs so JPG export can validate and reuse their bytes.
      const originalJpeg = bytes.byteLength >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
        bytes[bytes.byteLength - 2] === 0xff && bytes[bytes.byteLength - 1] === 0xd9;
      return {
        kind: "bitmap",
        blob: new Blob([bytes.buffer as ArrayBuffer], {type: originalJpeg ? "image/jpeg" : contentType}),
        originalJpeg,
        dimensions,
      };
    } catch (error) {
      void cancelResponse(response);
      if (error instanceof ImageDataError) throw error;
      if (sourceSignal?.aborted) {
        throw new ImageDataError("cancelled", "画像の取得を中止しました。");
      }
      if (controller.signal.aborted || isAbortError(error)) {
        // The timeout promise below wins the race when it caused the abort.
        throw new ImageDataError("timeout", "画像の取得に時間がかかりすぎたため中止しました。");
      }
      throw new ImageDataError("network", "画像を取得できませんでした。通信状態と画像URLを確認してください。");
    }
  })();

  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      void cancelResponse(response);
      reject(new ImageDataError("timeout", "画像の取得に時間がかかりすぎたため中止しました。"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout, cancelled]);
  } catch (error) {
    if (timedOut) {
      throw new ImageDataError("timeout", "画像の取得に時間がかかりすぎたため中止しました。");
    }
    throw error;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    removeAbortListener?.();
    if (timedOut) void cancelResponse(response);
  }
}
