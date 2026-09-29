import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const previous = {
  chrome: globalThis.chrome,
  document: globalThis.document,
  fetch: globalThis.fetch,
  createImageBitmap: globalThis.createImageBitmap,
  window: globalThis.window,
};
const downloads = [];
const pageDocument = {
  documentElement: {setAttribute() {}},
  body: {append(element) { downloads.push(element); }},
  querySelectorAll() { return []; },
  createElement(tag) {
    return {tagName: tag, href: "", download: "", click() {}, remove() {}};
  },
};
globalThis.document = pageDocument;
globalThis.chrome = {i18n: {getUILanguage: () => "en"}};
globalThis.window = {setTimeout() {}};

const {convertImage} = await import("../dist/extension/app/image-format.js");
const {fetchImage} = await import("../dist/extension/app/image-fetch.js");
const {IMAGE_TOO_LARGE_MESSAGE, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS, imageDimensionsError} = await import("../dist/extension/app/image-data-contract.js");
const {encodeJxlPixels} = await import("../dist/extension/app/jxl-codec.js");
const {createImageExportController, createImageZipEntries} = await import("../dist/extension/app/image-export-controller.js");
const {createStoredZip} = await import("../dist/extension/core/stored-zip.js");

after(() => {
  Object.assign(globalThis, previous);
});

async function readStoredZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const entries = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x0403_4b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const size = view.getUint32(offset + 22, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength;
    entries.push({name, data: bytes.slice(start, start + size)});
    offset = start + size;
  }
  assert.equal(view.getUint32(offset, true), 0x0201_4b50);
  return entries;
}

function canvasFor({getImageData = () => ({data: new Uint8ClampedArray([10, 20, 30, 128]), width: 1, height: 1}), onBlob} = {}) {
  const calls = {fill: [], draws: 0, contextOptions: undefined, size: []};
  const context = {
    fillStyle: "",
    fillRect(...args) { calls.fill.push({color: this.fillStyle, args}); },
    drawImage() { calls.draws += 1; },
    getImageData,
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext(_type, options) { calls.contextOptions = options; return context; },
    toBlob(callback, type, quality) { onBlob?.(type, quality); callback(new Blob([new Uint8Array([1, 2, 3])], {type})); },
  };
  return {canvas, calls};
}

test("reuses JPEG and PNG source bytes when they already match the selected format", async () => {
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const originalJpeg = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
  const jpeg = await convertImage({kind: "original", page: {jpeg: originalJpeg, width: 1, height: 1}}, "jpg");
  assert.deepEqual([...new Uint8Array(await jpeg.arrayBuffer())], [...originalJpeg]);
  assert.equal(jpeg.type, "image/jpeg");

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8]);
  const originalPng = new Blob([pngBytes], {type: "image/png"});
  let closed = 0;
  globalThis.createImageBitmap = async () => ({width: 1, height: 1, close() { closed += 1; }});
  try {
    const png = await convertImage({kind: "bitmap", blob: originalPng}, "png");
    assert.equal(png, originalPng, "valid PNG bytes are reused without re-encoding");
    assert.equal(closed, 1, "the source PNG is decoded only to verify it is usable, then released");
  } finally {
    globalThis.createImageBitmap = previousCreateImageBitmap;
  }
});

test("EXIFを含むJPEGはJPGのZIP保存で元のバイト列を保持し、再エンコードしない", async () => {
  const previousFetch = globalThis.fetch;
  const previousBitmap = globalThis.createImageBitmap;
  const previousCreateElement = globalThis.document.createElement;
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00,
    0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x00, 0xff, 0xd9,
  ]);
  let decoded = 0;
  let closed = 0;
  globalThis.fetch = async () => new Response(jpeg, {headers: {"content-type": "image/jpeg"}});
  globalThis.createImageBitmap = async blob => {
    decoded += 1;
    assert.equal(blob.type, "image/jpeg");
    return {width: 3, height: 2, close() { closed += 1; }};
  };
  globalThis.document.createElement = () => { throw new Error("Canvasで再エンコードしてはいけません"); };
  try {
    const fetched = await fetchImage("https://example.test/exif.jpg", {sourcePage: "https://example.test/gallery"});
    assert.equal(fetched.kind, "bitmap", "EXIF付きJPEGはPDFへ直接埋め込まない");
    const saved = await convertImage(fetched, "jpg");
    assert.deepEqual([...new Uint8Array(await saved.arrayBuffer())], [...jpeg]);
    const archive = await createStoredZip([{filename: "001.jpg", blob: saved}]);
    const entries = await readStoredZip(archive);
    assert.deepEqual([...entries[0].data], [...jpeg]);
    assert.equal(decoded, 1);
    assert.equal(closed, 1);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.createImageBitmap = previousBitmap;
    globalThis.document.createElement = previousCreateElement;
  }
});

