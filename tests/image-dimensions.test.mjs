import assert from "node:assert/strict";
import test from "node:test";
import {getImageDimensions} from "../dist/extension/core/image-dimensions.js";

function putAscii(bytes, offset, value) {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  putAscii(bytes, 12, "IHDR");
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function box(type, payload) {
  const bytes = new Uint8Array(8 + payload.length);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  putAscii(bytes, 4, type);
  bytes.set(payload, 8);
  return bytes;
}

function join(...parts) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

test("PNG・JPEG・GIF・WebP・BMP・AVIFの画像ヘッダーから寸法を読む", () => {
  assert.deepEqual(getImageDimensions(pngHeader(8_001, 8_000)), {width: 8_001, height: 8_000});

  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    0x1f, 0x40, 0x1f, 0x41, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  ]);
  assert.deepEqual(getImageDimensions(jpeg), {width: 8_001, height: 8_000});

  const gif = new Uint8Array(10);
  putAscii(gif, 0, "GIF89a");
  new DataView(gif.buffer).setUint16(6, 8_001, true);
  new DataView(gif.buffer).setUint16(8, 8_000, true);
  assert.deepEqual(getImageDimensions(gif), {width: 8_001, height: 8_000});

  const gifFrame = new Uint8Array(26);
  putAscii(gifFrame, 0, "GIF89a");
  new DataView(gifFrame.buffer).setUint16(6, 1, true);
  new DataView(gifFrame.buffer).setUint16(8, 1, true);
  gifFrame[13] = 0x2c;
  new DataView(gifFrame.buffer).setUint16(18, 8_001, true);
  new DataView(gifFrame.buffer).setUint16(20, 8_000, true);
  assert.deepEqual(getImageDimensions(gifFrame), {width: 8_001, height: 8_000}, "an oversized GIF frame is caught even when its logical canvas is small");

  const webp = new Uint8Array(30);
  putAscii(webp, 0, "RIFF");
  new DataView(webp.buffer).setUint32(4, 22, true);
  putAscii(webp, 8, "WEBP");
  putAscii(webp, 12, "VP8X");
  new DataView(webp.buffer).setUint32(16, 10, true);
  webp[24] = 0x40;
  webp[25] = 0x1f;
  webp[26] = 0;
  webp[27] = 0x3f;
  webp[28] = 0x1f;
  webp[29] = 0;
  assert.deepEqual(getImageDimensions(webp), {width: 8_001, height: 8_000});

  const lossyWebp = new Uint8Array(30);
  putAscii(lossyWebp, 0, "RIFF");
  new DataView(lossyWebp.buffer).setUint32(4, 22, true);
  putAscii(lossyWebp, 8, "WEBP");
  putAscii(lossyWebp, 12, "VP8 ");
  new DataView(lossyWebp.buffer).setUint32(16, 10, true);
  lossyWebp.set([0, 0, 0, 0x9d, 0x01, 0x2a], 20);
  new DataView(lossyWebp.buffer).setUint16(26, 8_001, true);
  new DataView(lossyWebp.buffer).setUint16(28, 8_000, true);
  assert.deepEqual(getImageDimensions(lossyWebp), {width: 8_001, height: 8_000});

  const losslessWebp = new Uint8Array(26);
  putAscii(losslessWebp, 0, "RIFF");
  new DataView(losslessWebp.buffer).setUint32(4, 18, true);
  putAscii(losslessWebp, 8, "WEBP");
  putAscii(losslessWebp, 12, "VP8L");
  new DataView(losslessWebp.buffer).setUint32(16, 5, true);
  losslessWebp[20] = 0x2f;
  new DataView(losslessWebp.buffer).setUint32(21, 8_000 | (7_999 << 14), true);
  assert.deepEqual(getImageDimensions(losslessWebp), {width: 8_001, height: 8_000});

  const bmp = new Uint8Array(54);
  putAscii(bmp, 0, "BM");
  new DataView(bmp.buffer).setUint32(14, 40, true);
  new DataView(bmp.buffer).setInt32(18, 8_001, true);
  new DataView(bmp.buffer).setInt32(22, -8_000, true);
  assert.deepEqual(getImageDimensions(bmp), {width: 8_001, height: 8_000});

  const ispePayload = new Uint8Array(12);
  new DataView(ispePayload.buffer).setUint32(4, 8_001);
  new DataView(ispePayload.buffer).setUint32(8, 8_000);
  const primaryItem = new Uint8Array([0, 0, 0, 0, 0, 1]);
  const propertyAssociation = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1]);
  const meta = box("meta", join(
    new Uint8Array(4),
    box("pitm", primaryItem),
    box("iprp", join(box("ipco", box("ispe", ispePayload)), box("ipma", propertyAssociation))),
  ));
  const fileType = box("ftyp", new Uint8Array([97, 118, 105, 102, 0, 0, 0, 0, 97, 118, 105, 102]));
  assert.deepEqual(getImageDimensions(join(fileType, meta)), {width: 8_001, height: 8_000});
});

test("寸法情報のないデータや途中で切れたヘッダーは画像寸法として扱わない", () => {
  assert.equal(getImageDimensions(new Uint8Array([1, 2, 3])), null);
  assert.equal(getImageDimensions(pngHeader(1, 1).subarray(0, 20)), null);
});

test("SVGの明示寸法を外部資源の解決なしで確認する", () => {
  const read = text => getImageDimensions(new TextEncoder().encode(text));
  assert.deepEqual(read('<svg width="16385" height="1"/>'), {width: 16385, height: 1});
  assert.deepEqual(read('<?xml version="1.0"?><!-- <svg width="99999" height="99999"/> --><svg width="8001px" height="8000"/>'), {width: 8001, height: 8000});
  assert.deepEqual(read('<svg xmlns="http://www.w3.org/2000/svg" width="2.5" height="2"/>'), {width: 3, height: 2});
  for (const text of ['<svg width="100%" height="2"/>', '<svg viewBox="0 0 16385 1"/>', '<svg width="2cm" height="2"/>', '<!DOCTYPE svg SYSTEM "https://example.test/a"><svg width="2" height="2"/>', '<svg width="2" width="16385" height="2"/>', '<!-- <svg width="16385" height="1"/> -->']) assert.equal(read(text), null);
});

test("多数のISOボックスと非AVIFブランドを安全に走査する", () => {
  const free = box("free", new Uint8Array());
  for (const size of [1,2,4]) {
    const bytes = new Uint8Array(size*1024*1024);
    for(let offset=0;offset<bytes.length;offset+=8) bytes.set(free,offset);
    assert.equal(getImageDimensions(bytes),null);
    const ftyp = box("ftyp", new TextEncoder().encode("junk\0\0\0\0junk"));
    assert.equal(getImageDimensions(join(ftyp,bytes)),null);
  }
  const avif = box("ftyp",new TextEncoder().encode("avif\0\0\0\0avif"));
  assert.equal(getImageDimensions(join(avif,new Uint8Array([0,0,0,7,102,114,101,101]))),null);
  assert.equal(getImageDimensions(box("ftyp",new TextEncoder().encode("junkavifjunk"))),null,"minor version is not a brand");
});
