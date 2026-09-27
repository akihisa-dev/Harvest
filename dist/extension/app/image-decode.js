import { checkCancelled, invalidImage, validatePositiveInteger } from "./pdf-image-contract.js";
const DEFAULT_PIXEL_CHUNK_PIXELS = 262_144;
function yieldToEventLoop() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
export async function decodeImage(fetched, options) {
    checkCancelled(options.signal);
    if (fetched.kind === "original")
        return fetched.page;
    let bitmap;
    try {
        bitmap = await createImageBitmap(fetched.blob);
    }
    catch {
        throw invalidImage("画像を読み込めませんでした。形式が対応していないか、データが壊れています。");
    }
    let canvas;
    try {
        checkCancelled(options.signal);
        const width = bitmap.width;
        const height = bitmap.height;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
            throw invalidImage("画像の大きさが不正です。");
        }
        const pixelCount = width * height;
        if (!Number.isSafeInteger(pixelCount) || pixelCount > Number.MAX_SAFE_INTEGER / 3) {
            throw invalidImage("画像が大きすぎてPDF用に変換できませんでした。");
        }
        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        if (canvas.width !== width || canvas.height !== height) {
            throw invalidImage("画像が大きすぎてPDF用に変換できませんでした。");
        }
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context)
            throw invalidImage("画像をPDF用に変換できませんでした。");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0);
        const rgb = new Uint8Array(pixelCount * 3);
        const requestedRows = options.pixelRowsPerChunk;
        if (requestedRows !== undefined)
            validatePositiveInteger(requestedRows, "pixelRowsPerChunk");
        const rowsPerChunk = requestedRows ?? Math.max(1, Math.floor(DEFAULT_PIXEL_CHUNK_PIXELS / width));
        for (let y = 0; y < height; y += rowsPerChunk) {
            checkCancelled(options.signal);
            const rows = Math.min(rowsPerChunk, height - y);
            let pixels;
            try {
                pixels = context.getImageData(0, y, width, rows).data;
            }
            catch {
                throw invalidImage("画像をPDF用に変換できませんでした。");
            }
            const expectedLength = width * rows * 4;
            if (pixels.length < expectedLength) {
                throw invalidImage("画像をPDF用に変換できませんでした。");
            }
            const start = y * width * 3;
            for (let source = 0, target = start; source < expectedLength; source += 4) {
                rgb[target++] = pixels[source] ?? 0;
                rgb[target++] = pixels[source + 1] ?? 0;
                rgb[target++] = pixels[source + 2] ?? 0;
            }
            if (y + rows < height)
                await yieldToEventLoop();
        }
        try {
            const stream = new Blob([rgb.buffer]).stream().pipeThrough(new CompressionStream("deflate"));
            const rgbFlate = new Uint8Array(await new Response(stream).arrayBuffer());
            return { rgbFlate, width, height };
        }
        catch {
            throw invalidImage("画像をPDF用に変換できませんでした。");
        }
    }
    finally {
        bitmap.close();
        // Release the browser's backing store as soon as the compressed page exists.
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
}
