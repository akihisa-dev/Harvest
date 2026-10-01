import { checkCancelled, ImageDataError, invalidImage, MAX_IMAGE_BYTES } from "./image-data-contract.js";
import { readImageBytes } from "./image-fetch.js";
import { getImageFetchCredentials, getImageFetchTargetAddressSpace, ImageFetchTargetError, validateImageFetchTarget, } from "./image-fetch-policy.js";
const DEFAULT_MEDIA_TIMEOUT_MS = 120_000;
function ascii(bytes, start, end) {
    return String.fromCharCode(...bytes.subarray(start, end));
}
function uint32be(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}
function hasPrefix(bytes, signature) {
    return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}
function ftypBrands(bytes) {
    if (bytes.length < 16 || ascii(bytes, 4, 8) !== "ftyp")
        return [];
    const size32 = uint32be(bytes, 0);
    let boxSize = size32;
    let majorBrandOffset = 8;
    let compatibleBrandsOffset = 16;
    if (size32 === 1) {
        if (bytes.length < 24 || uint32be(bytes, 8) !== 0)
            return [];
        boxSize = uint32be(bytes, 12);
        majorBrandOffset = 16;
        compatibleBrandsOffset = 24;
    }
    if (boxSize < compatibleBrandsOffset || boxSize > bytes.length || (boxSize - compatibleBrandsOffset) % 4 !== 0)
        return [];
    const brands = [ascii(bytes, majorBrandOffset, majorBrandOffset + 4)];
    // The ftyp box should be small. Bound inspection even if its declared size is hostile.
    const inspectionEnd = Math.min(boxSize, 4 * 1024);
    for (let index = compatibleBrandsOffset; index + 4 <= inspectionEnd; index += 4) {
        brands.push(ascii(bytes, index, index + 4));
    }
    return brands;
}
function hasAnyFtypBrand(bytes, accepted) {
    const brands = ftypBrands(bytes);
    return brands.length > 0 && brands.some(brand => accepted.includes(brand));
}
const mediaTypes = {
    "image/jpeg": { extension: "jpg", kind: "image", matches: bytes => hasPrefix(bytes, [0xff, 0xd8, 0xff]) },
    "image/png": { extension: "png", kind: "image", matches: bytes => hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    "image/gif": { extension: "gif", kind: "gif", matches: bytes => ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a" },
    "image/webp": { extension: "webp", kind: "image", matches: bytes => bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP" },
    "image/jxl": { extension: "jxl", kind: "image", matches: bytes => hasPrefix(bytes, [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]) || hasPrefix(bytes, [0xff, 0x0a]) },
    "image/avif": { extension: "avif", kind: "image", matches: bytes => hasAnyFtypBrand(bytes, ["avif", "avis"]) },
    "image/heic": { extension: "heic", kind: "image", matches: bytes => hasAnyFtypBrand(bytes, ["heic", "heix", "hevc", "hevx", "mif1", "msf1"]) },
    "image/heif": { extension: "heif", kind: "image", matches: bytes => hasAnyFtypBrand(bytes, ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"]) },
    "image/bmp": { extension: "bmp", kind: "image", matches: bytes => hasPrefix(bytes, [0x42, 0x4d]) },
    "image/tiff": { extension: "tif", kind: "image", matches: bytes => hasPrefix(bytes, [0x49, 0x49, 0x2a, 0x00]) || hasPrefix(bytes, [0x4d, 0x4d, 0x00, 0x2a]) },
    "video/mp4": { extension: "mp4", kind: "video", matches: bytes => hasAnyFtypBrand(bytes, ["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "mp71", "avc1", "M4V ", "M4VP", "MSNV", "dash", "3gp4", "3gp5", "3gp6", "3g2a", "F4V "]) },
    "video/webm": { extension: "webm", kind: "video", matches: bytes => hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3]) },
};
/** Return a safe file extension for a MIME type that this exporter recognizes. */
export function originalMediaExtension(mimeType) {
    const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const mediaType = mediaTypes[normalized];
    if (!mediaType)
        throw invalidImage("保存できる形式のデータではありません。");
    return mediaType.extension;
}
function allowedForKind(kind, mediaKind) {
    if (kind === "video")
        return mediaKind === "video";
    if (kind === "gif")
        return mediaKind === "gif";
    return mediaKind === "image" || mediaKind === "gif";
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
function validateTimeout(timeoutMs) {
    const timeout = timeoutMs ?? DEFAULT_MEDIA_TIMEOUT_MS;
    if (!Number.isFinite(timeout) || timeout <= 0)
        throw new RangeError("timeoutMs must be a positive finite number.");
    return timeout;
}
/** Fetch original image/video bytes with the existing credential, target, and byte-limit policies. */
export async function fetchOriginalMedia(url, kind = "image", options = {}) {
    checkCancelled(options.signal);
    try {
        validateImageFetchTarget(url, options.sourcePage);
    }
    catch (error) {
        if (error instanceof ImageFetchTargetError)
            throw invalidImage(error.message);
        throw error;
    }
    const credentials = getImageFetchCredentials(url, options.sourcePage);
    const targetAddressSpace = getImageFetchTargetAddressSpace(url);
    const timeoutMs = validateTimeout(options.timeoutMs);
    const controller = new AbortController();
    const sourceSignal = options.signal;
    let removeAbortListener;
    let timeoutHandle;
    let response;
    let rejectCancellation;
    const cancelled = new Promise((_, reject) => { rejectCancellation = reject; });
    if (sourceSignal) {
        const abort = () => {
            controller.abort();
            rejectCancellation?.(new ImageDataError("cancelled", "メディアの取得を中止しました。"));
        };
        sourceSignal.addEventListener("abort", abort, { once: true });
        removeAbortListener = () => sourceSignal.removeEventListener("abort", abort);
        if (sourceSignal.aborted)
            abort();
    }
    const operation = (async () => {
        try {
            const fetchOptions = {
                credentials,
                // Never send a page's cookies to a different origin after a redirect.
                redirect: credentials === "include" ? "error" : "follow",
                signal: controller.signal,
                ...(targetAddressSpace ? { targetAddressSpace } : {}),
            };
            response = await fetch(url, fetchOptions);
            if (!response.ok) {
                void response.body?.cancel().catch(() => { });
                throw responseError(response.status);
            }
            const contentType = response.headers.get("content-type") ?? "";
            const normalizedType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
            const mediaType = mediaTypes[normalizedType];
            if (!mediaType || !allowedForKind(kind, mediaType.kind)) {
                void response.body?.cancel().catch(() => { });
                throw invalidImage("メディアの形式を確認できませんでした。");
            }
            const bytes = await readImageBytes(response, MAX_IMAGE_BYTES);
            checkCancelled(sourceSignal);
            if (!mediaType.matches(bytes))
                throw invalidImage("メディアの種類とデータが一致しません。");
            return new Blob([bytes.buffer], { type: normalizedType });
        }
        catch (error) {
            if (sourceSignal?.aborted)
                throw new ImageDataError("cancelled", "メディアの取得を中止しました。");
            if (controller.signal.aborted)
                throw new ImageDataError("timeout", "メディアの取得がタイムアウトしました。");
            if (error instanceof ImageDataError)
                throw error;
            if (error instanceof DOMException && error.name === "AbortError") {
                throw new ImageDataError("timeout", "メディアの取得がタイムアウトしました。");
            }
            throw new ImageDataError("network", "メディアを取得できませんでした。");
        }
    })();
    const timedOut = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            controller.abort();
            reject(new ImageDataError("timeout", "メディアの取得がタイムアウトしました。"));
        }, timeoutMs);
    });
    try {
        return await Promise.race([operation, cancelled, timedOut]);
    }
    finally {
        if (timeoutHandle !== undefined)
            clearTimeout(timeoutHandle);
        removeAbortListener?.();
        if (response?.body && !response.bodyUsed)
            void response.body.cancel().catch(() => { });
    }
}
