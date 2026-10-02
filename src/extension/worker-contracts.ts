/** Shared wire contracts; each worker retains its own lifetime and cancellation policy. */
export interface JxlEncodeRequest {
  readonly id: number;
  readonly pixels: ArrayBuffer;
  readonly width: number;
  readonly height: number;
}

export interface JxlEncodeReply {
  readonly id: number;
  readonly buffer?: ArrayBuffer;
  readonly error?: string;
}

export interface Mp4ConversionRequest {
  readonly blob: Blob;
  readonly maxBytes: number;
}

export interface Mp4ConversionReply {
  readonly blob?: Blob;
  readonly error?: string;
}

export interface ZipChecksumRequest {
  readonly id: number;
  readonly blob: Blob;
}

export interface ZipChecksumReply {
  readonly id: number;
  readonly checksum?: number;
  readonly error?: string;
}

export interface WorkerMessageScope<Request, Reply> {
  addEventListener(type: "message", listener: (event: MessageEvent<Request>) => void): void;
  postMessage(message: Reply, transfer?: Transferable[]): void;
}
