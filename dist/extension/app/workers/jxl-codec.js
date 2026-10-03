const losslessOptions = {
    effort: 7,
    quality: 100,
    progressive: false,
    epf: -1,
    lossyPalette: false,
    decodingSpeedTier: 0,
    photonNoiseIso: 0,
    lossyModular: false,
    lossless: true,
};
let encoder;
/** Runs only inside the isolated worker and always initializes the single-thread WASM encoder. */
export async function encodeJxlPixels(image) {
    encoder ??= (async () => {
        const [factory, { initEmscriptenModule }] = await Promise.all([
            import("../vendor/jxl/codec/enc/jxl_enc.js"),
            import("../vendor/jxl/utils.js"),
        ]);
        return initEmscriptenModule(factory.default);
    })();
    const module = await encoder;
    const result = module.encode(image.data, image.width, image.height, losslessOptions);
    if (!result)
        throw new Error("Encoding error.");
    return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}
