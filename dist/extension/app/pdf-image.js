import { getOriginalJpegPage } from "../core/pdf.js";
export async function toPdfPage(imageUrl, highQuality) {
    const response = await fetch(imageUrl, { credentials: "include" });
    if (!response.ok)
        throw new Error(`画像の取得に失敗しました (${response.status})`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/"))
        throw new Error("画像以外のデータです。");
    if (highQuality) {
        const original = getOriginalJpegPage(new Uint8Array(await blob.arrayBuffer()));
        if (original)
            return original;
    }
    const bitmap = await createImageBitmap(blob);
    try {
        if (bitmap.width < 1 || bitmap.height < 1)
            throw new Error("画像の大きさが不正です。");
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context)
            throw new Error("画像を変換できませんでした。");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0);
        if (highQuality) {
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const rgb = new Uint8Array(bitmap.width * bitmap.height * 3);
            for (let source = 0, target = 0; source < pixels.length; source += 4) {
                rgb[target++] = pixels[source];
                rgb[target++] = pixels[source + 1];
                rgb[target++] = pixels[source + 2];
            }
            const stream = new Blob([rgb.buffer]).stream().pipeThrough(new CompressionStream("deflate"));
            const rgbFlate = new Uint8Array(await new Response(stream).arrayBuffer());
            return { rgbFlate, width: bitmap.width, height: bitmap.height };
        }
        const jpeg = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error("画像を変換できませんでした。")), "image/jpeg", 0.72));
        return { jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: bitmap.width, height: bitmap.height };
    }
    finally {
        bitmap.close();
    }
}
