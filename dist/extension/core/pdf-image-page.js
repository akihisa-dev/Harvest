import { pdfStreamObject, pdfStreamObjectParts, pdfText } from "./pdf-objects.js";
const MAX_DEFAULT_USER_SPACE_PAGE_DIMENSION = 14_400;
export function validatePdfImage(image, index) {
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
function validateDimension(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer.`);
    }
}
export function createPdfImagePageObjects(image, index, pageObject) {
    const { data, filter } = validatePdfImage(image, index);
    const contentsObject = pageObject + 1;
    const imageObject = pageObject + 2;
    const pageDimensions = getPageDimensions(image.width, image.height);
    const contents = pdfText(`q\n${pageDimensions.width} 0 0 ${pageDimensions.height} 0 0 cm\n/Im0 Do\nQ\n`);
    const page = pdfText(`${pageObject} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageDimensions.width} ${pageDimensions.height}] ` +
        `/Resources << /XObject << /Im0 ${imageObject} 0 R >> >> ` +
        `/Contents ${contentsObject} 0 R >>\nendobj\n`);
    const contentsStream = pdfStreamObject(`${contentsObject} 0 obj\n<< /Length ${contents.byteLength} >>\nstream\n`, contents);
    const imageStream = pdfStreamObjectParts(`${imageObject} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} ` +
        `/Length ${data.byteLength} >>\nstream\n`, data, "\nendstream\nendobj\n");
    return [[page], [contentsStream], imageStream];
}
function getPageDimensions(width, height) {
    const largestDimension = Math.max(width, height);
    if (largestDimension <= MAX_DEFAULT_USER_SPACE_PAGE_DIMENSION) {
        return { width: String(width), height: String(height) };
    }
    const scale = MAX_DEFAULT_USER_SPACE_PAGE_DIMENSION / largestDimension;
    return {
        width: width === largestDimension ? String(MAX_DEFAULT_USER_SPACE_PAGE_DIMENSION) : formatPdfNumber(width * scale),
        height: height === largestDimension ? String(MAX_DEFAULT_USER_SPACE_PAGE_DIMENSION) : formatPdfNumber(height * scale),
    };
}
function formatPdfNumber(value) {
    const text = value.toString();
    if (!/[eE]/.test(text))
        return text;
    const exponentMarker = text.toLowerCase().indexOf("e");
    const coefficient = text.slice(0, exponentMarker);
    const exponent = Number(text.slice(exponentMarker + 1));
    const decimalPoint = coefficient.indexOf(".");
    const digits = coefficient.replace(".", "");
    const integerDigits = (decimalPoint === -1 ? coefficient.length : decimalPoint) + exponent;
    if (integerDigits <= 0)
        return `0.${"0".repeat(-integerDigits)}${digits}`;
    if (integerDigits >= digits.length)
        return `${digits}${"0".repeat(integerDigits - digits.length)}`;
    return `${digits.slice(0, integerDigits)}.${digits.slice(integerDigits)}`;
}
