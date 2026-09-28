import { validatePdfImage } from "./pdf-image-page.js";
import { pdfAsciiHex, pdfHex, pdfStreamObject, pdfText } from "./pdf-objects.js";
const SOURCE_COPY_CODES = Array.from({ length: 0x7e - 0x21 + 1 }, (_, index) => index + 0x21);
const SOURCE_PAGE_WIDTH = 595;
const SOURCE_PAGE_HEIGHT = 842;
const SOURCE_PAGE_MARGIN = 48;
export function preparePdfSourcePage(source) {
    const sourcePage = validateSourcePage(source);
    if (sourcePage === undefined)
        return undefined;
    const sourceGlyphs = validateSourceGlyphs(sourcePage);
    const sourceCharacters = [...new Set([...sourcePage.heading, ...sourcePage.filename, ...sourcePage.url]
            .filter(character => character.codePointAt(0) > 0xff))];
    const glyphCharacters = sourceCharacters.filter(character => sourceGlyphs.has(character));
    const copyFontGroups = [];
    for (let index = 0; index < glyphCharacters.length; index += SOURCE_COPY_CODES.length) {
        copyFontGroups.push(glyphCharacters.slice(index, index + SOURCE_COPY_CODES.length));
    }
    return { source: sourcePage, sourceGlyphs, glyphCharacters, copyFontGroups };
}
export function createPdfSourcePageObjects(prepared, pageObject) {
    const { source, sourceGlyphs, glyphCharacters, copyFontGroups } = prepared;
    const contentsObject = pageObject + 1;
    const fontObject = pageObject + 2;
    const descendantObject = pageObject + 3;
    const toUnicodeObject = pageObject + 4;
    const standardFontObject = pageObject + 5;
    const descriptorObject = pageObject + 6;
    const sourceGlyphObjects = new Map();
    glyphCharacters.forEach((character, index) => {
        sourceGlyphObjects.set(character, {
            character,
            name: `G${index}`,
            object: pageObject + 7 + index,
            image: sourceGlyphs.get(character),
        });
    });
    const copyFontObjectStart = pageObject + 7 + glyphCharacters.length;
    const copyFonts = copyFontGroups.map((characters, index) => ({
        name: `F${index + 3}`,
        fontObject: copyFontObjectStart + index * 2,
        cmapObject: copyFontObjectStart + index * 2 + 1,
        characters,
    }));
    const copyGlyphs = new Map();
    for (const font of copyFonts) {
        font.characters.forEach((character, index) => {
            copyGlyphs.set(character, { fontName: font.name, code: SOURCE_COPY_CODES[index] });
        });
    }
    const { contents, cmapText } = sourcePageContent(source, sourceGlyphObjects, copyGlyphs);
    const toUnicode = sourceToUnicodeCMap(cmapText);
    const fontResources = [
        `/F1 ${fontObject} 0 R`,
        `/F2 ${standardFontObject} 0 R`,
        ...copyFonts.map(font => `/${font.name} ${font.fontObject} 0 R`),
    ].join(" ");
    const glyphResources = [...sourceGlyphObjects.values()]
        .map(glyph => `/${glyph.name} ${glyph.object} 0 R`).join(" ");
    const objects = [];
    objects.push(pdfText(`${pageObject} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${SOURCE_PAGE_WIDTH} ${SOURCE_PAGE_HEIGHT}] ` +
        `/Resources << /Font << ${fontResources} >> ` +
        (glyphResources === "" ? "" : `/XObject << ${glyphResources} >> `) + ">> " +
        `/Contents ${contentsObject} 0 R >>\nendobj\n`));
    objects.push(pdfStreamObject(`${contentsObject} 0 obj\n<< /Length ${contents.byteLength} >>\nstream\n`, contents));
    objects.push(pdfText(`${fontObject} 0 obj\n` +
        `<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5-UniJIS-UTF16-H ` +
        `/Encoding /UniJIS-UTF16-H /DescendantFonts [${descendantObject} 0 R] ` +
        `/ToUnicode ${toUnicodeObject} 0 R >>\nendobj\n`));
    objects.push(pdfText(`${descendantObject} 0 obj\n` +
        `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 ` +
        `/CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> ` +
        `/FontDescriptor ${descriptorObject} 0 R /DW 1000 >>\nendobj\n`));
    objects.push(pdfStreamObject(`${toUnicodeObject} 0 obj\n<< /Length ${toUnicode.byteLength} >>\nstream\n`, toUnicode));
    objects.push(pdfText(`${standardFontObject} 0 obj\n` +
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>\nendobj\n"));
    objects.push(pdfText(`${descriptorObject} 0 obj\n` +
        "<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 " +
        "/FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 " +
        "/CapHeight 700 /StemV 80 >>\nendobj\n"));
    for (const glyph of sourceGlyphObjects.values()) {
        const { data } = validatePdfImage(glyph.image, `source glyph ${glyph.character}`);
        objects.push(pdfStreamObject(`${glyph.object} 0 obj\n` +
            `<< /Type /XObject /Subtype /Image /Width ${glyph.image.width} /Height ${glyph.image.height} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ` +
            `/Length ${data.byteLength} >>\nstream\n`, data, "\nendstream\nendobj\n"));
    }
    for (const font of copyFonts) {
        const cmap = sourceCopyToUnicodeCMap(font.characters, font.name);
        objects.push(pdfText(`${font.fontObject} 0 obj\n` +
            `<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding ` +
            `/ToUnicode ${font.cmapObject} 0 R >>\nendobj\n`));
        const cmapHeader = `${font.cmapObject} 0 obj\n<< /Length ${cmap.byteLength} >>\nstream\n`;
        objects.push(pdfStreamObject(cmapHeader, cmap));
    }
    return objects;
}
function replaceLoneSurrogates(value) {
    let output = "";
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                output += value.slice(index, index + 2);
                index += 1;
            }
            else {
                output += "\ufffd";
            }
        }
        else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            output += "\ufffd";
        }
        else {
            output += value[index];
        }
    }
    return output;
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
    return {
        ...source,
        heading: replaceLoneSurrogates(source.heading),
        filename: replaceLoneSurrogates(source.filename),
        url: replaceLoneSurrogates(source.url),
    };
}
function validateSourceGlyphs(source) {
    const input = source.glyphs;
    if (input === undefined)
        return new Map();
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Source page glyphs must be a character-to-image object.");
    }
    const output = new Map();
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
        validatePdfImage(image, `source glyph ${character}`);
        if (output.has(character))
            throw new TypeError(`Source page has duplicate glyphs after Unicode normalization: ${character}.`);
        output.set(character, image);
    }
    return output;
}
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
    const characters = [...new Set(text)].sort((left, right) => left.codePointAt(0) - right.codePointAt(0));
    const mappings = characters.map(character => `${pdfHex(character)} ${pdfHex(character)}`);
    const mappingBlocks = [];
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
function sourceCopyToUnicodeCMap(characters, fontName) {
    const mappings = characters.map((character, index) => {
        const code = SOURCE_COPY_CODES[index];
        return `<${code.toString(16).padStart(2, "0")}> ${pdfHex(character)}`;
    });
    const mappingBlocks = [];
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
function sourcePageContent(source, glyphObjects, copyGlyphs) {
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
            const lineCharacters = [...line];
            for (let index = 0; index < lineCharacters.length;) {
                const character = lineCharacters[index];
                const glyph = glyphObjects.get(character);
                if (glyph !== undefined) {
                    flush();
                    const copy = copyGlyphs.get(character);
                    const glyphRun = [glyph];
                    let encoded = copy === undefined ? "" : copy.code.toString(16).padStart(2, "0");
                    if (copy !== undefined) {
                        for (let next = index + 1; next < lineCharacters.length; next += 1) {
                            const nextCharacter = lineCharacters[next];
                            const nextGlyph = glyphObjects.get(nextCharacter);
                            const nextCopy = copyGlyphs.get(nextCharacter);
                            if (nextGlyph === undefined || nextCopy?.fontName !== copy.fontName)
                                break;
                            glyphRun.push(nextGlyph);
                            encoded += nextCopy.code.toString(16).padStart(2, "0");
                        }
                    }
                    if (copy !== undefined) {
                        commands.push(`/${copy.fontName} ${section.size} Tf 166.667 Tz 3 Tr ` +
                            `1 0 0 1 ${x.toFixed(3)} ${y.toFixed(3)} Tm ` +
                            `<${encoded}> Tj 100 Tz 0 Tr`);
                    }
                    commands.push("ET");
                    for (const runGlyph of glyphRun) {
                        const width = sourceCharacterWidth(runGlyph.character) * section.size / 1000;
                        const height = section.size;
                        commands.push(`q\n${width.toFixed(3)} 0 0 ${height.toFixed(3)} ` +
                            `${x.toFixed(3)} ${(y - height * 0.2).toFixed(3)} cm\n/${runGlyph.name} Do\nQ`);
                        x += width;
                    }
                    commands.push("BT");
                    runFont = null;
                    index += glyphRun.length;
                    continue;
                }
                const font = character.codePointAt(0) <= 0xff ? "F2" : "F1";
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
