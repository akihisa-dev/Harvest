import assert from "node:assert/strict";
import test from "node:test";
import { createPdf, createPdfFromJpegs } from "../dist/extension/core/pdf.js";

const decode = (bytes) => new TextDecoder().decode(bytes);

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
