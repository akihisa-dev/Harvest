import { inspectJpegStructure } from "../core/jpeg.js";
import { getImageDimensions } from "../core/image-dimensions.js";
import {checkCancelled, imageDimensionsError, invalidImage, ImageDataError, type FetchedImage, type ImageDataOptions} from "./image-data-contract.js";
import {fetchResponse, type ResponseFetchErrors} from "./response-fetch.js";
import {readImageBytes} from "./image-response-bytes.js";

export {readImageBytes} from "./image-response-bytes.js";

const DEFAULT_TIMEOUT_MS = 20_000;

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

const imageFetchErrors: ResponseFetchErrors = {
  http: responseError,
  cancelled: () => new ImageDataError("cancelled", "画像の取得を中止しました。"),
  timeout: () => new ImageDataError("timeout", "画像の取得に時間がかかりすぎたため中止しました。"),
  failure(error, {signal, sourceSignal}) {
    if (error instanceof ImageDataError) return error;
    if (sourceSignal?.aborted) return this.cancelled();
    if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return this.timeout();
    return new ImageDataError("network", "画像を取得できませんでした。通信状態と画像URLを確認してください。");
  },
  settledFailure(error, timedOut) { return timedOut ? this.timeout() : error; },
};

export async function fetchImage(url: string, options: ImageDataOptions): Promise<FetchedImage> {
  return fetchResponse(url, {...options, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS}, imageFetchErrors, async (response, {signal, sourceSignal}): Promise<FetchedImage> => {
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
        checkCancelled(signal);
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
  });
}
