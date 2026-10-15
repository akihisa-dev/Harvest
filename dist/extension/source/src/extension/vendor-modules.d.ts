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
  interface MediaTrack {
    getCodec(): Promise<string | null>;
    getDecoderConfig(): Promise<VideoDecoderConfig | AudioDecoderConfig | null>;
    computeDuration(): Promise<number>;
  }
  interface MediaPacket {readonly data: Uint8Array; readonly byteLength: number; readonly timestamp: number; readonly duration: number;}
  export const WEBM: object;
  export const MP4: object;
  export class EncodedPacketSink {
    constructor(track: object);
    packets(start?: object, end?: object, options?: {metadataOnly: boolean}): AsyncGenerator<MediaPacket, void, unknown>;
    getFirstPacket(): Promise<MediaPacket | null>;
    getNextPacket(previous: object): Promise<MediaPacket | null>;
  }
  export const QUALITY_HIGH: object;
  export class BlobSource { constructor(blob: Blob); }
  export class Input {
    constructor(options: {formats: object[]; source: BlobSource});
    getPrimaryVideoTrack(): Promise<MediaTrack | null>;
    getPrimaryAudioTrack(): Promise<MediaTrack | null>;
    getTracks(): Promise<object[]>;
    dispose(): void;
  }
  export class AudioSample {
    readonly sampleRate: number;
    readonly numberOfChannels: number;
    readonly numberOfFrames: number;
    readonly timestamp: number;
    copyTo(destination: Float32Array, options: {planeIndex: number; format: "f32-planar"}): void;
    close(): void;
  }
  export class AudioSampleSink {
    constructor(track: object);
    samples(): AsyncGenerator<AudioSample, void, unknown>;
  }
  export class BufferTarget {
    buffer: ArrayBuffer | null;
    on(event: "write", listener: (range: {start: number; end: number}) => void): () => void;
  }
  export class Mp4OutputFormat {}
  export class Output {
    constructor(options: {format: Mp4OutputFormat; target: BufferTarget});
    readonly state: string;
    cancel(): Promise<void>;
    start(): Promise<void>;
    finalize(): Promise<void>;
    addVideoTrack(source: EncodedVideoPacketSource): object;
    addAudioTrack(source: EncodedAudioPacketSource): object;
  }
  export class EncodedVideoPacketSource {
    constructor(codec: "avc");
    add(packet: object, metadata?: {decoderConfig: VideoDecoderConfig}): Promise<void>;
    close(): void;
  }
  export class EncodedAudioPacketSource {
    constructor(codec: "aac");
    add(packet: object, metadata?: {decoderConfig: AudioDecoderConfig}): Promise<void>;
    close(): void;
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
