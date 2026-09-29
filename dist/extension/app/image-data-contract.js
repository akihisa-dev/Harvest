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
export function validatePositiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new RangeError(`${name} must be a positive safe integer.`);
    return value;
}
export function checkCancelled(signal) {
    if (signal?.aborted)
        throw new ImageDataError("cancelled", "画像の取得を中止しました。");
}
