import { checkCancelled } from "../contracts/image-data-contract.js";
import { validateFetchedDimensions, withDecodedImage } from "./decoded-image.js";
import { encodeJxl } from "./jxl-encoder.js";
import { isMediaArchiveFormat } from "../../core/export-formats.js";
export class ImageFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = "ImageFormatError";
    }
}
const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
async function isPng(blob, signal) {
    checkCancelled(signal);
    if (blob.size < pngSignature.length)
        return false;
    const bytes = new Uint8Array(await blob.slice(0, pngSignature.length).arrayBuffer());
    checkCancelled(signal);
    return pngSignature.every((value, index) => bytes[index] === value);
}
function withFormatImage(blob, signal, consume) {
    return withDecodedImage(blob, {
        signal,
        invalidDimensions: message => new ImageFormatError(message),
        decodeFailure() {
            checkCancelled(signal);
            return new ImageFormatError("画像を読み込めませんでした。形式が対応していないか、データが壊れています。");
        },
    }, consume);
}
async function isDecodablePng(blob, signal) {
    return await isPng(blob, signal) && await withFormatImage(blob, signal, () => true);
}
function fetchedBlob(fetched) {
    return fetched.kind === "original"
        ? new Blob([fetched.page.jpeg.buffer], { type: "image/jpeg" })
        : fetched.blob;
}
function toBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new ImageFormatError("画像を変換できませんでした。")), type, quality);
    });
}
/** Convert one fetched image, releasing its decoded pixels before returning. */
export async function convertImage(fetched, format, signal) {
    checkCancelled(signal);
    if (isMediaArchiveFormat(format))
        return fetchedBlob(fetched);
    await validateFetchedDimensions(fetched, signal, message => new ImageFormatError(message));
    if (fetched.kind === "original" && format === "jpg")
        return fetchedBlob(fetched);
    if (format === "jpg" && fetched.kind === "bitmap" && fetched.originalJpeg) {
        await withFormatImage(fetched.blob, signal, () => { });
        return fetched.blob;
    }
    if (format === "png" && fetched.kind === "bitmap" && await isDecodablePng(fetched.blob, signal))
        return fetched.blob;
    return withFormatImage(fetchedBlob(fetched), signal, async (image) => {
        const { width, height } = image;
        const { canvas, context } = image.canvas({
            context: { alpha: format !== "jpg", willReadFrequently: format === "jxl" },
            opaque: format === "jpg",
            invalidSize: () => new ImageFormatError("画像が大きすぎて変換できませんでした。"),
            unavailable: () => new ImageFormatError("画像を変換できませんでした。"),
        });
        checkCancelled(signal);
        if (format === "jpg")
            return await toBlob(canvas, "image/jpeg", 1);
        if (format === "png")
            return await toBlob(canvas, "image/png");
        const pixels = context.getImageData(0, 0, width, height);
        checkCancelled(signal);
        try {
            const encoded = await encodeJxl(pixels, signal);
            checkCancelled(signal);
            return new Blob([encoded], { type: "image/jxl" });
        }
        catch {
            checkCancelled(signal);
            throw new ImageFormatError("JXLに変換できませんでした。");
        }
    });
}
