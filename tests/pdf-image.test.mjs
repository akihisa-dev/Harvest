import {baselineJpeg, exifJpeg} from "./jpeg-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import {deflateSync} from "node:zlib";
import {readImageBytes} from "../dist/extension/app/image-fetch.js";
import {IMAGE_TOO_LARGE_MESSAGE, MAX_IMAGE_BYTES} from "../dist/extension/app/image-data-contract.js";
import {inflateSync} from "node:zlib";
import {PdfImageError, preparePdfImages, toPdfPage} from "../dist/extension/app/pdf-image.js";

function pngChunk(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < type.length; index += 1) chunk[4 + index] = type.charCodeAt(index);
  chunk.set(data, 8);
  let crc = 0xffff_ffff;
  for (const byte of chunk.subarray(4, 8 + data.length)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0);
  }
  view.setUint32(8 + data.length, (crc ^ 0xffff_ffff) >>> 0);
  return chunk;
}

function compressedOversizedPng(width, height) {
  const rowBytes = Math.ceil(width / 8);
  const rawPixels = new Uint8Array((rowBytes + 1) * height);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 1;
  header[9] = 0;
  const chunks = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rawPixels)),
    pngChunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
}

test("応答が中断を無視してもキャンセルは即座に完了し、未開始画像を取得しない", async () => {
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  const fetched = [];
  globalThis.fetch = async url => {
    fetched.push(url);
    return new Promise(() => {});
  };
  try {
    const urls = ["a", "b", "c", "d", "e"].map(name => `https://example.test/${name}`);
    const work = preparePdfImages(urls.map(url => ({url})), () => {}, {signal: controller.signal});
    const rejected = assert.rejects(work, error => error instanceof PdfImageError && error.kind === "cancelled");
    controller.abort();
    await rejected;
    assert.deepEqual(fetched, urls.slice(0, 3));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("設定なしで元の画素と寸法を保ち、JPEGへ再圧縮しない", async () => {
  const previous = {fetch: globalThis.fetch, document: globalThis.document, createImageBitmap: globalThis.createImageBitmap};
  let closed = 0;
  let jpegConversions = 0;
  const canvas = {
    width: 0,
    height: 0,
    getContext: (type, options) => {
      assert.equal(type, "2d");
      assert.deepEqual(options, {willReadFrequently: true});
      return {
        fillRect() {},
        drawImage() {},
        getImageData: () => ({data: new Uint8ClampedArray([12, 34, 56, 255, 78, 90, 123, 255])})
      };
    },
    toBlob(callback, type, quality) {
      jpegConversions++;
      assert.equal(type, "image/jpeg");
      assert.equal(quality, 0.72);
      callback(new Blob([new Uint8Array([1, 2, 3])], {type}));
    },
  };
  globalThis.fetch = async () => new Response(new Uint8Array([1]), {headers: {"Content-Type": "image/png"}});
  globalThis.document = {createElement: () => canvas};
  globalThis.createImageBitmap = async blob => {
    assert.equal(blob.type, "image/png");
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1]);
    return {width: 2, height: 1, close() { closed++; } };
  };
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

test("非JPEG画像は画素を小分けに圧縮し、画像全体のRGB配列を作らない", async () => {
  const previous = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    createImageBitmap: globalThis.createImageBitmap,
    CompressionStream: globalThis.CompressionStream,
  };
  const width = 4;
  const height = 3;
  const rgba = new Uint8ClampedArray(Array.from({length: width * height}, (_, index) => [index + 1, index + 21, index + 41, 255]).flat());
  const reads = [];
  const compressedInputSizes = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillRect() {},
      drawImage() {},
      getImageData(x, y, chunkWidth, rows) {
        reads.push({x, y, width: chunkWidth, height: rows});
        const data = new Uint8ClampedArray(chunkWidth * rows * 4);
        let target = 0;
        for (let row = y; row < y + rows; row += 1) {
          for (let column = x; column < x + chunkWidth; column += 1) {
            const source = (row * width + column) * 4;
            data.set(rgba.subarray(source, source + 4), target);
            target += 4;
          }
        }
        return {data};
      },
    }),
  };
  globalThis.fetch = async () => new Response(new Uint8Array([1]), {headers: {"Content-Type": "image/webp"}});
  globalThis.document = {createElement: () => canvas};
  globalThis.createImageBitmap = async () => ({width, height, close() {} });
  globalThis.CompressionStream = class {
    constructor(format) {
      assert.equal(format, "deflate");
      return new TransformStream({
        transform(chunk, output) {
          compressedInputSizes.push(chunk.byteLength);
          output.enqueue(chunk);
        },
      });
    }
  };
  try {
    const page = await toPdfPage("https://example.com/image.webp", {pixelRowsPerChunk: 1});
    const expectedRgb = [];
    for (let index = 0; index < rgba.length; index += 4) expectedRgb.push(rgba[index], rgba[index + 1], rgba[index + 2]);
    const fullImageRgbBytes = width * height * 3;
    assert.equal(page.width, width);
    assert.equal(page.height, height);
    assert.deepEqual([...page.rgbFlate], expectedRgb, "RGB values and row-major order are preserved");
    assert.deepEqual(reads, [0, 1, 2].map(y => ({x: 0, y, width, height: 1})));
    assert.equal(compressedInputSizes.length, height, "compression receives each row as it is converted");
    assert.ok(Math.max(...compressedInputSizes) < fullImageRgbBytes, "the largest RGB buffer is smaller than the complete image");
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("大きな画像も既定の画素上限ごとにRGBを圧縮へ渡す", async () => {
  const previous = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    createImageBitmap: globalThis.createImageBitmap,
    CompressionStream: globalThis.CompressionStream,
  };
  const width = 512;
  const height = 1_536;
  const reads = [];
  const compressedInputSizes = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillRect() {},
      drawImage() {},
      getImageData(x, y, chunkWidth, rows) {
        reads.push({x, y, width: chunkWidth, height: rows});
        return {data: new Uint8ClampedArray(chunkWidth * rows * 4)};
      },
    }),
  };
  globalThis.fetch = async () => new Response(new Uint8Array([1]), {headers: {"Content-Type": "image/png"}});
  globalThis.document = {createElement: () => canvas};
  globalThis.createImageBitmap = async () => ({width, height, close() {} });
  globalThis.CompressionStream = class {
    constructor(format) {
      assert.equal(format, "deflate");
      return new TransformStream({
        transform(chunk, output) {
          compressedInputSizes.push(chunk.byteLength);
          output.enqueue(chunk);
        },
      });
    }
  };
  try {
    const page = await toPdfPage("https://example.com/large.png");
    const rgbBytesPerChunk = 512 * 512 * 3;
    const fullImageRgbBytes = width * height * 3;
    assert.equal(page.width, width);
    assert.equal(page.height, height);
    assert.equal(page.rgbFlate.byteLength, fullImageRgbBytes);
    assert.deepEqual(reads, [0, 512, 1_024].map(y => ({x: 0, y, width, height: 512})));
    assert.deepEqual(compressedInputSizes, [rgbBytesPerChunk, rgbBytesPerChunk, rgbBytesPerChunk]);
    assert.ok(Math.max(...compressedInputSizes) < fullImageRgbBytes, "the default path never sends one image-sized RGB chunk");
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("画素変換後の圧縮中に中止すると、完了を待たずに画像と描画領域を解放する", async () => {
  const previous = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    createImageBitmap: globalThis.createImageBitmap,
    CompressionStream: globalThis.CompressionStream,
  };
  const controller = new AbortController();
  let compressionStarted;
  const started = new Promise(resolve => { compressionStarted = resolve; });
  let closed = 0;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillRect() {}, drawImage() {},
      getImageData: () => ({data: new Uint8ClampedArray([1, 2, 3, 255])}),
    }),
  };
  globalThis.fetch = async () => new Response(new Uint8Array([1]), {headers: {"Content-Type": "image/png"}});
  globalThis.document = {createElement: () => canvas};
  globalThis.createImageBitmap = async () => ({width: 1, height: 1, close() { closed++; } });
  globalThis.CompressionStream = class {
    constructor(format) {
      assert.equal(format, "deflate");
      return new TransformStream({
        transform(chunk, output) { output.enqueue(chunk); },
        flush() {
          compressionStarted();
          return new Promise(() => {});
        },
      });
    }
  };
  try {
    const work = toPdfPage("https://example.com/image.png", {signal: controller.signal});
    await started;
    controller.abort();
    await Promise.race([
      assert.rejects(work, error => error instanceof PdfImageError && error.kind === "cancelled"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("圧縮完了を待っています")), 500)),
    ]);
    assert.equal(closed, 1);
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
  } finally {
    controller.abort();
    Object.assign(globalThis, previous);
  }
});

