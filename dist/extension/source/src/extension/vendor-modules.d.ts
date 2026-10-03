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

// Narrow adapter for the pinned browser bundle. Its upstream global WebCodecs
// declarations conflict with TypeScript's DOM library; keep them out of the app.
declare module "harvest-vendor-mediabunny" {
  export const WEBM: object;
  export const MP4: object;
  export class EncodedPacketSink {
    constructor(track: object);
    packets(start?: object, end?: object, options?: {metadataOnly: boolean}): AsyncGenerator<{byteLength: number}, void, unknown>;
    getFirstPacket(): Promise<{data: Uint8Array} | null>;
    getNextPacket(previous: object): Promise<{data: Uint8Array} | null>;
  }
  export const QUALITY_HIGH: object;
  export class BlobSource { constructor(blob: Blob); }
  export class Input {
    constructor(options: {formats: object[]; source: BlobSource});
    getPrimaryVideoTrack(): Promise<object | null>;
    getTracks(): Promise<object[]>;
    dispose(): void;
  }
  export class BufferTarget {
    buffer: ArrayBuffer | null;
    on(event: "write", listener: (range: {start: number; end: number}) => void): () => void;
  }
  export class Mp4OutputFormat {}
  export class Output {
    constructor(options: {format: Mp4OutputFormat; target: BufferTarget});
    cancel(): Promise<void>;
  }
  export class Conversion {
    static init(options: {
      input: Input; output: Output;
      video: {codec: "avc"; bitrate: object};
      audio: {codec: "aac"; bitrate: object};
      showWarnings: boolean;
    }): Promise<Conversion>;
    readonly isValid: boolean;
    readonly discardedTracks: readonly object[];
    execute(): Promise<void>;
    cancel(): Promise<void>;
  }
}
