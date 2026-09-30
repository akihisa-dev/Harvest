import {storedZipChecksum} from "../dist/extension/core/stored-zip.js";
import assert from "node:assert/strict";
import test from "node:test";

const nativeBlob = globalThis.Blob;
const nativeSetTimeout = globalThis.setTimeout;
globalThis.chrome = {i18n: {getUILanguage: () => "en"}};
const downloads = [];
let large = true;
let selected = [];
let started = 0;
let active = 0;
let cancelled = 0;
const statuses = [];
globalThis.Blob = class extends nativeBlob {
  constructor(parts, options) {
    super(parts, options);
    // Simulate many individually valid 32 MiB images without allocating GiB in the test.
    if (large && options?.type?.startsWith("image/")) Object.defineProperty(this, "size", {value: 32 * 1024 * 1024});
  }
};
globalThis.document = {
  documentElement: {setAttribute() {}}, querySelectorAll() { return []; }, body: {append() {}},
  createElement(tag) {
    if (tag === "a") return {href: "", download: "", click() { downloads.push(this.download); }, remove() {}};
    return {
      width: 0, height: 0,
      getContext() { return {fillRect() {}, drawImage() {}, getImageData() { return {data: new Uint8ClampedArray(4), width: 1, height: 1}; }}; },
      toBlob(done, type) { done(new Blob([new Uint8Array([1])], {type})); },
    };
  },
};
globalThis.window = {setTimeout() {}};
globalThis.createImageBitmap = async () => ({width: 1, height: 1, close() {}});
globalThis.Worker = class extends EventTarget {
  postMessage(message) {
      if (message.blob) {
        void storedZipChecksum(message.blob).then(checksum => this.dispatchEvent(new MessageEvent("message", {data: {id: message.id, checksum}})));
      } else queueMicrotask(() => this.onmessage({data: {id: message.id, buffer: new ArrayBuffer(1)}}));
    }
  terminate() {}
};
// Do not leave the successful JXL fixture's idle timer running after this test.
globalThis.setTimeout = (callback, delay, ...args) => delay === 30_000 ? 0 : nativeSetTimeout(callback, delay, ...args);
URL.createObjectURL = () => "blob:archive";
URL.revokeObjectURL = () => {};
globalThis.fetch = async (url, options) => {
  started += 1;
  const index = Number(new URL(url).pathname.slice(1));
  if (large && index >= 128) {
    active += 1;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => {
      active -= 1;
      cancelled += 1;
      reject(new DOMException("cancelled", "AbortError"));
    }, {once: true}));
  }
  return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {headers: {"Content-Type": "image/png"}});
};
const {createImageExportController} = await import("../dist/extension/app/image-export-controller.js");

for (const format of ["jpg", "png", "jxl"]) {
  test(`${format}: cumulative ZIP limit stops many valid images early and releases work`, {timeout: 5_000}, async () => {
    selected = Array.from({length: 140}, (_, index) => ({url: `https://example.test/${index}`}));
    large = true;
    started = active = cancelled = 0;
    downloads.length = statuses.length = 0;
    let busy = false;
    const controller = createImageExportController({
      getSelectedItems: () => selected, getZipFilename: () => "images.zip",
      isBusy: () => busy, isDisposed: () => false,
      onBusyChange(value) { busy = value; }, onStatus(...args) { statuses.push(args); },
      onCloseViewer() {}, onClearSourceUrl() {}, onScrollToFailures() {},
    });
    await controller.export(format);
    assert.ok(started < 140, "stop before fetching every image");
    assert.ok(cancelled > 0, "cancel outstanding prefetches on overflow");
    assert.equal(active, 0);
    assert.equal(controller.pending, null, "release prepared data and avoid an unusable retry");
    assert.equal(busy, false);
    assert.deepEqual(downloads, [], "never save an incomplete archive");
    assert.equal(statuses.at(-1)[1], "error");
    assert.match(statuses.at(-1)[0], /ZIP format limits/);
    large = false;
    selected = selected.slice(0, 2);
    await controller.export(format);
    assert.deepEqual(downloads, ["images.zip"], "reducing the selection permits a fresh successful save");
  });
}

test("retry counts successful images already held toward the cumulative limit", {timeout: 5_000}, async () => {
  selected = Array.from({length: 140}, (_, index) => ({url: `https://example.test/${index}`}));
  large = true;
  const normalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => Number(new URL(url).pathname.slice(1)) >= 127
    ? new Response("failed", {status: 404}) : normalFetch(url, options);
  let busy = false;
  const controller = createImageExportController({
    getSelectedItems: () => selected, getZipFilename: () => "images.zip",
    isBusy: () => busy, isDisposed: () => false,
    onBusyChange(value) { busy = value; }, onStatus() {},
    onCloseViewer() {}, onClearSourceUrl() {}, onScrollToFailures() {},
  });
  try {
    await controller.export("png");
    const previousWork = controller.pending;
    assert.equal(previousWork.prepared.size, 127, "ordinary failures preserve successful images for retry");
    assert.equal(previousWork.failed.size, 13);
    globalThis.fetch = normalFetch;
    await controller.export("png");
    assert.equal(controller.pending, null, "retry cannot exceed the budget using previous results");
    assert.equal(previousWork.prepared.size, 0);
    assert.equal(previousWork.failed.size, 0);
    assert.equal(busy, false);
  } finally { globalThis.fetch = normalFetch; }
});

test("too many ZIP entries are rejected before any image fetch", async () => {
  selected = Array.from({length: 65_536}, (_, index) => ({url: `https://example.test/${index}`}));
  started = 0;
  const controller = createImageExportController({
    getSelectedItems: () => selected, getZipFilename: () => "images.zip",
    isBusy: () => false, isDisposed: () => false, onBusyChange() {}, onStatus() {},
    onCloseViewer() {}, onClearSourceUrl() {}, onScrollToFailures() {},
  });
  await controller.export("png");
  assert.equal(started, 0);
  assert.equal(controller.pending, null);
});
