/** One JPEG page and its intrinsic pixel dimensions. */
export interface PdfJpegImagePage {
  readonly jpeg: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** One Flate-compressed, 8-bit RGB page and its intrinsic pixel dimensions. */
export interface PdfRgbImagePage {
  readonly rgbFlate: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** A page backed by either an existing JPEG or compressed RGB pixels. */
export type PdfImagePage = PdfJpegImagePage | PdfRgbImagePage;

/** @deprecated Use PdfImagePage. */
export type PdfJpegImage = PdfJpegImagePage;

/** Text shown on an optional final page that identifies the source document. */
export interface PdfSourcePageOptions {
  readonly heading: string;
  readonly filename: string;
  readonly url: string;
  /** Rasterized source characters above U+00FF, used for consistent display and Unicode copying. */
  readonly glyphs?: Readonly<Record<string, PdfRgbImagePage>> | undefined;
}
