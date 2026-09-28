import type { PdfImagePage } from "./pdf-types.js";
import { pdfStreamObject, pdfText } from "./pdf-objects.js";

export function validatePdfImage(image: PdfImagePage, index: number | string): {data: Uint8Array; filter: string} {
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
  return {data, filter: hasJpeg ? "DCTDecode" : "FlateDecode"};
}

function validateDimension(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

export function createPdfImagePageObjects(image: PdfImagePage, index: number, pageObject: number): Uint8Array[] {
  const {data, filter} = validatePdfImage(image, index);
  const contentsObject = pageObject + 1;
  const imageObject = pageObject + 2;
  const contents = pdfText(`q\n${image.width} 0 0 ${image.height} 0 0 cm\n/Im0 Do\nQ\n`);
  const page = pdfText(
    `${pageObject} 0 obj\n` +
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}] ` +
    `/Resources << /XObject << /Im0 ${imageObject} 0 R >> >> ` +
    `/Contents ${contentsObject} 0 R >>\nendobj\n`,
  );
  const contentsStream = pdfStreamObject(
    `${contentsObject} 0 obj\n<< /Length ${contents.byteLength} >>\nstream\n`,
    contents,
  );
  const imageStream = pdfStreamObject(
    `${imageObject} 0 obj\n` +
    `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} ` +
    `/Length ${data.byteLength} >>\nstream\n`,
    data,
    "\nendstream\nendobj\n",
  );
  return [page, contentsStream, imageStream];
}