test("対応するJFIF JPEGは取得したバイト列と寸法をそのまま使う", async () => {
  const previous = {fetch: globalThis.fetch, createImageBitmap: globalThis.createImageBitmap};
  const jpeg = baselineJpeg;
  let decoded = 0;
  const responseBuffer = jpeg.buffer;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({"Content-Type": "image/jpeg"}),
    arrayBuffer: async () => responseBuffer,
    blob() { throw new Error("JPEG must not be copied into a Blob"); },
  });
  globalThis.createImageBitmap = async () => {
    decoded += 1;
    return {width: 3, height: 2, close() {} };
  };
  try {
    const page = await toPdfPage("https://example.com/original.jpg");
    assert.deepEqual([...page.jpeg], [...jpeg]);
    assert.strictEqual(page.jpeg.buffer, responseBuffer, "JPEG reuses the response buffer");
    assert.equal(page.width, 3);
    assert.equal(page.height, 2);
    assert.equal(decoded, 1, "JPEG is decoded once to validate it without re-encoding");
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("EXIF付きJPEGはPDF用には画素へ変換し、JPG保存用の元データは保持する", async () => {
  const previous = {fetch: globalThis.fetch, document: globalThis.document, createImageBitmap: globalThis.createImageBitmap};
  const jpeg = exifJpeg;
  let closed = 0;
  globalThis.fetch = async () => new Response(jpeg, {headers: {"content-type": "image/jpeg"}});
  globalThis.createImageBitmap = async () => ({width: 1, height: 1, close() { closed += 1; } });
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({fillRect() {}, drawImage() {}, getImageData: () => ({data: new Uint8ClampedArray([12, 34, 56, 255])})}),
    })
  };
  try {
    const page = await toPdfPage("https://example.test/exif.jpg");
    assert.equal(page.width, 1);
    assert.equal(page.height, 1);
    assert.equal("jpeg" in page, false, "EXIF付きJPEGをPDFへ無変換で埋め込まない");
    assert.deepEqual([...inflateSync(page.rgbFlate)], [12, 34, 56]);
    assert.equal(closed, 1);
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("HTTP失敗・通信失敗・画像形式不正を利用者向け理由へ変換する", async () => {
  const previous = {fetch: globalThis.fetch};
  try {
    globalThis.fetch = async () => new Response(null, {status: 404});
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

    globalThis.fetch = async () => new Response("not an image", {headers: {"Content-Type": "text/html"}});
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
  const previous = {fetch: globalThis.fetch};
  let signal;
  let cancelled = 0;
  globalThis.fetch = async (_url, options) => {
    signal = options.signal;
    const body = {
      bodyUsed: false,
      async cancel() {
        body.bodyUsed = true;
        cancelled += 1;
      },
      getReader() {
        return {
          read: () => new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {once: true});
          }),
          releaseLock() {},
        };
      },
    };
    const response = {
      ok: true,
      status: 200,
      body,
      bodyUsed: false,
      headers: new Headers({"Content-Type": "image/png"}),
    };
    body.cancel = async () => {
      response.bodyUsed = true;
      cancelled += 1;
    };
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

test("画像応答はContent-Lengthと実データの両方で上限を守る", async () => {
  const exactlyAtLimit = await readImageBytes(new Response(new Uint8Array([1, 2, 3, 4])), 4);
  assert.deepEqual([...exactlyAtLimit], [1, 2, 3, 4]);

  for (const headers of [undefined, {"content-length": "1"}]) {
    let cancelled = 0;
    const overLimitBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5]));
      },
      cancel() { cancelled += 1; },
    });
    await assert.rejects(
      readImageBytes(new Response(overLimitBody, headers ? {headers} : undefined), 4),
      error => error instanceof PdfImageError
        && error.kind === "invalid-image"
        && error.message === IMAGE_TOO_LARGE_MESSAGE,
    );
    assert.equal(cancelled, 1, "reading stops and cancels the stream after the byte ceiling is crossed");
  }
});

