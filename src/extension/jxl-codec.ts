interface JxlEncoderModule {
  encode(data: Uint8ClampedArray, width: number, height: number, options: JxlEncodeOptions): Uint8Array | null;
}

interface JxlEncodeOptions {
  readonly effort: number;
  readonly quality: number;
  readonly progressive: boolean;
  readonly epf: number;
  readonly lossyPalette: boolean;
  readonly decodingSpeedTier: number;
  readonly photonNoiseIso: number;
  readonly lossyModular: boolean;
  readonly lossless: boolean;
}

const losslessOptions: JxlEncodeOptions = {
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

let encoder: Promise<JxlEncoderModule> | undefined;

/** Runs only inside the isolated worker and always initializes the single-thread WASM encoder. */
export async function encodeJxlPixels(image: ImageData): Promise<ArrayBuffer> {
  encoder ??= (async () => {
    const [factory, {initEmscriptenModule}] = await Promise.all([
      import("harvest-vendor-jxl-encoder"),
      import("harvest-vendor-jxl-utils"),
    ]);
    return initEmscriptenModule(factory.default);
  })();
  const module = await encoder;
  const result = module.encode(image.data, image.width, image.height, losslessOptions);
  if (!result) throw new Error("Encoding error.");
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer;
}
