import {baselineJpeg, exifJpeg} from "./jpeg-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {deflateSync} from "node:zlib";
import { createPdf, createPdfFromJpegs, createSourcePageLayout, getOriginalJpegPage } from "../dist/extension/core/pdf.js";

const decode = (bytes) => new TextDecoder().decode(bytes);
const ascii = (value) => new TextEncoder().encode(value);

function utf16Hex(value) {
  let hex = "";
  for (let index = 0; index < value.length; index += 1) {
    hex += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return hex;
}

function asciiHex(value) {
  let hex = "";
  for (let index = 0; index < value.length; index += 1) {
    hex += value.charCodeAt(index).toString(16).padStart(2, "0");
  }
  return hex;
}

function decodeUtf16Hex(value) {
  let output = "";
  for (let index = 0; index < value.length; index += 4) {
    output += String.fromCharCode(Number.parseInt(value.slice(index, index + 4), 16));
  }
  return output;
}

function decodeAsciiHex(value) {
  let output = "";
  for (let index = 0; index < value.length; index += 2) {
    output += String.fromCharCode(Number.parseInt(value.slice(index, index + 2), 16));
  }
  return output;
}

function findBytes(bytes, needle, start = 0) {
  for (let index = start; index <= bytes.length - needle.length; index += 1) {
    if (needle.every((value, offset) => bytes[index + offset] === value)) return index;
  }
  return -1;
}

function imageStreams(pdf) {
  const streams = [];
  let cursor = 0;
  while ((cursor = findBytes(pdf, ascii("/Subtype /Image"), cursor)) !== -1) {
    const stream = findBytes(pdf, ascii("stream\n"), cursor);
    const header = decode(pdf.slice(cursor, stream));
    const length = Number(header.match(/\/Length (\d+)/)?.[1]);
    streams.push(pdf.slice(stream + 7, stream + 7 + length));
    cursor = stream + 7 + length;
  }
  return streams;
}

function assertValidXref(pdf) {
  const source = decode(pdf);
  const startxref = source.match(/startxref\n(\d+)\n%%EOF\n$/);
  assert.ok(startxref, "the PDF contains a startxref entry");
  const xrefOffset = Number(startxref[1]);
  assert.equal(decode(pdf.subarray(xrefOffset, xrefOffset + 5)), "xref\n");
  const xrefLines = decode(pdf.subarray(xrefOffset)).split("\n");
  const objectCount = Number(xrefLines[1].split(" ")[1]);
  assert.ok(Number.isSafeInteger(objectCount) && objectCount > 0);
  for (let objectNumber = 1; objectNumber < objectCount; objectNumber += 1) {
    const offset = Number(xrefLines[2 + objectNumber].slice(0, 10));
    assert.equal(decode(pdf.subarray(offset, offset + `${objectNumber} 0 obj\n`.length)), `${objectNumber} 0 obj\n`);
  }
}

function readSourceContentStream(source) {
  const pages = [...source.matchAll(/\/Type \/Page\b[^\n]*\/Contents (\d+) 0 R/g)];
  const contentsObject = Number(pages.at(-1)?.[1]);
  assert.ok(Number.isSafeInteger(contentsObject), "source page has a content stream reference");
  const objectStart = source.indexOf(`${contentsObject} 0 obj\n`);
  const streamStart = source.indexOf("stream\n", objectStart);
  const header = source.slice(objectStart, streamStart);
  const length = Number(header.match(/\/Length (\d+)/)?.[1]);
  assert.ok(Number.isSafeInteger(length), "source content stream has a byte length");
  return source.slice(streamStart + 7, streamStart + 7 + length);
}

test("creates ordered image pages with matching dimensions", async () => {
  const first = new Uint8Array([0xff, 0xd8, 0x01, 0xff, 0xd9]);
  const second = new Uint8Array([0xff, 0xd8, 0x02, 0xff, 0xd9]);
  const pdf = createPdfFromJpegs([
    { jpeg: first, width: 320, height: 240 },
    { jpeg: second, width: 640, height: 480 },
  ]);
  const source = decode(pdf);

  assert.equal(source.slice(0, 8), "%PDF-1.3");
  assert.match(source, /\/Count 2/);
  assert.match(source, /\/MediaBox \[0 0 320 240\]/);
  assert.match(source, /\/MediaBox \[0 0 640 480\]/);
  assert.match(source, /\/Width 320 \/Height 240/);
  assert.match(source, /\/Width 640 \/Height 480/);
  assert.ok(pdf.indexOf(first[2]) < pdf.indexOf(second[2]), "JPEG payload order is preserved");
  assert.match(source, /startxref\n\d+\n%%EOF/);

  const blob = createPdf([{ jpeg: first, width: 320, height: 240 }]);
  assert.equal(blob.type, "application/pdf");
  assert.equal((await blob.arrayBuffer()).byteLength > 0, true);
});

test("Blob経路はJPEGとFlate画像の元payloadをpartsとして保持し、従来APIと同じxrefを出力する", async () => {
  const firstStorage = new Uint8Array(1_048_578).fill(0xa1);
  const first = firstStorage.subarray(1, firstStorage.length - 1);
  const rgbPixels = new Uint8Array(1_048_576);
  let random = 0x1234_5678;
  for (let index = 0; index < rgbPixels.length; index += 1) {
    random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0;
    rgbPixels[index] = random >>> 24;
  }
  const second = new Uint8Array(deflateSync(rgbPixels));
  const images = [
    {jpeg: first, width: 320, height: 240},
    {rgbFlate: second, width: 640, height: 480},
  ];
  const nativeBlob = globalThis.Blob;
  let blobParts = [];
  let blob;
  globalThis.Blob = class extends nativeBlob {
    constructor(parts, options) {
      blobParts = [...parts];
      super(parts, options);
    }
  };
  try {
    blob = createPdf(images, {heading: "Source", filename: "large.pdf", url: "https://example.test/large.pdf"});
  } finally {
    globalThis.Blob = nativeBlob;
  }

  assert.equal(blob.type, "application/pdf");
  assert.equal(blobParts.filter(part => part === first).length, 1);
  assert.equal(blobParts.filter(part => part === second).length, 1);

  const blobBytes = new Uint8Array(await blob.arrayBuffer());
  const legacyBytes = createPdfFromJpegs(images, {heading: "Source", filename: "large.pdf", url: "https://example.test/large.pdf"});
  assert.deepEqual(blobBytes, legacyBytes);
  assertValidXref(blobBytes);
  assert.match(decode(blobBytes), /\/Filter \/DCTDecode/);
  assert.match(decode(blobBytes), /\/Filter \/FlateDecode/);
  assert.deepEqual(imageStreams(blobBytes), [first, second]);
});

test("SharedArrayBufferを使う画像もBlobとUint8Array APIで同じ内容を保つ", async () => {
  if (typeof SharedArrayBuffer === "undefined") return;
  const jpeg = new Uint8Array(new SharedArrayBuffer(4));
  jpeg.set([0xff, 0xd8, 0xff, 0xd9]);
  const images = [{jpeg, width: 1, height: 1}];

  const blobBytes = new Uint8Array(await createPdf(images).arrayBuffer());
  assert.deepEqual(blobBytes, createPdfFromJpegs(images));
});

test("creates an empty PDF and rejects malformed image dimensions", () => {
  const empty = decode(createPdfFromJpegs([]));
  assert.match(empty, /\/Count 0/);
  assert.match(empty, /\/Kids \[\]/);

  for (const dimensions of [
    { width: 0, height: 10 },
    { width: 10, height: -1 },
    { width: 1.5, height: 10 },
    { width: Number.NaN, height: 10 },
    { width: Number.POSITIVE_INFINITY, height: 10 },
  ]) {
    assert.throws(
      () => createPdfFromJpegs([{ jpeg: new Uint8Array([1]), ...dimensions }]),
      RangeError,
    );
  }
});

test("appends an optional selectable Unicode source page and wraps long URLs", () => {
  const heading = "Source";
  const filename = "日本語📚éの資料.pdf";
  const url = `https://example.test/${"長いパス/".repeat(80)}終端`;
  const pdf = createPdfFromJpegs([
    { jpeg: new Uint8Array([0xff, 0xd8, 0x01, 0xff, 0xd9]), width: 320, height: 240 },
  ], { heading, filename, url });
  const source = decode(pdf);

  assert.equal(source.slice(0, 8), "%PDF-1.5");
  assert.match(source, /\/Count 2/);
  assert.match(source, /\/MediaBox \[0 0 595 842\]/);
  assert.match(source, /\/Subtype \/Type0/);
  assert.match(source, /\/Encoding \/UniJIS-UTF16-H/);
  assert.match(source, /\/ToUnicode \d+ 0 R/);

  const content = readSourceContentStream(source);
  assert.ok(content.includes("BT") && content.includes("ET"), "source page has a text content stream");
  const textParts = [...content.matchAll(/\/(F[12]) \S+ Tf 1 0 0 1 [^ ]+ [^ ]+ Tm <([0-9a-f]+)> Tj/g)]
    .map(match => match[1] === "F1" ? decodeUtf16Hex(match[2]) : decodeAsciiHex(match[2]));
  const displayed = textParts.join("");
  assert.ok(displayed.includes(heading));
  assert.ok(displayed.includes(filename));
  assert.ok(displayed.includes(url), "the complete URL is present across wrapped lines");
  assert.ok(source.includes(`<${asciiHex(heading)}>`));
  assert.ok(source.includes(`<${utf16Hex("日本語📚")}>`));
  assert.ok(source.includes(`<${utf16Hex("の資料")}>`));

  const yPositions = [...content.matchAll(/1 0 0 1 48(?:\.000)? ([0-9.]+) Tm/g)]
    .map(match => Number(match[1]));
  assert.ok(yPositions.length > 3);
  assert.ok(yPositions.every(y => y >= 48 && y <= 794), "wrapped source text remains inside the page");
});

test("uses the shared source layout for wrapped Unicode PDF text and explicit newlines", () => {
  const sourcePage = {
    heading: "Source\narchive",
    filename: `${"日本語📚".repeat(70)}.pdf`,
    url: `https://example.test/${"長いパス/\n".repeat(350)}final`,
  };
  const layout = createSourcePageLayout(sourcePage);
  const source = decode(createPdfFromJpegs([], sourcePage));
  const content = readSourceContentStream(source);
  const groupedRuns = new Map();
  for (const [, font, size, x, y, hex] of content.matchAll(
    /\/(F[12]) ([\d.]+) Tf 1 0 0 1 ([\d.]+) ([\d.]+) Tm <([0-9a-f]+)> Tj/g,
  )) {
    const line = groupedRuns.get(y) ?? [];
    line.push({x: Number(x), text: font === "F1" ? decodeUtf16Hex(hex) : decodeAsciiHex(hex)});
    groupedRuns.set(y, line);
  }
  const drawnLines = [...groupedRuns.entries()]
    .sort(([left], [right]) => Number(right) - Number(left))
    .map(([y, runs]) => ({
      y: Number(y),
      text: runs.sort((left, right) => left.x - right.x).map(run => run.text).join(""),
    }));
  const expectedLines = layout.lines.filter(line => line.text !== "").map(line => ({y: Number(line.y.toFixed(3)), text: line.text}));

  assert.ok(layout.lines.some(line => line.size < 10), "a very long URL lowers its shared font size");
  assert.deepEqual(drawnLines, expectedLines, "PDF text line breaks and baselines come from the shared layout");
  assert.match(source, /<d83ddcda> <d83ddcda>/, "supplementary Unicode remains selectable through the ToUnicode map");
});

test("draws supplied Unicode glyphs as images and maps invisible copy text", () => {
  const heading = "Source A日📚";
  const filename = "資料.pdf";
  const url = "https://example.test/";
  const characters = [...new Set([...heading, ...filename, ...url].filter(character => character.codePointAt(0) > 0xff))];
  const glyphs = Object.fromEntries(characters.map((character, index) => [character, {
    rgbFlate: new Uint8Array([index + 1]),
    width: 96,
    height: 96,
  }]));
  const pdf = createPdfFromJpegs([], { heading, filename, url, glyphs });
  const source = decode(pdf);
  const content = readSourceContentStream(source);

  assert.equal(source.slice(0, 8), "%PDF-1.5");
  assert.equal(imageStreams(pdf).length, characters.length);
  assert.match(source, /\/XObject << \/G0 \d+ 0 R/);
  assert.ok(characters.every((_, index) => content.includes(`/G${index} Do`)));
  assert.ok((content.match(/\b3 Tr\b/g) ?? []).length > 0);
  assert.match(source, /<21> <65e5>/);
  assert.match(source, /<22> <d83ddcda>/);
  assert.doesNotMatch(content, /\/F1 \d+ Tf/);
  const copyMappings = new Map([...source.matchAll(/<([0-9a-f]{2})> <([0-9a-f]{4,8})>/g)]
    .filter(([, code, unicode]) => code.length === 2 && unicode.length >= 4)
    .map(([, code, unicode]) => [code, decodeUtf16Hex(unicode)]));
  const copiedCodes = [...content.matchAll(/\/F3 \d+ Tf 166\.667 Tz 3 Tr 1 0 0 1 [^ ]+ [^ ]+ Tm <([0-9a-f]+)> Tj/g)]
    .flatMap(([, hex]) => hex.match(/.{2}/g) ?? []);
  assert.equal(copiedCodes.map(code => copyMappings.get(code)).join(""), "日📚資料");

  const normalized = decode(createPdfFromJpegs([], {
    heading: "\ud800",
    filename: "",
    url: "",
    glyphs: { "\ud800": { rgbFlate: new Uint8Array([1]), width: 1, height: 1 } },
  }));
  assert.match(normalized, /<21> <fffd>/);
  assert.match(normalized, /<fffd> <fffd>/);
  assert.doesNotMatch(normalized, /<d800> <d800>/);
});

test("starts another one-byte copy font after 94 distinct glyphs", () => {
  const heading = Array.from({ length: 95 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join("");
  const glyphs = Object.fromEntries([...heading].map((character, index) => [character, {
    rgbFlate: new Uint8Array([index + 1]),
    width: 96,
    height: 96,
  }]));
  const pdf = createPdfFromJpegs([], { heading, filename: "", url: "", glyphs });
  const source = decode(pdf);
  const content = readSourceContentStream(source);

  assert.match(source, /\/F3 \d+ 0 R/);
  assert.match(source, /\/F4 \d+ 0 R/);
  assert.match(content, /\/F3 18 Tf 166\.667 Tz 3 Tr/);
  assert.match(content, /\/F4 18 Tf 166\.667 Tz 3 Tr/);
  assert.match(source, /<7e> <4e5d>/);
  assert.match(source, /<21> <4e5e>/);
  assert.equal(imageStreams(pdf).length, 95);
});

test("maps supplementary characters as single UTF-16 codes for source text extraction", () => {
  const heading = "Source 📚";
  const filename = "資料📚é.pdf";
  const url = "https://example.test/📚/日本語";
  const source = decode(createPdfFromJpegs([], { heading, filename, url }));
  const cmap = source.slice(source.indexOf("begincmap"), source.indexOf("endcmap"));
  assert.match(cmap, /3 begincodespacerange\n<0000> <D7FF>\n<E000> <FFFF>\n<D800DC00> <DBFFDFFF>/);
  assert.match(cmap, /<d83ddcda> <d83ddcda>/);
  assert.doesNotMatch(cmap, /<d83d> <d83d>|<dcda> <dcda>/);

  const mappings = new Map([...cmap.matchAll(/<([0-9a-f]+)> <([0-9a-f]+)>/g)]
    .filter(match => match[1] === match[2] && !["0000", "e000", "d800dc00"].includes(match[1]))
    .map(match => [match[1], decodeUtf16Hex(match[2])]));
  const content = readSourceContentStream(source);
  const extracted = [...content.matchAll(/\/(F[12]) \S+ Tf 1 0 0 1 [^ ]+ [^ ]+ Tm <([0-9a-f]+)> Tj/g)]
    .map(([, font, hex]) => {
      if (font === "F2") return decodeAsciiHex(hex);
      let result = "";
      for (let index = 0; index < hex.length;) {
        const length = Number.parseInt(hex.slice(index, index + 4), 16) >= 0xd800 &&
          Number.parseInt(hex.slice(index, index + 4), 16) <= 0xdbff ? 8 : 4;
        const character = mappings.get(hex.slice(index, index + length));
        assert.ok(character, `missing ToUnicode mapping at ${index}`);
        result += character;
        index += length;
      }
      return result;
    }).join("");
  assert.ok(extracted.includes(heading));
  assert.ok(extracted.includes(filename));
  assert.ok(extracted.includes(url));
});

test("embeds mixed JPEG and Flate RGB streams without changing payload bytes", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0x11, 0xff, 0xd9]);
  const rgbFlate = new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x64, 0x00]);
  const pdf = createPdfFromJpegs([
    { jpeg, width: 3, height: 2 },
    { rgbFlate, width: 5, height: 4 },
  ]);
  const source = decode(pdf);
  assert.match(source, /\/Filter \/DCTDecode/);
  assert.match(source, /\/Filter \/FlateDecode/);
  assert.match(source, /\/MediaBox \[0 0 5 4\]/);
  assert.deepEqual(imageStreams(pdf), [jpeg, rgbFlate]);
  assert.equal(source.match(/xref\n0 9\n/)?.[0], "xref\n0 9\n");
});