test("Content-Lengthが上限を超える応答は本文を読む前に拒否する", async () => {
  const previousFetch = globalThis.fetch;
  let reads = 0;
  let cancelled = 0;
  const body = {
    bodyUsed: false,
    async cancel() {
      body.bodyUsed = true;
      cancelled += 1;
    },
  };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({"content-type": "image/png", "content-length": String(MAX_IMAGE_BYTES + 1)}),
    body,
    get bodyUsed() { return body.bodyUsed; },
    async arrayBuffer() {
      reads += 1;
      throw new Error("本文を読んではいけません");
    },
  });
  try {
    await assert.rejects(toPdfPage("https://example.com/too-large"), error => error instanceof PdfImageError
      && error.kind === "invalid-image"
      && error.message === IMAGE_TOO_LARGE_MESSAGE);
    assert.equal(reads, 0);
    assert.equal(cancelled, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("大きすぎるJPEGとデコード画像をCanvasへ渡さず、画像メモリを解放する", async () => {
  const previous = {fetch: globalThis.fetch, document: globalThis.document, createImageBitmap: globalThis.createImageBitmap};
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x0e, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x1f, 0x40, 0x1f, 0x41, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x00, 0xff, 0xd9,
  ]);
  let decodedJpegs = 0;
  let createdCanvases = 0;
  let closedBitmaps = 0;
  globalThis.document = {
    createElement() {
      createdCanvases += 1;
      throw new Error("canvas must not be created");
    }
  };
  globalThis.fetch = async () => new Response(jpeg, {headers: {"content-type": "image/jpeg"}});
  globalThis.createImageBitmap = async () => {
    decodedJpegs += 1;
    return {width: 8_001, height: 8_000, close() { closedBitmaps += 1; } };
  };
  try {
    await assert.rejects(toPdfPage("https://example.com/large-jpeg"), error => error instanceof PdfImageError
      && error.kind === "invalid-image"
      && error.message === IMAGE_TOO_LARGE_MESSAGE);
    assert.equal(decodedJpegs, 0, "oversized JPEG dimensions are rejected during fetch");

    globalThis.fetch = async () => new Response(new Uint8Array([1]), {headers: {"content-type": "image/webp"}});
    await assert.rejects(toPdfPage("https://example.com/large-webp"), error => error instanceof PdfImageError
      && error.kind === "invalid-image"
      && error.message === IMAGE_TOO_LARGE_MESSAGE);
    assert.equal(createdCanvases, 0, "non-JPEG images are rejected before canvas allocation");
    assert.equal(closedBitmaps, 1, "the decoded bitmap is released on a size failure");
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("圧縮後は小さいが画素数が上限を超えるPNGをデコード前に拒否する", async () => {
  const previous = {fetch: globalThis.fetch, document: globalThis.document, createImageBitmap: globalThis.createImageBitmap};
  const png = compressedOversizedPng(8_001, 8_000);
  assert.ok(png.byteLength < 16_384, "圧縮された画像は16 KiB未満");
  assert.ok(png.byteLength < MAX_IMAGE_BYTES);
  let decodes = 0;
  let canvases = 0;
  globalThis.fetch = async () => new Response(png, {headers: {"content-type": "image/png"}});
  globalThis.createImageBitmap = async () => {
    decodes += 1;
    throw new Error("上限判定より前にデコードしてはいけません");
  };
  globalThis.document = {
    createElement() {
      canvases += 1;
      throw new Error("canvas must not be created");
    }
  };
  try {
    await assert.rejects(toPdfPage("https://example.com/tiny-oversized.png"), error => error instanceof PdfImageError
      && error.kind === "invalid-image"
      && error.message === IMAGE_TOO_LARGE_MESSAGE);
    assert.equal(decodes, 0);
    assert.equal(canvases, 0);
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("取得は少数並列、画素変換は逐次、結果は入力順で通知する", async () => {
  const previous = {fetch: globalThis.fetch, document: globalThis.document, createImageBitmap: globalThis.createImageBitmap};
  let activeFetches = 0;
  let maxFetches = 0;
  let activeConversions = 0;
  let maxConversions = 0;
  const delays = new Map([["a", 30], ["b", 0], ["c", 0], ["d", 0]]);
  globalThis.fetch = async (url) => {
    activeFetches += 1;
    maxFetches = Math.max(maxFetches, activeFetches);
    await new Promise((resolve) => setTimeout(resolve, delays.get(new URL(url).pathname.slice(1)) ?? 0));
    activeFetches -= 1;
    return new Response(new URL(url).pathname.slice(1), {headers: {"Content-Type": "image/png"}});
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
    const items = ["a", "b", "c", "d"].map(name => ({url: `https://example.test/${name}`}));
    const results = [];
    await preparePdfImages(items, (item, result) => results.push([item.url, result]), {
      fetchConcurrency: 2,
      pixelRowsPerChunk: 1,
      timeoutMs: 1_000,
    });
    assert.deepEqual(results.map(([url]) => url), items.map(item => item.url));
    assert.equal(results.every(([, result]) => !(result instanceof PdfImageError)), true);
    assert.equal(maxFetches <= 2, true);
    assert.equal(maxConversions, 1);
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("先頭画像が遅れても後続JPEGを並列数以上に蓄積せず、順序と無変換を保つ", async () => {
  const previous = {fetch: globalThis.fetch, createImageBitmap: globalThis.createImageBitmap};
  const jpeg = baselineJpeg;
  let releaseHead;
  const headResponse = new Promise(resolve => { releaseHead = resolve; });
  let releaseLaterRequests;
  const laterRequests = new Promise(resolve => { releaseLaterRequests = resolve; });
  let laterStarted = 0;
  let initialResponses = 0;
  let resolveInitialResponses;
  const firstWave = new Promise(resolve => { resolveInitialResponses = resolve; });
  const started = [];
  let activeFetches = 0;
  let maxFetches = 0;
  let decodes = 0;

  globalThis.fetch = async url => {
    started.push(url);
    activeFetches += 1;
    maxFetches = Math.max(maxFetches, activeFetches);
    const index = Number(new URL(url).pathname.slice("/image-".length));
    try {
      if (index === 0) await headResponse;
      else if (index < 3) {
        laterStarted += 1;
        if (laterStarted === 2) releaseLaterRequests();
        await laterRequests;
      }
    } finally {
      activeFetches -= 1;
    }
    if (index === 1 || index === 2) {
      initialResponses += 1;
      if (initialResponses === 2) resolveInitialResponses();
    }
    return new Response(jpeg, {headers: {"Content-Type": "image/jpeg"}});
  };
  globalThis.createImageBitmap = async () => {
    decodes += 1;
    return {width: 3, height: 2, close() {} };
  };

  let work;
  try {
    const items = Array.from({length: 24}, (_, index) => ({url: `https://example.test/image-${index}`}));
    const results = [];
    work = preparePdfImages(items, (item, result) => results.push([item.url, result]), {
      fetchConcurrency: 3,
      timeoutMs: 5_000,
    });
    await Promise.race([
      firstWave,
      new Promise((_, reject) => setTimeout(() => reject(new Error("初回の並列取得が完了しませんでした")), 1_000)),
    ]);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(started, items.slice(0, 3).map(item => item.url));
    assert.equal(maxFetches, 3, "指定した取得並列数を維持する");

    releaseHead();
    await work;
    assert.deepEqual(results.map(([url]) => url), items.map(({url}) => url));
    assert.equal(results.every(([, result]) => !(result instanceof PdfImageError)), true);
    assert.equal(results.every(([, result]) => result.jpeg && Buffer.from(result.jpeg).equals(Buffer.from(jpeg))), true);
    assert.equal(decodes, items.length, "each JPEG is checked once and its original bytes are retained");
  } finally {
    releaseHead();
    await work?.catch(() => {});
    Object.assign(globalThis, previous);
  }
});

test("結果通知の失敗でも待機中の取得を解放する", async () => {
  const previous = {fetch: globalThis.fetch};
  globalThis.fetch = async () => new Response("image", {headers: {"Content-Type": "image/png"}});
  try {
    await assert.rejects(
      preparePdfImages(["a", "b", "c", "d"].map(name => ({url: `https://example.test/${name}`})), () => {
        throw new Error("callback failed");
      }, {fetchConcurrency: 3, timeoutMs: 1_000}),
      /callback failed/,
    );
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("画素の読み取り失敗でもメモリを解放し、後続画像を入力順で準備する", async () => {
  const previous = {fetch: globalThis.fetch, document: globalThis.document, createImageBitmap: globalThis.createImageBitmap};
  const canvases = [];
  const closed = [];
  globalThis.fetch = async url => new Response(new URL(url).pathname.slice(1), {headers: {"Content-Type": "image/png"}});
  globalThis.createImageBitmap = async blob => {
    const name = await blob.text();
    return {name, width: 1, height: 1, close() { closed.push(name); } };
  };
  globalThis.document = {
    createElement() {
      let name;
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          return {
            fillRect() {},
            drawImage(bitmap) { name = bitmap.name; },
            getImageData() {
              if (name === "broken") throw new Error("private decoder detail");
              return {data: new Uint8ClampedArray([1, 2, 3, 255])};
            }
          };
        }
      };
      canvases.push(canvas);
      return canvas;
    }
  };
  try {
    const results = [];
    const items = ["broken", "valid"].map(name => ({url: `https://example.test/${name}`}));
    await preparePdfImages(items, (item, result) => results.push([item.url, result]));
    assert.deepEqual(results.map(([url]) => url), items.map(item => item.url));
    assert.ok(results[0][1] instanceof PdfImageError);
    assert.equal(results[0][1].kind, "invalid-image");
    assert.doesNotMatch(results[0][1].message, /private decoder detail/);
    assert.deepEqual([...inflateSync(results[1][1].rgbFlate)], [1, 2, 3]);
    assert.deepEqual(closed, ["broken", "valid"]);
    assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  } finally {
    Object.assign(globalThis, previous);
  }
});
