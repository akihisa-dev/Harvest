import { checkCancelled } from "./pdf-image-contract.js";
import { encodeJxl } from "./jxl-encoder.js";
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
async function isDecodablePng(blob, signal) {
    if (!await isPng(blob, signal))
        return false;
    let bitmap;
    try {
        bitmap = await createImageBitmap(blob);
    }
    catch {
        checkCancelled(signal);
        throw new ImageFormatError("画像を読み込めませんでした。形式が対応していないか、データが壊れています。");
    }
    try {
        checkCancelled(signal);
        return true;
    }
    finally {
        bitmap.close();
    }
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
    if (format === "jpg" && fetched.kind === "original")
        return fetchedBlob(fetched);
    if (format === "png" && fetched.kind === "bitmap" && await isDecodablePng(fetched.blob, signal))
        return fetched.blob;
    const source = fetchedBlob(fetched);
    let bitmap;
    try {
        bitmap = await createImageBitmap(source);
    }
    catch {
        checkCancelled(signal);
        throw new ImageFormatError("画像を読み込めませんでした。形式が対応していないか、データが壊れています。");
    }
    let canvas;
    try {
        checkCancelled(signal);
        const { width, height } = bitmap;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
            throw new ImageFormatError("画像の大きさが不正です。");
        }
        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        if (canvas.width !== width || canvas.height !== height) {
            throw new ImageFormatError("画像が大きすぎて変換できませんでした。");
        }
        const context = canvas.getContext("2d", { alpha: format !== "jpg", willReadFrequently: format === "jxl" });
        if (!context)
            throw new ImageFormatError("画像を変換できませんでした。");
        if (format === "jpg") {
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, width, height);
        }
        context.drawImage(bitmap, 0, 0);
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
    }
    finally {
        bitmap.close();
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
}
