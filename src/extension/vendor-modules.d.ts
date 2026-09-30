declare module "harvest-vendor-jxl-encoder" {
  interface EncoderModule {
    encode(data: Uint8ClampedArray, width: number, height: number, options: {
      readonly effort: number;
      readonly quality: number;
      readonly progressive: boolean;
      readonly epf: number;
      readonly lossyPalette: boolean;
      readonly decodingSpeedTier: number;
      readonly photonNoiseIso: number;
      readonly lossyModular: boolean;
      readonly lossless: boolean;
    }): Uint8Array | null;
  }
  const factory: (options: Record<string, unknown>) => Promise<EncoderModule>;
  export default factory;
}

declare module "harvest-vendor-jxl-utils" {
  export function initEmscriptenModule<T>(
    factory: (options: Record<string, unknown>) => Promise<T>,
  ): Promise<T>;
}
