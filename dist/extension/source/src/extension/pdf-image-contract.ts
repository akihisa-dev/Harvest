import type { PdfImagePage } from "../core/pdf-types.js";

export type PdfImageErrorKind = "http" | "network" | "timeout" | "cancelled" | "invalid-image";

/** A user-safe reason for an image that could not be included in the PDF. */
export class PdfImageError extends Error {
  readonly kind: PdfImageErrorKind;
  readonly status?: number;

  constructor(kind: PdfImageErrorKind, message: string, status?: number) {
    super(message);
    this.name = "PdfImageError";
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

export interface PdfImageOptions {
  /** The complete response and body must finish within this duration. */
  readonly timeoutMs?: number;
  /** Number of canvas rows read at once. Mainly useful for deterministic tests. */
  readonly pixelRowsPerChunk?: number;
  readonly signal?: AbortSignal;
}

export interface PdfImagePreparationOptions extends PdfImageOptions {
  /** Number of simultaneous network requests. Pixel conversion remains sequential. */
  readonly fetchConcurrency?: number;
}

export type PdfImagePreparationResult = PdfImagePage | PdfImageError;

export type FetchedImage =
  | { readonly kind: "original"; readonly page: PdfImagePage }
  | { readonly kind: "bitmap"; readonly blob: Blob };

export function invalidImage(message: string): PdfImageError {
  return new PdfImageError("invalid-image", message);
}

export function validatePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PdfImageError("cancelled", "画像の取得を中止しました。");
}
