/** Shared wire contracts; each worker retains its own lifetime and cancellation policy. */
export interface JxlEncodeRequest {
  readonly id: number;
  readonly pixels: ArrayBuffer;
  readonly width: number;
  readonly height: number;
}

export type JxlEncodeReply = {readonly id: number} & (
  | {readonly buffer: ArrayBuffer; readonly error?: never}
  | {readonly error: string; readonly buffer?: never}
);

export interface Mp4ConversionRequest {
  readonly blob: Blob;
  readonly maxBytes: number;
}

export type Mp4ConversionReply =
  | {readonly blob: Blob; readonly error?: never}
  | {readonly error: string; readonly blob?: never};

export interface ZipChecksumRequest {
  readonly id: number;
  readonly blob: Blob;
}

export type ZipChecksumReply = {readonly id: number} & (
  | {readonly checksum: number; readonly error?: never}
  | {readonly error: string; readonly checksum?: never}
);

export interface WorkerMessageScope<Reply> {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: Reply, transfer?: Transferable[]): void;
}

// Structured cloning does not validate a payload. Both endpoints must narrow unknown data.
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function workerRequestId(value: unknown): number | null {
  if (!record(value)) return null;
  const id = value["id"];
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

function failure(value: Record<string, unknown>, result: string): boolean {
  return typeof value["error"] === "string" && value["error"].length > 0 && value[result] === undefined;
}

export function isJxlEncodeRequest(value: unknown): value is JxlEncodeRequest {
  if (!record(value) || workerRequestId(value) === null) return false;
  const width = value["width"], height = value["height"], pixels = value["pixels"];
  return typeof width === "number" && typeof height === "number"
    && Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    && Number.isSafeInteger(width * height * 4)
    && pixels instanceof ArrayBuffer && pixels.byteLength === width * height * 4;
}

export function isJxlEncodeReply(value: unknown): value is JxlEncodeReply {
  if (!record(value) || workerRequestId(value) === null) return false;
  return failure(value, "buffer") || (value["error"] === undefined
    && value["buffer"] instanceof ArrayBuffer && value["buffer"].byteLength > 0);
}

export function isMp4ConversionRequest(value: unknown): value is Mp4ConversionRequest {
  if (!record(value)) return false;
  return value["blob"] instanceof Blob && value["blob"].type === "video/webm" && value["blob"].size > 0
    && typeof value["maxBytes"] === "number" && Number.isSafeInteger(value["maxBytes"]) && value["maxBytes"] > 0;
}

export function isMp4ConversionReply(value: unknown): value is Mp4ConversionReply {
  if (!record(value)) return false;
  return failure(value, "blob") || (value["error"] === undefined && value["blob"] instanceof Blob
    && value["blob"].type === "video/mp4" && value["blob"].size > 0);
}

export function isZipChecksumRequest(value: unknown): value is ZipChecksumRequest {
  return record(value) && workerRequestId(value) !== null && value["blob"] instanceof Blob;
}

export function isZipChecksumReply(value: unknown): value is ZipChecksumReply {
  if (!record(value) || workerRequestId(value) === null) return false;
  const checksum = value["checksum"];
  return failure(value, "checksum") || (value["error"] === undefined && typeof checksum === "number"
    && Number.isInteger(checksum) && checksum >= 0 && checksum <= 0xffff_ffff);
}
