import type { PdfImagePage } from "../core/pdf-types.js";
import { ImageDataError, type ImageDataErrorKind, type ImageDataOptions } from "./image-data-contract.js";

// Keep the established PDF-facing names while retrieval and conversion share one contract.
export { ImageDataError as PdfImageError } from "./image-data-contract.js";
export type PdfImageErrorKind = ImageDataErrorKind;
export interface PdfImageOptions extends ImageDataOptions {}

export interface PdfImagePreparationOptions extends PdfImageOptions {
  /** Number of simultaneous network requests. Pixel conversion remains sequential. */
  readonly fetchConcurrency?: number;
}

export type PdfImagePreparationResult = PdfImagePage | ImageDataError;
