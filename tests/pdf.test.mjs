import assert from "node:assert/strict";
import test from "node:test";
import { createPdf, createPdfFromJpegs, getOriginalJpegPage } from "../dist/extension/core/pdf.js";

const decode = (bytes) => new TextDecoder().decode(bytes);
const ascii = (value) => new TextEncoder().encode(value);

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
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x0e, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x00, 0xff, 0xd9,
  ]);
  assert.deepEqual(getOriginalJpegPage(jpeg), { jpeg, width: 3, height: 2 });
  assert.equal(getOriginalJpegPage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
  assert.equal(getOriginalJpegPage(new Uint8Array([...jpeg.slice(0, 18), 0xff, 0xee, 0x00, 0x02])), null);
  assert.equal(getOriginalJpegPage(new Uint8Array([...jpeg.slice(0, 18), 0xff, 0xe1, 0x00, 0x02, ...jpeg.slice(18)])), null);
  assert.deepEqual(
    getOriginalJpegPage(new Uint8Array([...jpeg.slice(0, 18), 0xff, 0xc4, 0x00, 0x02, ...jpeg.slice(18)])),
    { jpeg: new Uint8Array([...jpeg.slice(0, 18), 0xff, 0xc4, 0x00, 0x02, ...jpeg.slice(18)]), width: 3, height: 2 },
  );
});

test("rejects missing, empty, or ambiguous image payloads", () => {
  assert.throws(() => createPdfFromJpegs([{ width: 1, height: 1 }]), TypeError);
  assert.throws(() => createPdfFromJpegs([{ jpeg: new Uint8Array(), width: 1, height: 1 }]), RangeError);
  assert.throws(() => createPdfFromJpegs([{ jpeg: new Uint8Array([1]), rgbFlate: new Uint8Array([2]), width: 1, height: 1 }]), TypeError);
  assert.throws(() => createPdfFromJpegs([{ rgbFlate: new Uint8Array([1]), width: 1.5, height: 1 }]), RangeError);
});
