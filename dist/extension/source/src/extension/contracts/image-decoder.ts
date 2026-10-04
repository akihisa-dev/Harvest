/** Narrow WebCodecs image decoding contract, absent from TypeScript's DOM library. */
export interface AnimationDecoder {
  readonly tracks: {
      readonly ready: Promise<void>;
      readonly selectedTrack: {
          readonly animated: boolean;
          readonly frameCount: number;
          readonly repetitionCount: number;
      } | null;
  };
  readonly completed: Promise<void>;
  decode(options: {
      frameIndex: number;
      completeFramesOnly: boolean;
  }): Promise<{
      image: VideoFrame;
      complete: boolean;
  }>;
  close(): void;
}
export interface AnimationDecoderConstructor {
  new (options: {
      data: ArrayBuffer;
      type: string;
      preferAnimation: boolean;
  }): AnimationDecoder;
  isTypeSupported(type: string): Promise<boolean>;
}
