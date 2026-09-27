/** A user-safe reason for an image that could not be included in the PDF. */
export class PdfImageError extends Error {
    kind;
    status;
    constructor(kind, message, status) {
        super(message);
        this.name = "PdfImageError";
        this.kind = kind;
        if (status !== undefined)
            this.status = status;
    }
}
export function invalidImage(message) {
    return new PdfImageError("invalid-image", message);
}
export function validatePositiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer.`);
    }
    return value;
}
export function checkCancelled(signal) {
    if (signal?.aborted)
        throw new PdfImageError("cancelled", "画像の取得を中止しました。");
}
