import assert from "node:assert/strict";
import test from "node:test";

test("応答が中断を無視してもキャンセルは即座に完了し、未開始画像を取得しない", async () => {
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  const fetched = [];
  globalThis.fetch = async url => { fetched.push(url); return new Promise(() => {}); };
  try {
    const work = preparePdfImages(["a", "b", "c", "d", "e"].map(url => ({url})), () => {}, {signal: controller.signal});
    const rejected = assert.rejects(work, error => error instanceof PdfImageError && error.kind === "cancelled");
    controller.abort();
    await rejected;
    assert.deepEqual(fetched, ["a", "b", "c"]);
  } finally { globalThis.fetch = previousFetch; }
});
import { inflateSync } from "node:zlib";
import { PdfImageError, preparePdfImages, toPdfPage } from "../dist/extension/app/pdf-image.js";

test("設定なしで元の画素と寸法を保ち、JPEGへ再圧縮しない", async () => {
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
    const page = await toPdfPage("https://example.com/image.png");
    assert.equal(page.width, 2);
    assert.equal(page.height, 1);
    assert.deepEqual([...inflateSync(page.rgbFlate)], [12, 34, 56, 78, 90, 123]);
    assert.equal(jpegConversions, 0);
    assert.equal(closed, 1);
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("対応するJFIF JPEGは取得したバイト列と寸法をそのまま使う", async () => {
  const previous = { fetch: globalThis.fetch, createImageBitmap: globalThis.createImageBitmap };
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x0e, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x00, 0xff, 0xd9,
  ]);
  let decoded = 0;
  globalThis.fetch = async () => ({ok: true, status: 200, blob: async () => new Blob([jpeg], {type: "image/jpeg"})});
  globalThis.createImageBitmap = async () => {
    decoded += 1;
    return {width: 3, height: 2, close() {}};
  };
  try {
    const page = await toPdfPage("https://example.com/original.jpg");
    assert.deepEqual([...page.jpeg], [...jpeg]);
    assert.equal(page.width, 3);
    assert.equal(page.height, 2);
    assert.equal(decoded, 0);
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("HTTP失敗・通信失敗・画像形式不正を利用者向け理由へ変換する", async () => {
  const previous = { fetch: globalThis.fetch };
  try {
    globalThis.fetch = async () => ({ok: false, status: 404, blob: async () => new Blob()});
    await assert.rejects(toPdfPage("https://example.com/missing"), (error) => {
      assert(error instanceof PdfImageError);
      assert.equal(error.kind, "http");
      assert.match(error.message, /画像が見つかりません/);
      return true;
    });

    globalThis.fetch = async () => { throw new Error("private network detail"); };
    await assert.rejects(toPdfPage("https://example.com/offline"), (error) => {
      assert(error instanceof PdfImageError);
      assert.equal(error.kind, "network");
      assert.doesNotMatch(error.message, /private network detail/);
      return true;
    });

    globalThis.fetch = async () => ({ok: true, status: 200, blob: async () => new Blob(["not an image"], {type: "text/html"})});
    await assert.rejects(toPdfPage("https://example.com/page"), (error) => {
      assert(error instanceof PdfImageError);
      assert.equal(error.kind, "invalid-image");
      assert.match(error.message, /画像データではありません/);
      return true;
    });
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("応答待ちの上限でAbortし、応答本文も後始末する", async () => {
  const previous = { fetch: globalThis.fetch };
  let signal;
  let cancelled = 0;
  globalThis.fetch = async (_url, options) => {
    signal = options.signal;
    const body = {bodyUsed: false, async cancel() { body.bodyUsed = true; cancelled += 1; }};
    const response = {
      ok: true,
      status: 200,
      body,
      bodyUsed: false,
      blob: async () => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          body.bodyUsed = true;
          reject(new DOMException("Aborted", "AbortError"));
        }, {once: true});
      }),
    };
    body.cancel = async () => { response.bodyUsed = true; cancelled += 1; };
    return response;
  };
  try {
    await assert.rejects(toPdfPage("https://example.com/slow", {timeoutMs: 10}), (error) => {
      assert(error instanceof PdfImageError);
      assert.equal(error.kind, "timeout");
      assert.match(error.message, /時間がかかりすぎ/);
      return true;
    });
    assert.equal(signal.aborted, true);
    assert.equal(cancelled, 1);
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("取得は少数並列、画素変換は逐次、結果は入力順で通知する", async () => {
  const previous = { fetch: globalThis.fetch, document: globalThis.document, createImageBitmap: globalThis.createImageBitmap };
  let activeFetches = 0;
  let maxFetches = 0;
  let activeConversions = 0;
  let maxConversions = 0;
  const delays = new Map([["a", 30], ["b", 0], ["c", 0], ["d", 0]]);
  globalThis.fetch = async (url) => {
    activeFetches += 1;
    maxFetches = Math.max(maxFetches, activeFetches);
    await new Promise((resolve) => setTimeout(resolve, delays.get(url) ?? 0));
    activeFetches -= 1;
    return {ok: true, status: 200, blob: async () => new Blob([url], {type: "image/png"})};
  };
  globalThis.createImageBitmap = async () => ({
    width: 1,
    height: 2,
    close() { activeConversions -= 1; },
  });
  globalThis.document = {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: "",
          fillRect() {},
          drawImage() {
            activeConversions += 1;
            maxConversions = Math.max(maxConversions, activeConversions);
          },
          getImageData: () => ({data: new Uint8ClampedArray([12, 34, 56, 255])}),
        }),
      };
      return canvas;
    },
  };
  try {
    const items = ["a", "b", "c", "d"].map(url => ({url}));
    const results = [];
    await preparePdfImages(items, (item, result) => results.push([item.url, result]), {
      fetchConcurrency: 2,
      pixelRowsPerChunk: 1,
      timeoutMs: 1_000,
    });
    assert.deepEqual(results.map(([url]) => url), ["a", "b", "c", "d"]);
    assert.equal(results.every(([, result]) => !(result instanceof PdfImageError)), true);
    assert.equal(maxFetches <= 2, true);
    assert.equal(maxConversions, 1);
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("結果通知の失敗でも待機中の取得を解放する", async () => {
  const previous = { fetch: globalThis.fetch };
  globalThis.fetch = async () => ({ok: true, status: 200, blob: async () => new Blob(["image"], {type: "image/png"})});
  try {
    await assert.rejects(
      preparePdfImages([{url: "a"}, {url: "b"}, {url: "c"}, {url: "d"}], () => {
        throw new Error("callback failed");
      }, {fetchConcurrency: 3, timeoutMs: 1_000}),
      /callback failed/,
    );
  } finally {
    Object.assign(globalThis, previous);
  }
});
