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

const textEncoder = new TextEncoder();
const PDF_HEADER = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x33, 0x0a,
  0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
]);

function pdfText(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function validateDimension(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function validateImage(image: PdfImagePage, index: number): { data: Uint8Array; filter: string } {
  if (image === null || typeof image !== "object") {
    throw new TypeError(`Image ${index} must be an image page.`);
  }
  const hasJpeg = "jpeg" in image && image.jpeg !== undefined;
  const hasRgbFlate = "rgbFlate" in image && image.rgbFlate !== undefined;
  if (hasJpeg === hasRgbFlate) {
    throw new TypeError(`Image ${index} must provide exactly one of jpeg or rgbFlate.`);
  }
  const data = "jpeg" in image ? image.jpeg : image.rgbFlate;
  const name = hasJpeg ? "jpeg" : "rgbFlate";
  if (!(data instanceof Uint8Array)) {
    throw new TypeError(`Image ${index} ${name} must be a Uint8Array.`);
  }
  if (data.byteLength === 0) {
    throw new RangeError(`Image ${index} ${name} must not be empty.`);
  }
  validateDimension(image.width, `Image ${index} width`);
  validateDimension(image.height, `Image ${index} height`);
  return { data, filter: hasJpeg ? "DCTDecode" : "FlateDecode" };
}

/**
 * Returns a supported JPEG page without transcoding it, or null when the JPEG
 * is not a complete 8-bit three-component JFIF baseline/progressive image.
 */
export function getOriginalJpegPage(bytes: Uint8Array): PdfJpegImagePage | null {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  const byte = (index: number): number => bytes[index] ?? -1;
  let offset = 2;
  let hasJfif = false;
  let hasScan = false;
  let dimensions: { width: number; height: number } | null = null;
  while (offset < bytes.byteLength) {
    if (byte(offset++) !== 0xff) return null;
    while (offset < bytes.byteLength && byte(offset) === 0xff) offset += 1;
    if (offset >= bytes.byteLength) return null;
    const marker = byte(offset++);
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      hasScan = true;
      for (let i = offset; i + 1 < bytes.byteLength; i += 1) {
        if (byte(i) === 0xff && byte(i + 1) === 0xd9) return hasJfif && dimensions ? { jpeg: bytes, ...dimensions } : null;
      }
      return null;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) return null;
    const length = (byte(offset) << 8) | byte(offset + 1);
    if (length < 2 || offset + length > bytes.byteLength) return null;
    const segmentStart = offset + 2;
    if (marker === 0xe0 && length >= 7 &&
        byte(segmentStart) === 0x4a && byte(segmentStart + 1) === 0x46 &&
        byte(segmentStart + 2) === 0x49 && byte(segmentStart + 3) === 0x46 &&
        byte(segmentStart + 4) === 0x00) {
      hasJfif = true;
    }
    if (marker === 0xe1 || marker === 0xe2 || marker === 0xee) return null;
    if ([0xc1, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return null;
    if (marker === 0xc0 || marker === 0xc2) {
      if (length < 8 || byte(segmentStart) !== 8 || byte(segmentStart + 5) !== 3) return null;
      const height = (byte(segmentStart + 1) << 8) | byte(segmentStart + 2);
      const width = (byte(segmentStart + 3) << 8) | byte(segmentStart + 4);
      if (width === 0 || height === 0) return null;
      dimensions = { width, height };
    }
    offset += length;
  }
  return hasScan && hasJfif && dimensions ? { jpeg: bytes, ...dimensions } : null;
}

function joinChunks(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/**
 * Creates a PDF with one image per page, sized to the image dimensions.
 * The returned bytes are independent of the input arrays and safe to persist.
 */
export function createPdfFromJpegs(images: readonly PdfImagePage[]): Uint8Array {
  const objectCount = 2 + images.length * 3;
  const objects: Uint8Array[] = [];
  const offsets = new Array<number>(objectCount + 1).fill(0);

  objects.push(pdfText("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"));

  const pageReferences = images.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  objects.push(pdfText(`2 0 obj\n<< /Type /Pages /Kids [${pageReferences}] /Count ${images.length} >>\nendobj\n`));

  for (const [index, image] of images.entries()) {
    const { data, filter } = validateImage(image, index);
    const pageObject = 3 + index * 3;
    const contentsObject = pageObject + 1;
    const imageObject = pageObject + 2;
    const contents = pdfText(`q\n${image.width} 0 0 ${image.height} 0 0 cm\n/Im0 Do\nQ\n`);

    objects.push(pdfText(
      `${pageObject} 0 obj\n` +
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}] ` +
      `/Resources << /XObject << /Im0 ${imageObject} 0 R >> >> ` +
      `/Contents ${contentsObject} 0 R >>\nendobj\n`,
    ));
    objects.push(joinChunks([
      pdfText(`${contentsObject} 0 obj\n<< /Length ${contents.byteLength} >>\nstream\n`),
      contents,
      pdfText("endstream\nendobj\n"),
    ], pdfText(`${contentsObject} 0 obj\n<< /Length ${contents.byteLength} >>\nstream\n`).byteLength + contents.byteLength + "endstream\nendobj\n".length));
    objects.push(joinChunks([
      pdfText(
        `${imageObject} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} ` +
        `/Length ${data.byteLength} >>\nstream\n`,
      ),
      data,
      pdfText("\nendstream\nendobj\n"),
    ],
      pdfText(
        `${imageObject} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} ` +
        `/Length ${data.byteLength} >>\nstream\n`,
      ).byteLength + data.byteLength + "\nendstream\nendobj\n".length,
    ));
  }

  const chunks: Uint8Array[] = [PDF_HEADER];
  let totalLength = PDF_HEADER.byteLength;
  for (const object of objects) {
    totalLength += object.byteLength;
    chunks.push(object);
  }

  // Build offsets from the actual serialized object sequence.
  let cursor = PDF_HEADER.byteLength;
  let objectIndex = 1;
  for (const object of objects) {
    offsets[objectIndex] = cursor;
    cursor += object.byteLength;
    objectIndex += 1;
  }
  const xrefOffset = cursor;
  const xref = [
    `xref\n0 ${objectCount + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  const xrefBytes = pdfText(xref);
  chunks.push(xrefBytes);
  totalLength += xrefBytes.byteLength;
  return joinChunks(chunks, totalLength);
}

/** Creates a browser Blob containing the PDF generated by createPdfFromJpegs. */
export function createPdf(images: readonly PdfImagePage[]): Blob {
  const bytes = createPdfFromJpegs(images);
  const blobBytes = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(blobBytes).set(bytes);
  return new Blob([blobBytes], { type: "application/pdf" });
}

/** @deprecated Use createPdf. */
export const createPdfBlob = createPdf;