test("PDFと画像保存形式が共有する画素上限は境界を含めて判定する", () => {
  assert.equal(imageDimensionsError(8_000, 8_000), null, "the 64-megapixel boundary is accepted");
  assert.equal(imageDimensionsError(MAX_IMAGE_DIMENSION, 1), null, "the per-side dimension boundary is accepted");
  assert.equal(imageDimensionsError(MAX_IMAGE_DIMENSION + 1, 1), IMAGE_TOO_LARGE_MESSAGE);
  assert.equal(imageDimensionsError(8_001, 8_000), IMAGE_TOO_LARGE_MESSAGE, "one pixel over the area limit is rejected");
  assert.ok(8_001 * 8_000 > MAX_IMAGE_PIXELS);
});

test("JPG・PNG・JXLは共通画素上限をCanvas前に適用し、PNG再利用も拒否する", async () => {
  const previousDocument = globalThis.document;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  let createdCanvases = 0;
  let closed = 0;
  globalThis.document = {...pageDocument, createElement() { createdCanvases += 1; throw new Error("canvas must not be created"); }};
  globalThis.createImageBitmap = async () => ({width: 8_001, height: 8_000, close() { closed += 1; }});
  const regularBlob = new Blob(["webp"], {type: "image/webp"});
  const pngBlob = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {type: "image/png"});
  try {
    await assert.rejects(convertImage({kind: "bitmap", blob: regularBlob}, "jpg"), error => error.message === IMAGE_TOO_LARGE_MESSAGE);
    await assert.rejects(convertImage({kind: "bitmap", blob: pngBlob}, "png"), error => error.message === IMAGE_TOO_LARGE_MESSAGE);
    await assert.rejects(convertImage({kind: "bitmap", blob: regularBlob}, "jxl"), error => error.message === IMAGE_TOO_LARGE_MESSAGE);
    await assert.rejects(convertImage({
      kind: "original",
      page: {jpeg: new Uint8Array([0xff, 0xd8]), width: 8_001, height: 8_000},
    }, "jpg"), error => error.message === IMAGE_TOO_LARGE_MESSAGE);
    assert.equal(createdCanvases, 0);
    assert.equal(closed, 3, "each decoded bitmap is released after the limit check");
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousCreateImageBitmap;
  }
});

test("JPG conversion uses maximum quality and composites transparency over white", async () => {
  const previousDocument = globalThis.document;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const {canvas, calls} = canvasFor({onBlob(type, quality) {
    assert.equal(type, "image/jpeg");
    assert.equal(quality, 1);
  }});
  let closed = 0;
  globalThis.document = {...pageDocument, createElement: () => canvas};
  globalThis.createImageBitmap = async () => ({width: 2, height: 1, close() { closed += 1; }});
  try {
    const jpg = await convertImage({kind: "bitmap", blob: new Blob(["webp"], {type: "image/webp"})}, "jpg");
    assert.equal(jpg.type, "image/jpeg");
    assert.deepEqual(calls.fill, [{color: "#ffffff", args: [0, 0, 2, 1]}]);
    assert.deepEqual(calls.contextOptions, {alpha: false, willReadFrequently: false});
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
    assert.equal(closed, 1);
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousCreateImageBitmap;
  }
});

