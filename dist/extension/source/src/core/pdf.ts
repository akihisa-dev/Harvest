import type { PdfImagePage, PdfRgbImagePage, PdfSourcePageOptions } from "./pdf-types.js";

export type { PdfJpegImagePage, PdfRgbImagePage, PdfImagePage, PdfJpegImage, PdfSourcePageOptions } from "./pdf-types.js";
export { getOriginalJpegPage } from "./jpeg.js";

const textEncoder = new TextEncoder();
const PDF_HEADER_1_3 = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x33, 0x0a,
  0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
]);
const PDF_HEADER_1_5 = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 0x0a,
  0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
]);
const SOURCE_COPY_CODES = Array.from({ length: 0x7e - 0x21 + 1 }, (_, index) => index + 0x21);

function pdfText(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function pdfHex(value: string): string {
  let hex = "";
  for (let index = 0; index < value.length; index += 1) {
    hex += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return `<${hex}>`;
}

function pdfAsciiHex(value: string): string {
  let hex = "";
  for (let index = 0; index < value.length; index += 1) {
    hex += value.charCodeAt(index).toString(16).padStart(2, "0");
  }
  return `<${hex}>`;
}

function validateDimension(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function validateImage(image: PdfImagePage, index: number | string): { data: Uint8Array; filter: string } {
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

function replaceLoneSurrogates(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value.slice(index, index + 2);
        index += 1;
      } else {
        output += "\ufffd";
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      output += "\ufffd";
    } else {
      output += value[index];
    }
  }
  return output;
}

function validateSourcePage(source: PdfSourcePageOptions | undefined): PdfSourcePageOptions | undefined {
  if (source === undefined) return undefined;
  if (source === null || typeof source !== "object") {
    throw new TypeError("Source page options must be an object.");
  }
  for (const name of ["heading", "filename", "url"] as const) {
    if (typeof source[name] !== "string") {
      throw new TypeError(`Source page ${name} must be a string.`);
    }
  }
  return {
    ...source,
    heading: replaceLoneSurrogates(source.heading),
    filename: replaceLoneSurrogates(source.filename),
    url: replaceLoneSurrogates(source.url),
  };
}

function validateSourceGlyphs(source: PdfSourcePageOptions): Map<string, PdfRgbImagePage> {
  const input = source.glyphs;
  if (input === undefined) return new Map();
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Source page glyphs must be a character-to-image object.");
  }

  const output = new Map<string, PdfRgbImagePage>();
  for (const [inputCharacter, image] of Object.entries(input)) {
    const character = replaceLoneSurrogates(inputCharacter);
    const codePoints = [...character];
    const codePoint = codePoints[0]?.codePointAt(0);
    if (codePoints.length !== 1 || codePoint === undefined || codePoint <= 0xff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw new RangeError("Source page glyph keys must be one Unicode scalar above U+00FF.");
    }
    if (image === null || typeof image !== "object" || !("rgbFlate" in image) || image.rgbFlate === undefined) {
      throw new TypeError(`Source page glyph ${character} must provide an RGB Flate image.`);
    }
    validateImage(image, `source glyph ${character}`);
    if (output.has(character)) throw new TypeError(`Source page has duplicate glyphs after Unicode normalization: ${character}.`);
    output.set(character, image);
  }
  return output;
}

const SOURCE_PAGE_WIDTH = 595;
const SOURCE_PAGE_HEIGHT = 842;
const SOURCE_PAGE_MARGIN = 48;

function sourceCharacterWidth(character: string): number {
  if (character.codePointAt(0)! <= 0x00ff) return 600;
  return 1000;
}

function wrapSourceLine(value: string, maxWidth: number): string[] {
  const output: string[] = [];
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

function sourceToUnicodeCMap(text: string): Uint8Array {
  const characters = [...new Set(text)].sort((left, right) => left.codePointAt(0)! - right.codePointAt(0)!);
  const mappings = characters.map(character => `${pdfHex(character)} ${pdfHex(character)}`);
  const mappingBlocks: string[] = [];
  for (let index = 0; index < mappings.length; index += 100) {
    const block = mappings.slice(index, index + 100);
    mappingBlocks.push(`${block.length} beginbfchar`, ...block, "endbfchar");
  }
  const cmap = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "3 begincodespacerange",
    "<0000> <D7FF>",
    "<E000> <FFFF>",
    "<D800DC00> <DBFFDFFF>",
    "endcodespacerange",
    ...mappingBlocks,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
    "",
  ].join("\n");
  return pdfText(cmap);
}

interface SourceCopyFont {
  readonly name: string;
  readonly fontObject: number;
  readonly cmapObject: number;
  readonly characters: readonly string[];
}

interface SourceGlyphObject {
  readonly character: string;
  readonly name: string;
  readonly object: number;
  readonly image: PdfRgbImagePage;
}

function sourceCopyToUnicodeCMap(characters: readonly string[], fontName: string): Uint8Array {
  const mappings = characters.map((character, index) => {
    const code = SOURCE_COPY_CODES[index]!;
    return `<${code.toString(16).padStart(2, "0")}> ${pdfHex(character)}`;
  });
  const mappingBlocks: string[] = [];
  for (let index = 0; index < mappings.length; index += 100) {
    const block = mappings.slice(index, index + 100);
    mappingBlocks.push(`${block.length} beginbfchar`, ...block, "endbfchar");
  }
  return pdfText([
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    `/CMapName /Harvest-Source-${fontName}-UCS def`,
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<21> <7e>",
    "endcodespacerange",
    ...mappingBlocks,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
    "",
  ].join("\n"));
}

function sourcePageContent(
  source: PdfSourcePageOptions,
  glyphObjects: ReadonlyMap<string, SourceGlyphObject>,
  copyGlyphs: ReadonlyMap<string, { readonly fontName: string; readonly code: number }>,
): { contents: Uint8Array; cmapText: string } {
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
  const commands: string[] = ["BT"];
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
      let runFont: "F1" | "F2" | null = null;
      const flush = (): void => {
        if (runFont === null || run === "") return;
        const encoded = runFont === "F1" ? pdfHex(run) : pdfAsciiHex(run);
        commands.push(`/${runFont} ${section.size} Tf 1 0 0 1 ${x.toFixed(3)} ${y.toFixed(3)} Tm ${encoded} Tj`);
        x += [...run].reduce((width, character) => width + sourceCharacterWidth(character), 0) * section.size / 1000;
        run = "";
      };
      const lineCharacters = [...line];
      for (let index = 0; index < lineCharacters.length;) {
        const character = lineCharacters[index]!;
        const glyph = glyphObjects.get(character);
        if (glyph !== undefined) {
          flush();
          const copy = copyGlyphs.get(character);
          const glyphRun = [glyph];
          let encoded = copy === undefined ? "" : copy.code.toString(16).padStart(2, "0");
          if (copy !== undefined) {
            for (let next = index + 1; next < lineCharacters.length; next += 1) {
              const nextCharacter = lineCharacters[next]!;
              const nextGlyph = glyphObjects.get(nextCharacter);
              const nextCopy = copyGlyphs.get(nextCharacter);
              if (nextGlyph === undefined || nextCopy?.fontName !== copy.fontName) break;
              glyphRun.push(nextGlyph);
              encoded += nextCopy.code.toString(16).padStart(2, "0");
            }
          }
          if (copy !== undefined) {
            commands.push(
              `/${copy.fontName} ${section.size} Tf 166.667 Tz 3 Tr ` +
              `1 0 0 1 ${x.toFixed(3)} ${y.toFixed(3)} Tm ` +
              `<${encoded}> Tj 100 Tz 0 Tr`,
            );
          }
          commands.push("ET");
          for (const runGlyph of glyphRun) {
            const width = sourceCharacterWidth(runGlyph.character) * section.size / 1000;
            const height = section.size;
            commands.push(
              `q\n${width.toFixed(3)} 0 0 ${height.toFixed(3)} ` +
              `${x.toFixed(3)} ${(y - height * 0.2).toFixed(3)} cm\n/${runGlyph.name} Do\nQ`,
            );
            x += width;
          }
          commands.push("BT");
          runFont = null;
          index += glyphRun.length;
          continue;
        }
        const font: "F1" | "F2" = character.codePointAt(0)! <= 0xff ? "F2" : "F1";
        if (runFont !== font) {
          flush();
          runFont = font;
        }
        run += character;
        index += 1;
      }
      flush();
      y -= section.leading;
    }
    y -= 10;
  }
  commands.push("ET\n");
  return { contents: pdfText(commands.join("\n")), cmapText: lines.join("\n") };
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
export function createPdfFromJpegs(images: readonly PdfImagePage[], source?: PdfSourcePageOptions): Uint8Array {
  const sourcePage = validateSourcePage(source);
  const sourceGlyphs = sourcePage === undefined ? new Map<string, PdfRgbImagePage>() : validateSourceGlyphs(sourcePage);
  const sourceCharacters = sourcePage === undefined
    ? []
    : [...new Set([...sourcePage.heading, ...sourcePage.filename, ...sourcePage.url].filter(character => character.codePointAt(0)! > 0xff))];
  const glyphCharacters = sourceCharacters.filter(character => sourceGlyphs.has(character));
  const copyFontGroups: string[][] = [];
  for (let index = 0; index < glyphCharacters.length; index += SOURCE_COPY_CODES.length) {
    copyFontGroups.push(glyphCharacters.slice(index, index + SOURCE_COPY_CODES.length));
  }
  const sourceObjectCount = sourcePage === undefined
    ? 0
    : 7 + glyphCharacters.length + copyFontGroups.length * 2;
  const objectCount = 2 + images.length * 3 + sourceObjectCount;
  const objects: Uint8Array[] = [];
  const offsets = new Array<number>(objectCount + 1).fill(0);
  const pdfHeader = sourcePage === undefined ? PDF_HEADER_1_3 : PDF_HEADER_1_5;

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

  if (sourcePage !== undefined) {
    const pageObject = 3 + images.length * 3;
    const contentsObject = pageObject + 1;
    const fontObject = pageObject + 2;
    const descendantObject = pageObject + 3;
    const toUnicodeObject = pageObject + 4;
    const standardFontObject = pageObject + 5;
    const descriptorObject = pageObject + 6;
    const sourceGlyphObjects = new Map<string, SourceGlyphObject>();
    glyphCharacters.forEach((character, index) => {
      sourceGlyphObjects.set(character, {
        character,
        name: `G${index}`,
        object: pageObject + 7 + index,
        image: sourceGlyphs.get(character)!,
      });
    });
    const copyFontObjectStart = pageObject + 7 + glyphCharacters.length;
    const copyFonts: SourceCopyFont[] = copyFontGroups.map((characters, index) => ({
      name: `F${index + 3}`,
      fontObject: copyFontObjectStart + index * 2,
      cmapObject: copyFontObjectStart + index * 2 + 1,
      characters,
    }));
    const copyGlyphs = new Map<string, { readonly fontName: string; readonly code: number }>();
    for (const font of copyFonts) {
      font.characters.forEach((character, index) => {
        copyGlyphs.set(character, { fontName: font.name, code: SOURCE_COPY_CODES[index]! });
      });
    }
    const { contents, cmapText } = sourcePageContent(sourcePage, sourceGlyphObjects, copyGlyphs);
    const toUnicode = sourceToUnicodeCMap(cmapText);
    const fontResources = [
      `/F1 ${fontObject} 0 R`,
      `/F2 ${standardFontObject} 0 R`,
      ...copyFonts.map(font => `/${font.name} ${font.fontObject} 0 R`),
    ].join(" ");
    const glyphResources = [...sourceGlyphObjects.values()]
      .map(glyph => `/${glyph.name} ${glyph.object} 0 R`).join(" ");

    objects.push(pdfText(
      `${pageObject} 0 obj\n` +
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${SOURCE_PAGE_WIDTH} ${SOURCE_PAGE_HEIGHT}] ` +
      `/Resources << /Font << ${fontResources} >> ` +
      (glyphResources === "" ? "" : `/XObject << ${glyphResources} >> `) + ">> " +
      `/Contents ${contentsObject} 0 R >>\nendobj\n`,
    ));
    objects.push(joinChunks([
      pdfText(`${contentsObject} 0 obj\n<< /Length ${contents.byteLength} >>\nstream\n`),
      contents,
      pdfText("endstream\nendobj\n"),
    ], pdfText(`${contentsObject} 0 obj\n<< /Length ${contents.byteLength} >>\nstream\n`).byteLength + contents.byteLength + "endstream\nendobj\n".length));
    objects.push(pdfText(
      `${fontObject} 0 obj\n` +
      `<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5-UniJIS-UTF16-H ` +
      `/Encoding /UniJIS-UTF16-H /DescendantFonts [${descendantObject} 0 R] ` +
      `/ToUnicode ${toUnicodeObject} 0 R >>\nendobj\n`,
    ));
    objects.push(pdfText(
      `${descendantObject} 0 obj\n` +
      `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> ` +
      `/FontDescriptor ${descriptorObject} 0 R /DW 1000 >>\nendobj\n`,
    ));
    objects.push(joinChunks([
      pdfText(`${toUnicodeObject} 0 obj\n<< /Length ${toUnicode.byteLength} >>\nstream\n`),
      toUnicode,
      pdfText("endstream\nendobj\n"),
    ], pdfText(`${toUnicodeObject} 0 obj\n<< /Length ${toUnicode.byteLength} >>\nstream\n`).byteLength + toUnicode.byteLength + "endstream\nendobj\n".length));
    objects.push(pdfText(
      `${standardFontObject} 0 obj\n` +
      "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>\nendobj\n",
    ));
    objects.push(pdfText(
      `${descriptorObject} 0 obj\n` +
      "<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 " +
      "/FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 " +
      "/CapHeight 700 /StemV 80 >>\nendobj\n",
    ));

    for (const glyph of sourceGlyphObjects.values()) {
      const { data } = validateImage(glyph.image, `source glyph ${glyph.character}`);
      const header = pdfText(
        `${glyph.object} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${glyph.image.width} /Height ${glyph.image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ` +
        `/Length ${data.byteLength} >>\nstream\n`,
      );
      objects.push(joinChunks([
        header,
        data,
        pdfText("\nendstream\nendobj\n"),
      ], header.byteLength + data.byteLength + "\nendstream\nendobj\n".length));
    }

    for (const font of copyFonts) {
      const cmap = sourceCopyToUnicodeCMap(font.characters, font.name);
      objects.push(pdfText(
        `${font.fontObject} 0 obj\n` +
        `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding ` +
        `/ToUnicode ${font.cmapObject} 0 R >>\nendobj\n`,
      ));
      const cmapHeader = pdfText(`${font.cmapObject} 0 obj\n<< /Length ${cmap.byteLength} >>\nstream\n`);
      objects.push(joinChunks([
        cmapHeader,
        cmap,
        pdfText("endstream\nendobj\n"),
      ], cmapHeader.byteLength + cmap.byteLength + "endstream\nendobj\n".length));
    }
  }

  const chunks: Uint8Array[] = [pdfHeader];
  let totalLength = pdfHeader.byteLength;
  for (const object of objects) {
    totalLength += object.byteLength;
    chunks.push(object);
  }

  // Build offsets from the actual serialized object sequence.
  let cursor = pdfHeader.byteLength;
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
export function createPdf(images: readonly PdfImagePage[], source?: PdfSourcePageOptions): Blob {
  const bytes = createPdfFromJpegs(images, source);
  const blobBytes = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(blobBytes).set(bytes);
  return new Blob([blobBytes], { type: "application/pdf" });
}

/** @deprecated Use createPdf. */
export const createPdfBlob = createPdf;