test("extracts intrinsic dimensions only for supported JFIF RGB JPEGs", () => {
  const jpeg = baselineJpeg;
  assert.deepEqual(getOriginalJpegPage(jpeg), { jpeg, width: 3, height: 2 });
  assert.equal(getOriginalJpegPage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
  assert.equal(getOriginalJpegPage(exifJpeg), null);
  assert.equal(getOriginalJpegPage(new Uint8Array([...jpeg.slice(0, 20), 0xff, 0xee, 0, 2, ...jpeg.slice(20)])), null);
  assert.equal(getOriginalJpegPage(new Uint8Array([...jpeg.slice(0, 20), 0xff, 0xc4, 0, 2, ...jpeg.slice(20)])), null);
});

test("rejects missing, empty, or ambiguous image payloads", () => {
  assert.throws(() => createPdfFromJpegs([{ width: 1, height: 1 }]), TypeError);
  assert.throws(() => createPdfFromJpegs([{ jpeg: new Uint8Array(), width: 1, height: 1 }]), RangeError);
  assert.throws(() => createPdfFromJpegs([{ jpeg: new Uint8Array([1]), rgbFlate: new Uint8Array([2]), width: 1, height: 1 }]), TypeError);
  assert.throws(() => createPdfFromJpegs([{ rgbFlate: new Uint8Array([1]), width: 1.5, height: 1 }]), RangeError);
});