test("PNG conversion keeps alpha instead of painting a background", async () => {
  const previousDocument = globalThis.document;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const {canvas, calls} = canvasFor({onBlob(type, quality) {
    assert.equal(type, "image/png");
    assert.equal(quality, undefined);
  }});
  globalThis.document = {...pageDocument, createElement: () => canvas};
  globalThis.createImageBitmap = async () => ({width: 1, height: 1, close() {}});
  try {
    const png = await convertImage({kind: "bitmap", blob: new Blob(["gif"], {type: "image/gif"})}, "png");
    assert.equal(png.type, "image/png");
    assert.deepEqual(calls.fill, []);
    assert.equal(calls.contextOptions.alpha, true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousCreateImageBitmap;
  }
});

test("JXL output decodes to the same pixels, including alpha", async () => {
  const previousDocument = globalThis.document;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousFetch = globalThis.fetch;
  const previousWorker = globalThis.Worker;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128]);
  const {canvas} = canvasFor({getImageData: () => ({data: rgba, width: 2, height: 1})});
  let workerRequest;
  let idleCallback;
  globalThis.Worker = class {
    onmessage = null;
    onerror = null;
    onmessageerror = null;
    postMessage(message) {
      workerRequest = message;
      queueMicrotask(() => this.onmessage({data: {id: message.id, buffer: new ArrayBuffer(3)}}));
    }
    terminate() {}
  };
  globalThis.setTimeout = callback => { idleCallback = callback; return 1; };
  globalThis.clearTimeout = () => {};
  globalThis.document = {...pageDocument, createElement: () => canvas};
  globalThis.createImageBitmap = async () => ({width: 2, height: 1, close() {}});
  globalThis.fetch = async input => {
    const url = String(input);
    assert.ok(url.startsWith("file:"), "the bundled codec loads its WASM from the extension package");
    return new Response(await readFile(fileURLToPath(url)), {headers: {"Content-Type": "application/wasm"}});
  };
  try {
    const jxl = await convertImage({kind: "bitmap", blob: new Blob(["webp"], {type: "image/webp"})}, "jxl");
    assert.equal(jxl.type, "image/jxl");
    assert.equal(workerRequest.width, 2);
    assert.equal(workerRequest.height, 1);
    const decode = (await import("../node_modules/@jsquash/jxl/decode.js")).default;
    const encoded = await encodeJxlPixels({data: rgba, width: 2, height: 1});
    const decoded = await decode(encoded);
    assert.deepEqual([...decoded.data], [...rgba], "lossless JXL preserves the prepared RGBA pixels");
    idleCallback();
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.fetch = previousFetch;
    globalThis.Worker = previousWorker;
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});

test("cancelling JXL encoding terminates its worker and releases decoded image memory", async () => {
  const previousDocument = globalThis.document;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousWorker = globalThis.Worker;
  const controller = new AbortController();
  const {canvas} = canvasFor();
  let terminated = false;
  let closed = 0;
  globalThis.document = {...pageDocument, createElement: () => canvas};
  globalThis.createImageBitmap = async () => ({width: 1, height: 1, close() { closed += 1; }});
  globalThis.Worker = class {
    onmessage = null;
    onerror = null;
    onmessageerror = null;
    postMessage() {}
    terminate() { terminated = true; }
  };
  try {
    const work = convertImage({kind: "bitmap", blob: new Blob(["webp"], {type: "image/webp"})}, "jxl", controller.signal);
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await assert.rejects(work, error => error.message === "画像の取得を中止しました。");
    assert.equal(terminated, true);
    assert.equal(closed, 1);
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
  } finally {
    globalThis.document = previousDocument;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.Worker = previousWorker;
  }
});

test("ZIP filenames follow selected order and expand to four digits for 1,200 images", () => {
  const selected = Array.from({length: 1_200}, (_, index) => ({url: `https://example.test/${index}`}));
  const prepared = new Map(selected.map(item => [item, new Blob([String(item.url)])]));
  const entries = createImageZipEntries(selected, prepared, "jxl");
  assert.equal(entries[0].filename, "0001.jxl");
  assert.equal(entries[1_199].filename, "1200.jxl");
  const reordered = createImageZipEntries([selected[1], selected[0]], prepared, "jpg");
  assert.deepEqual(reordered.map(entry => entry.blob), [prepared.get(selected[1]), prepared.get(selected[0])]);
  assert.deepEqual(reordered.map(entry => entry.filename), ["001.jpg", "002.jpg"]);
});

