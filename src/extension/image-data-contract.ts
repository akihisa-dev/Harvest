import type { PdfJpegImagePage } from "../core/pdf-types.js";

export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 16_384;
export const MAX_IMAGE_PIXELS = 64_000_000;
export const IMAGE_TOO_LARGE_MESSAGE = "画像が大きすぎるため、処理できません。";

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
  /** The page that supplied the image URL; only this origin may use site credentials. */
  readonly sourcePage?: string;
}

export type FetchedImage =
  | {readonly kind: "original"; readonly page: PdfJpegImagePage}
  | {readonly kind: "bitmap"; readonly blob: Blob; readonly originalJpeg?: boolean};

export function invalidImage(message: string): ImageDataError {
  return new ImageDataError("invalid-image", message);
}

/** Return the shared user-facing error for dimensions that cannot be processed safely. */
export function imageDimensionsError(width: number, height: number): string | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    return "画像の大きさが不正です。";
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    return IMAGE_TOO_LARGE_MESSAGE;
  }
  return null;
}

export function validatePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer.`);
  return value;
}

export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ImageDataError("cancelled", "画像の取得を中止しました。");
}
