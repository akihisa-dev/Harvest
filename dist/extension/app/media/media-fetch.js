import { validateOriginalMedia } from "./original-media-validation.js";
import { mediaTypeMatchesKind, normalizeMediaMimeType, originalMediaType } from "../../core/media-types.js";
import { checkCancelled, ImageDataError, invalidImage, MAX_IMAGE_BYTES } from "../contracts/image-data-contract.js";
import { readImageBytes } from "./image-response-bytes.js";
import { fetchResponse } from "./response-fetch.js";
const DEFAULT_MEDIA_TIMEOUT_MS = 120_000;
/** Return a safe file extension for a MIME type that this exporter recognizes. */
export function originalMediaExtension(mimeType) {
    const mediaType = originalMediaType(mimeType);
    if (!mediaType)
        throw invalidImage("保存できる形式のデータではありません。");
    return mediaType.extension;
}
function responseError(status) {
    if (status === 401 || status === 403) {
        return new ImageDataError("http", "メディアへのアクセスが拒否されました。", status);
    }
    if (status === 404 || status === 410) {
        return new ImageDataError("http", "メディアが見つかりませんでした。", status);
    }
    if (status === 408 || status === 429 || status >= 500) {
        return new ImageDataError("http", "メディアサーバーが応答できませんでした。", status);
    }
    return new ImageDataError("http", "メディアを取得できませんでした。", status);
}
const mediaFetchErrors = {
    http: responseError,
    cancelled: () => new ImageDataError("cancelled", "メディアの取得を中止しました。"),
    timeout: () => new ImageDataError("timeout", "メディアの取得がタイムアウトしました。"),
    failure(error, { signal, sourceSignal }) {
        if (sourceSignal?.aborted)
            return this.cancelled();
        if (signal.aborted)
            return this.timeout();
        if (error instanceof ImageDataError)
            return error;
        if (error instanceof DOMException && error.name === "AbortError")
            return this.timeout();
        return new ImageDataError("network", "メディアを取得できませんでした。");
    },
};
/** Fetch original image/video bytes with the existing credential, target, and byte-limit policies. */
export async function fetchOriginalMedia(url, kind = "image", options = {}) {
    return fetchResponse(url, { ...options, timeoutMs: options.timeoutMs ?? DEFAULT_MEDIA_TIMEOUT_MS }, mediaFetchErrors, async (response, { sourceSignal, signal }) => {
        const contentType = response.headers.get("content-type") ?? "";
        const normalizedType = normalizeMediaMimeType(contentType);
        const mediaType = originalMediaType(normalizedType);
        if (!mediaType || !mediaTypeMatchesKind(kind, mediaType.kind)) {
            throw invalidImage("メディアの形式を確認できませんでした。");
        }
        const bytes = await readImageBytes(response, MAX_IMAGE_BYTES);
        checkCancelled(sourceSignal);
        if (!mediaType.matches(bytes))
            throw invalidImage("メディアの種類とデータが一致しません。");
        const blob = new Blob([bytes.buffer], { type: normalizedType });
        await validateOriginalMedia(blob, signal);
        return blob;
    });
}
