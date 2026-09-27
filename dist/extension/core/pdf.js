const textEncoder = new TextEncoder();
const PDF_HEADER = new Uint8Array([
    0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x33, 0x0a,
    0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
]);
function pdfText(value) {
    return textEncoder.encode(value);
}
function pdfHex(value) {
    let hex = "";
    for (let index = 0; index < value.length; index += 1) {
        hex += value.charCodeAt(index).toString(16).padStart(4, "0");
    }
    return `<${hex}>`;
}
function pdfAsciiHex(value) {
    let hex = "";
    for (let index = 0; index < value.length; index += 1) {
        hex += value.charCodeAt(index).toString(16).padStart(2, "0");
    }
    return `<${hex}>`;
}
function validateDimension(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer.`);
    }
}
function validateImage(image, index) {
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
function validateSourcePage(source) {
    if (source === undefined)
        return undefined;
    if (source === null || typeof source !== "object") {
        throw new TypeError("Source page options must be an object.");
    }
    for (const name of ["heading", "filename", "url"]) {
        if (typeof source[name] !== "string") {
            throw new TypeError(`Source page ${name} must be a string.`);
        }
    }
    return source;
}
const SOURCE_PAGE_WIDTH = 595;
const SOURCE_PAGE_HEIGHT = 842;
const SOURCE_PAGE_MARGIN = 48;
function sourceCharacterWidth(character) {
    if (character.codePointAt(0) <= 0x00ff)
        return 600;
    return 1000;
}
function wrapSourceLine(value, maxWidth) {
    const output = [];
    for (const paragraph of value.split(/\r\n|\r|\n/u)) {
        let line = "";
        let width = 0;
        for (const character of paragraph) {
            const characterWidth = sourceCharacterWidth(character);
            if (line !== "" && width + characterWidth > maxWidth) {
                output.push(line);
                line = "";
                width = 0;
            }
            line += character;
            width += characterWidth;
        }
        output.push(line);
    }
    return output;
}
function sourceToUnicodeCMap(text) {
    const codeUnits = new Set();
    for (let index = 0; index < text.length; index += 1)
        codeUnits.add(text.charCodeAt(index));
    const mappings = [...codeUnits].sort((left, right) => left - right)
        .map(codeUnit => `<${codeUnit.toString(16).padStart(4, "0")}> <${codeUnit.toString(16).padStart(4, "0")}>`)
        .join("\n");
    const cmap = [
        "/CIDInit /ProcSet findresource begin",
        "12 dict begin",
        "begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
        "/CMapName /Adobe-Identity-UCS def",
        "/CMapType 2 def",
        "1 begincodespacerange",
        "<0000> <FFFF>",
        "endcodespacerange",
        `${codeUnits.size} beginbfchar`,
        mappings,
        "endbfchar",
        "endcmap",
        "CMapName currentdict /CMap defineresource pop",
        "end",
        "end",
        "",
    ].join("\n");
    return pdfText(cmap);
}
function sourcePageContent(source) {
    const availableWidth = (SOURCE_PAGE_WIDTH - SOURCE_PAGE_MARGIN * 2) * 1000;
    const headingLines = wrapSourceLine(source.heading, availableWidth / 18);
    const filenameLines = wrapSourceLine(source.filename, availableWidth / 12);
    const fixedHeight = headingLines.length * 25 + filenameLines.length * 18 + 20;
    const availableHeight = Math.max(1, SOURCE_PAGE_HEIGHT - SOURCE_PAGE_MARGIN * 2 - fixedHeight);
    const urlUnits = [...source.url].reduce((total, character) => total + sourceCharacterWidth(character), 0);
    let urlSize = 10;
    let urlLines = wrapSourceLine(source.url, availableWidth / urlSize);
    while (urlSize > 0.25 && fixedHeight + urlLines.length * urlSize * 1.4 > availableHeight) {
        urlSize -= 0.25;
        urlLines = wrapSourceLine(source.url, availableWidth / urlSize);
    }
    if (fixedHeight + urlLines.length * urlSize * 1.4 > availableHeight) {
        urlSize = Math.max(0.05, Math.sqrt((availableHeight * availableWidth) / Math.max(urlUnits, 1) / 1.4));
        urlLines = wrapSourceLine(source.url, availableWidth / urlSize);
    }
    const lines = [...headingLines, ...filenameLines, ...urlLines];
    const commands = ["BT"];
    let y = SOURCE_PAGE_HEIGHT - SOURCE_PAGE_MARGIN;
    const sections = [
        { lines: headingLines, size: 18, leading: 25 },
        { lines: filenameLines, size: 12, leading: 18 },
        { lines: urlLines, size: urlSize, leading: urlSize * 1.4 },
    ];
    for (const section of sections) {
        for (const line of section.lines) {
            let x = SOURCE_PAGE_MARGIN;
            let run = "";
            let runFont = null;
            const flush = () => {
                if (runFont === null || run === "")
                    return;
                const encoded = runFont === "F1" ? pdfHex(run) : pdfAsciiHex(run);
                commands.push(`/${runFont} ${section.size} Tf 1 0 0 1 ${x.toFixed(3)} ${y.toFixed(3)} Tm ${encoded} Tj`);
                x += [...run].reduce((width, character) => width + sourceCharacterWidth(character), 0) * section.size / 1000;
                run = "";
            };
            for (const character of line) {
                const font = character.codePointAt(0) <= 0xff ? "F2" : "F1";
                if (runFont !== font) {
                    flush();
                    runFont = font;
                }
                run += character;
            }
            flush();
            y -= section.leading;
        }
        y -= 10;
    }
    commands.push("ET\n");
    return { contents: pdfText(commands.join("\n")), cmapText: lines.join("\n") };
}
/**
 * Returns a supported JPEG page without transcoding it, or null when the JPEG
 * is not a complete 8-bit three-component JFIF baseline/progressive image.
 */
export function getOriginalJpegPage(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        return null;
    }
    const byte = (index) => bytes[index] ?? -1;
    let offset = 2;
    let hasJfif = false;
    let hasScan = false;
    let dimensions = null;
    while (offset < bytes.byteLength) {
        if (byte(offset++) !== 0xff)
            return null;
        while (offset < bytes.byteLength && byte(offset) === 0xff)
            offset += 1;
        if (offset >= bytes.byteLength)
            return null;
        const marker = byte(offset++);
        if (marker === 0xd9)
            break;
        if (marker === 0xda) {
            hasScan = true;
            for (let i = offset; i + 1 < bytes.byteLength; i += 1) {
                if (byte(i) === 0xff && byte(i + 1) === 0xd9)
                    return hasJfif && dimensions ? { jpeg: bytes, ...dimensions } : null;
            }
            return null;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7))
            continue;
        if (offset + 2 > bytes.byteLength)
            return null;
        const length = (byte(offset) << 8) | byte(offset + 1);
        if (length < 2 || offset + length > bytes.byteLength)
            return null;
        const segmentStart = offset + 2;
        if (marker === 0xe0 && length >= 7 &&
            byte(segmentStart) === 0x4a && byte(segmentStart + 1) === 0x46 &&
            byte(segmentStart + 2) === 0x49 && byte(segmentStart + 3) === 0x46 &&
            byte(segmentStart + 4) === 0x00) {
            hasJfif = true;
        }
        if (marker === 0xe1 || marker === 0xe2 || marker === 0xee)
            return null;
        if ([0xc1, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
            return null;
        if (marker === 0xc0 || marker === 0xc2) {
            if (length < 8 || byte(segmentStart) !== 8 || byte(segmentStart + 5) !== 3)
                return null;
            const height = (byte(segmentStart + 1) << 8) | byte(segmentStart + 2);
            const width = (byte(segmentStart + 3) << 8) | byte(segmentStart + 4);
            if (width === 0 || height === 0)
                return null;
            dimensions = { width, height };
        }
        offset += length;
    }
    return hasScan && hasJfif && dimensions ? { jpeg: bytes, ...dimensions } : null;
}
function joinChunks(chunks, totalLength) {
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
export function createPdfFromJpegs(images, source) {
    const sourcePage = validateSourcePage(source);
    const sourceObjectCount = sourcePage === undefined ? 0 : 6;
    const objectCount = 2 + images.length * 3 + sourceObjectCount;
    const objects = [];
    const offsets = new Array(objectCount + 1).fill(0);
    objects.push(pdfText("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"));
    const pageReferences = [
        ...images.map((_, index) => `${3 + index * 3} 0 R`),
        ...(sourcePage === undefined ? [] : [`${3 + images.length * 3} 0 R`]),
    ].join(" ");
    objects.push(pdfText(`2 0 obj\n<< /Type /Pages /Kids [${pageReferences}] /Count ${images.length + (sourcePage === undefined ? 0 : 1)} >>\nendobj\n`));
    for (const [index, image] of images.entries()) {
        const { data, filter } = validateImage(image, index);
        const pageObject = 3 + index * 3;
        const contentsObject = pageObject + 1;
        const imageObject = pageObject + 2;
        const contents = pdfText(`q\n${image.width} 0 0 ${image.height} 0 0 cm\n/Im0 Do\nQ\n`);
        objects.push(pdfText(`${pageObject} 0 obj\n` +
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}] ` +
            `/Resources << /XObject << /Im0 ${imageObject} 0 R >> >> ` +
            `/Contents ${contentsObject} 0 R >>\nendobj\n`));
        objects.push(joinChunks([
            pdfText(`${contentsObject} 0 obj\n<< /Length ${contents.byteLength} >>\nstream\n`),
            contents,
            pdfText("endstream\nendobj\n"),
        ], pdfText(`${contentsObject} 0 obj\n<< /Length ${contents.byteLength} >>\nstream\n`).byteLength + contents.byteLength + "endstream\nendobj\n".length));
        objects.push(joinChunks([
            pdfText(`${imageObject} 0 obj\n` +
                `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
                `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} ` +
                `/Length ${data.byteLength} >>\nstream\n`),
            data,
            pdfText("\nendstream\nendobj\n"),
        ], pdfText(`${imageObject} 0 obj\n` +
            `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} ` +
            `/Length ${data.byteLength} >>\nstream\n`).byteLength + data.byteLength + "\nendstream\nendobj\n".length));
    }
    if (sourcePage !== undefined) {
        const pageObject = 3 + images.length * 3;
        const contentsObject = pageObject + 1;
        const fontObject = pageObject + 2;
        const descendantObject = pageObject + 3;
        const toUnicodeObject = pageObject + 4;
        const standardFontObject = pageObject + 5;
        const { contents, cmapText } = sourcePageContent(sourcePage);
        const toUnicode = sourceToUnicodeCMap(cmapText);
        objects.push(pdfText(`${pageObject} 0 obj\n` +
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${SOURCE_PAGE_WIDTH} ${SOURCE_PAGE_HEIGHT}] ` +
            `/Resources << /Font << /F1 ${fontObject} 0 R /F2 ${standardFontObject} 0 R >> >> ` +
            `/Contents ${contentsObject} 0 R >>\nendobj\n`));
        objects.push(joinChunks([
            pdfText(`${contentsObject} 0 obj\n<< /Length ${contents.byteLength} >>\nstream\n`),
            contents,
            pdfText("endstream\nendobj\n"),
        ], pdfText(`${contentsObject} 0 obj\n<< /Length ${contents.byteLength} >>\nstream\n`).byteLength + contents.byteLength + "endstream\nendobj\n".length));
        objects.push(pdfText(`${fontObject} 0 obj\n` +
            `<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 ` +
            `/Encoding /UniJIS-UTF16-H /DescendantFonts [${descendantObject} 0 R] ` +
            `/ToUnicode ${toUnicodeObject} 0 R >>\nendobj\n`));
        objects.push(pdfText(`${descendantObject} 0 obj\n` +
            `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 ` +
            `/CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> ` +
            `/DW 1000 >>\nendobj\n`));
        objects.push(joinChunks([
            pdfText(`${toUnicodeObject} 0 obj\n<< /Length ${toUnicode.byteLength} >>\nstream\n`),
            toUnicode,
            pdfText("endstream\nendobj\n"),
        ], pdfText(`${toUnicodeObject} 0 obj\n<< /Length ${toUnicode.byteLength} >>\nstream\n`).byteLength + toUnicode.byteLength + "endstream\nendobj\n".length));
        objects.push(pdfText(`${standardFontObject} 0 obj\n` +
            "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>\nendobj\n"));
    }
    const chunks = [PDF_HEADER];
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
export function createPdf(images, source) {
    const bytes = createPdfFromJpegs(images, source);
    const blobBytes = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(blobBytes).set(bytes);
    return new Blob([blobBytes], { type: "application/pdf" });
}
/** @deprecated Use createPdf. */
export const createPdfBlob = createPdf;
