/** Runs only inside the isolated worker. */
export async function encodeJxlPixels(image) {
    const codec = await import("./vendor/jxl/encode.js");
    return codec.default(image, { lossless: true });
}
