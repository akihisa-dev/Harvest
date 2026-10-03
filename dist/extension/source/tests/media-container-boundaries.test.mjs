import assert from "node:assert/strict";
import test from "node:test";
import {getImageDimensions} from "../dist/extension/core/image-dimensions.js";
import {originalMediaType} from "../dist/extension/core/media-types.js";
import {hasCompleteGif, hasCompleteMp4Boxes} from "../dist/extension/core/original-media-structure.js";
import {gifBytes} from "./media-fixtures.mjs";

const text = value => new TextEncoder().encode(value);
const join = (...parts) => new Uint8Array(Buffer.concat(parts));
function box(type, data = new Uint8Array(), encoding = "standard") {
  const header = encoding === "extended" ? 16 : 8;
  const bytes = new Uint8Array(header + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, encoding === "remaining" ? 0 : encoding === "extended" ? 1 : bytes.length);
  bytes.set(text(type), 4);
  if (encoding === "extended") view.setBigUint64(8, BigInt(bytes.length));
  bytes.set(data, header);
  return bytes;
}
function avif(encoding) {
  const dimensions = new Uint8Array(12);
  const view = new DataView(dimensions.buffer);
  view.setUint32(4, 17);
  view.setUint32(8, 23);
  return join(box("ftyp", text("avif\0\0\0\0avif"), encoding), box("meta", join(
    new Uint8Array(4), box("pitm", new Uint8Array([0, 0, 0, 0, 0, 1])),
    box("iprp", join(box("ipco", box("ispe", dimensions, encoding)),
      box("ipma", new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1])))),
  ), encoding));
}

test("AVIFとMP4は32/64ビット長と開始位置が0以外の入力を同じように扱う", () => {
  for (const encoding of ["standard", "extended"]) {
    const source = avif(encoding);
    const framed = join(new Uint8Array(5), source, new Uint8Array(7));
    const bytes = framed.subarray(5, 5 + source.length);
    assert.deepEqual(getImageDimensions(bytes), {width: 17, height: 23});
    assert.equal(originalMediaType("image/avif").matches(bytes), true);
    const movie = join(box("ftyp", text("isom\0\0\0\0mp42"), encoding),
      box("moov", box("trak"), encoding), box("mdat", new Uint8Array([1]), encoding));
    assert.equal(originalMediaType("video/mp4").matches(movie), true);
    assert.equal(hasCompleteMp4Boxes(movie), true);
    for (let removed = 1; removed <= 8; removed += 1) {
      assert.equal(hasCompleteMp4Boxes(movie.subarray(0, movie.length - removed)), false);
    }
    assert.equal(getImageDimensions(join(bytes, new Uint8Array([0]))), null);
  }
});

test("ISOコンテナの終端までの長さとMIME判定の明示長という異なる規則を維持する", () => {
  const movie = join(box("moov"), box("mdat", new Uint8Array([1]), "remaining"));
  assert.equal(hasCompleteMp4Boxes(movie), true);
  assert.equal(originalMediaType("video/mp4").matches(box("ftyp", text("isom\0\0\0\0mp42"), "remaining")), false);
  const corruptChild = box("trak", new Uint8Array(), "extended");
  const parent = box("moov", corruptChild.subarray(0, 8));
  assert.equal(hasCompleteMp4Boxes(join(parent, corruptChild.subarray(8), box("mdat", new Uint8Array([1])))), false,
    "extended header bytes after the parent must not rescue a truncated child");
  const unsafe = box("moov", new Uint8Array(), "extended");
  new DataView(unsafe.buffer).setBigUint64(8, 0x20_0000_0000_0000n);
  assert.equal(hasCompleteMp4Boxes(join(unsafe, box("mdat", new Uint8Array([1])))), false);
});

test("MP4の入れ子深さとMIMEブランド確認の4096バイト上限を維持する", () => {
  for (const depth of [16, 17]) {
    let nested = new Uint8Array();
    for (let level = 0; level < depth; level += 1) nested = box("moov", nested);
    assert.equal(hasCompleteMp4Boxes(join(nested, box("mdat", new Uint8Array([1])))), depth === 16);
  }
  const payload = new Uint8Array(4100);
  payload.set(text("junk"));
  payload.set(text("avif"), 4096 - 8);
  assert.equal(originalMediaType("image/avif").matches(box("ftyp", payload)), false);
  payload.set(text("avif"), 4092 - 8);
  assert.equal(originalMediaType("image/avif").matches(box("ftyp", payload)), true);
});

test("GIFの寸法取得は途中のデータを許し、原本保存は終端とフレームを要求する", () => {
  assert.equal(hasCompleteGif(gifBytes), true);
  const dimensions = getImageDimensions(gifBytes);
  assert.ok(dimensions);
  assert.deepEqual(getImageDimensions(gifBytes.subarray(0, 10)), dimensions);
  assert.equal(hasCompleteGif(gifBytes.subarray(0, 10)), false);
  assert.deepEqual(getImageDimensions(gifBytes.subarray(0, gifBytes.length - 1)), dimensions);
  assert.equal(hasCompleteGif(gifBytes.subarray(0, gifBytes.length - 1)), false);
  assert.equal(hasCompleteGif(join(gifBytes, new Uint8Array([0xff]))), true);
});
