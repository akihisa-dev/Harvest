import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { toPdfPage } from "../dist/extension/app/pdf-image.js";

test("最高画質は元の画素と寸法を保ち、通常保存だけJPEGへ変換する", async () => {
  const previous = { fetch: globalThis.fetch, document: globalThis.document, createImageBitmap: globalThis.createImageBitmap };
  let closed = 0;
  let jpegConversions = 0;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({fillRect() {}, drawImage() {}, getImageData: () => ({data: new Uint8ClampedArray([12, 34, 56, 255, 78, 90, 123, 255])})}),
    toBlob(callback, type, quality) {
      jpegConversions++;
      assert.equal(type, "image/jpeg");
      assert.equal(quality, 0.72);
      callback(new Blob([new Uint8Array([1, 2, 3])], {type}));
    },
  };
  globalThis.fetch = async () => ({ok: true, blob: async () => new Blob([new Uint8Array([1])], {type: "image/png"})});
  globalThis.document = {createElement: () => canvas};
  globalThis.createImageBitmap = async () => ({width: 2, height: 1, close() { closed++; }});
  try {
    const page = await toPdfPage("https://example.com/image.png", true);
    assert.equal(page.width, 2);
    assert.equal(page.height, 1);
    assert.deepEqual([...inflateSync(page.rgbFlate)], [12, 34, 56, 78, 90, 123]);
    assert.equal(jpegConversions, 0);
    const normal = await toPdfPage("https://example.com/image.png", false);
    assert.deepEqual([...normal.jpeg], [1, 2, 3]);
    assert.equal(jpegConversions, 1);
    assert.equal(closed, 2);
  } finally {
    Object.assign(globalThis, previous);
  }
});