test("image export downloads one ordered ZIP, saves only selected images, and retries failures only", async () => {
  const previousFetch = globalThis.fetch;
  const previousCreateObjectURL = URL.createObjectURL;
  const previousRevokeObjectURL = URL.revokeObjectURL;
  const previousCreateElement = pageDocument.createElement;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const urls = ["https://example.test/first.png", "https://example.test/second.png"];
  const selected = urls.map(url => ({url}));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const calls = new Map();
  const saved = [];
  const links = [];
  let busy = false;
  let clearedSource = 0;
  pageDocument.createElement = tag => tag === "a" ? {
    href: "", download: "", click() { links.push({href: this.href, filename: this.download}); }, remove() {},
  } : previousCreateElement(tag);
  const append = pageDocument.body.append;
  pageDocument.body.append = link => { append.call(pageDocument.body, link); };
  globalThis.fetch = async url => {
    const count = (calls.get(url) ?? 0) + 1;
    calls.set(url, count);
    if (url === urls[1] && count === 1) return new Response("missing", {status: 404});
    return new Response(new Uint8Array([...png, count]), {headers: {"Content-Type": "image/png"}});
  };
  globalThis.createImageBitmap = async () => ({width: 1, height: 1, close() {}});
  URL.createObjectURL = blob => { saved.push(blob); return "blob:archive"; };
  URL.revokeObjectURL = () => {};
  try {
    const controller = createImageExportController({
      getSelectedItems: () => selected,
      getZipFilename: () => "Artwork.zip",
      isBusy: () => busy,
      isDisposed: () => false,
      onBusyChange(value) { busy = value; },
      onStatus() {},
      onCloseViewer() {},
      onClearSourceUrl() { clearedSource += 1; },
      onScrollToFailures() {},
    });
    await controller.export("png");
    assert.equal(controller.pending.failed.size, 1);
    assert.equal(saved.length, 0, "a partial archive is never downloaded");
    await controller.export("png");
    assert.equal(calls.get(urls[0]), 1, "a prepared image is retained for retry");
    assert.equal(calls.get(urls[1]), 2, "only the failed image is fetched again");
    assert.equal(links[0].filename, "Artwork.zip");
    assert.equal(saved[0].type, "application/zip");
    const entries = await readStoredZip(saved[0]);
    assert.deepEqual(entries.map(entry => entry.name), ["001.png", "002.png"]);
    assert.deepEqual(entries.map(entry => [...entry.data]), [[...png, 1], [...png, 2]]);
    assert.equal(controller.pending, null);
    assert.equal(clearedSource, 1);
    assert.equal(busy, false);
  } finally {
    pageDocument.createElement = previousCreateElement;
    globalThis.fetch = previousFetch;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    URL.createObjectURL = previousCreateObjectURL;
    URL.revokeObjectURL = previousRevokeObjectURL;
  }
});

