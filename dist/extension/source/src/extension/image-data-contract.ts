import type { PdfJpegImagePage } from "../core/pdf-types.js";

export type ImageDataErrorKind = "http" | "network" | "timeout" | "cancelled" | "invalid-image";

/** A user-safe failure shared by image retrieval, decoding, and format conversion. */
export class ImageDataError extends Error {
  readonly kind: ImageDataErrorKind;
  readonly status?: number;

  constructor(kind: ImageDataErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ImageDataError";
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

export interface ImageDataOptions {
  readonly timeoutMs?: number;
  readonly pixelRowsPerChunk?: number;
  readonly signal?: AbortSignal;
}

export type FetchedImage =
  | {readonly kind: "original"; readonly page: PdfJpegImagePage}
  | {readonly kind: "bitmap"; readonly blob: Blob};

export function invalidImage(message: string): ImageDataError {
  return new ImageDataError("invalid-image", message);
}

export function validatePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
  return value;
}

export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ImageDataError("cancelled", "画像の取得を中止しました。");
}
