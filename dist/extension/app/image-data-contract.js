import { getImageDimensions } from "../core/image-dimensions.js";
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 16_384;
export const MAX_IMAGE_PIXELS = 64_000_000;
export const IMAGE_TOO_LARGE_MESSAGE = "画像が大きすぎるため、処理できません。";
/** A user-safe failure shared by image retrieval, decoding, and format conversion. */
export class ImageDataError extends Error {
    kind;
    status;
    constructor(kind, message, status) {
        super(message);
        this.name = "ImageDataError";
        this.kind = kind;
        if (status !== undefined)
            this.status = status;
    }
}
export function invalidImage(message) {
    return new ImageDataError("invalid-image", message);
}
/** Return the shared user-facing error for dimensions that cannot be processed safely. */
export function imageDimensionsError(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
        return "画像の大きさが不正です。";
    }
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
        return IMAGE_TOO_LARGE_MESSAGE;
    }
    return null;
}
/** Return already-inspected response dimensions, or inspect an untrusted Blob before decoding it. */
export async function fetchedImageDimensions(fetched) {
    if (fetched.kind === "original")
        return { width: fetched.page.width, height: fetched.page.height };
    if (fetched.dimensions !== undefined)
        return fetched.dimensions;
    return getImageDimensions(new Uint8Array(await fetched.blob.arrayBuffer()));
}
export function validatePositiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new RangeError(`${name} must be a positive safe integer.`);
    return value;
}
export function checkCancelled(signal) {
    if (signal?.aborted)
        throw new ImageDataError("cancelled", "画像の取得を中止しました。");
}