test("image export prefetches at most three images while converting in input order", {timeout: 5_000}, async () => {
  const previousFetch = globalThis.fetch;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousCreateObjectURL = URL.createObjectURL;
  const previousRevokeObjectURL = URL.revokeObjectURL;
  const previousCreateElement = pageDocument.createElement;
  const urls = Array.from({length: 6}, (_, index) => `https://example.test/${index}`);
  const selected = urls.map(url => ({url}));
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return {promise, resolve};
  };
  const responseGates = Array.from({length: 3}, deferred);
  const firstDecodeStarted = deferred();
  const firstDecodeGate = deferred();
  const started = [];
  const saved = [];
  const decoded = [];
  let activeFetches = 0;
  let maximumFetches = 0;
  let activeDecodes = 0;
  let maximumDecodes = 0;
  let busy = false;
  pageDocument.createElement = tag => tag === "a" ? {
    href: "", download: "", click() {}, remove() {},
  } : previousCreateElement(tag);
  globalThis.fetch = async url => {
    const index = Number(new URL(url).pathname.slice(1));
    started.push(index);
    activeFetches += 1;
    maximumFetches = Math.max(maximumFetches, activeFetches);
    try {
      if (index < responseGates.length) await responseGates[index].promise;
      return new Response(new Uint8Array([...pngSignature, index]), {headers: {"Content-Type": "image/png"}});
    } finally {
      activeFetches -= 1;
    }
  };
  globalThis.createImageBitmap = async blob => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const index = bytes[8];
    decoded.push(index);
    activeDecodes += 1;
    maximumDecodes = Math.max(maximumDecodes, activeDecodes);
    try {
      if (index === 0) {
        firstDecodeStarted.resolve();
        await firstDecodeGate.promise;
      }
      return {width: 1, height: 1, close() {}};
    } finally {
      activeDecodes -= 1;
    }
  };
  URL.createObjectURL = blob => { saved.push(blob); return "blob:archive"; };
  URL.revokeObjectURL = () => {};
  try {
    const controller = createImageExportController({
      getSelectedItems: () => selected,
      getZipFilename: () => "Artwork.zip",
      isBusy: () => busy,
      isDisposed: () => false,
      onBusyChange(value) { busy = value; },
      onStatus() {},
      onCloseViewer() {},
      onClearSourceUrl() {},
      onScrollToFailures() {},
    });
    const work = controller.export("png");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, [0, 1, 2], "the first three network requests start together");
    responseGates[0].resolve();
    await firstDecodeStarted.promise;
    responseGates[1].resolve();
    responseGates[2].resolve();
    for (let turn = 0; turn < 4; turn += 1) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, [0, 1, 2], "completed prefetch results stay within the three-item window during conversion");
    firstDecodeGate.resolve();
    await work;
    assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
    assert.equal(maximumFetches, 3, "no more than three fetch requests are in flight");
    assert.equal(maximumDecodes, 1, "image conversion remains sequential");
    assert.deepEqual(decoded, [0, 1, 2, 3, 4, 5], "prefetched images are converted in input order");
    const entries = await readStoredZip(saved[0]);
    assert.deepEqual(entries.map(entry => entry.name), ["001.png", "002.png", "003.png", "004.png", "005.png", "006.png"]);
    assert.deepEqual(entries.map(entry => entry.data[8]), [0, 1, 2, 3, 4, 5]);
  } finally {
    pageDocument.createElement = previousCreateElement;
    globalThis.fetch = previousFetch;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    URL.createObjectURL = previousCreateObjectURL;
    URL.revokeObjectURL = previousRevokeObjectURL;
  }
});

test("aborting an image export stops concurrent fetches and prevents ZIP download", async () => {
  const previousFetch = globalThis.fetch;
  const previousCreateObjectURL = URL.createObjectURL;
  let busy = false;
  const selected = Array.from({length: 5}, (_, index) => ({url: `https://example.test/hanging-${index}.png`}));
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests += 1;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), {once: true}));
  };
  URL.createObjectURL = () => { throw new Error("cancelled export must not create a download"); };
  try {
    const controller = createImageExportController({
      getSelectedItems: () => selected,
      getZipFilename: () => "Artwork.zip",
      isBusy: () => busy,
      isDisposed: () => false,
      onBusyChange(value) { busy = value; },
      onStatus() {},
      onCloseViewer() {},
      onClearSourceUrl() {},
      onScrollToFailures() {},
    });
    const work = controller.export("png");
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await work;
    assert.equal(requests, 3, "only the bounded prefetch window starts before cancellation");
    assert.equal(busy, false);
    assert.equal(controller.isRunning, false);
  } finally {
    globalThis.fetch = previousFetch;
    URL.createObjectURL = previousCreateObjectURL;
  }
});

test("aborting immediately after an image export starts does not wait for an unstarted fetch result", {timeout: 5_000}, async () => {
  const previousFetch = globalThis.fetch;
  const previousCreateObjectURL = URL.createObjectURL;
  const selected = Array.from({length: 4}, (_, index) => ({url: `https://example.test/early-${index}.png`}));
  let controller;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response("unexpected");
  };
  URL.createObjectURL = () => { throw new Error("cancelled export must not create a download"); };
  try {
    controller = createImageExportController({
      getSelectedItems: () => selected,
      getZipFilename: () => "Artwork.zip",
      isBusy: () => false,
      isDisposed: () => false,
      onBusyChange() {},
      onStatus() { queueMicrotask(() => controller.abort()); },
      onCloseViewer() {},
      onClearSourceUrl() {},
      onScrollToFailures() {},
    });
    await controller.export("png");
    assert.equal(requests, 0, "the scheduled cancellation wins before any fetch starts");
    assert.equal(controller.isRunning, false);
  } finally {
    globalThis.fetch = previousFetch;
    URL.createObjectURL = previousCreateObjectURL;
  }
});
