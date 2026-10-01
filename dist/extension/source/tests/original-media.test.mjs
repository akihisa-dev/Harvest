import assert from "node:assert/strict";
import test from "node:test";

const previous = {
  chrome: globalThis.chrome,
  document: globalThis.document,
  fetch: globalThis.fetch,
  window: globalThis.window,
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};

globalThis.chrome = {i18n: {getUILanguage: () => "en"}};
globalThis.document = {
  documentElement: {setAttribute() {}},
  querySelectorAll() { return []; },
  body: {append() {}},
  createElement() { return {setAttribute() {}, click() {}, remove() {}}; },
};

const {fetchOriginalMedia} = await import("../dist/extension/app/media-fetch.js");
const {createImageExportController, createImageZipEntries} = await import("../dist/extension/app/image-export-controller.js");

function fakeResponse(bytes, contentType, extraHeaders = {}) {
  return new Response(bytes, {headers: {"content-type": contentType, ...extraHeaders}});
}

function unzipStored(blob) {
  return blob.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
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
  });
}

test("original media preserves GIF and MP4 bytes with MIME-based ZIP extensions", async () => {
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3]);
  const mp4Bytes = new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0]);
  const webmBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
  const items = [
    {url: "https://media.test/photo.jpg", sourcePage: "https://media.test/page", selected: true, kind: "image"},
    {url: "https://media.test/animation.gif", sourcePage: "https://media.test/page", selected: true, kind: "gif"},
    {url: "https://media.test/animation.mp4", sourcePage: "https://media.test/page", selected: true, kind: "video"},
    {url: "https://media.test/clip.mp4", sourcePage: "https://media.test/page", selected: true, kind: "video"},
    {url: "https://media.test/clip.webm", sourcePage: "https://media.test/page", selected: true, kind: "video"},
  ];
  let activeFetches = 0;
  let maximumFetches = 0;
  const archives = [];
  const links = [];
  globalThis.chrome = {i18n: {getUILanguage: () => "en"}};
  globalThis.document = {
    body: {append(link) { links.push(link); }},
    createElement() { return {href: "", download: "", click() {}, remove() {}}; },
  };
  globalThis.window = {setTimeout};
  globalThis.fetch = async url => {
    activeFetches += 1;
    maximumFetches = Math.max(maximumFetches, activeFetches);
    await new Promise(resolve => setTimeout(resolve, 1));
    activeFetches -= 1;
    if (url.endsWith("photo.jpg")) return fakeResponse(jpegBytes, "image/jpeg");
    if (url.endsWith("animation.gif")) return fakeResponse(gifBytes, "image/gif");
    if (url.endsWith("clip.webm")) return fakeResponse(webmBytes, "video/webm");
    return fakeResponse(mp4Bytes, "video/mp4");
  };
  URL.createObjectURL = blob => { archives.push(blob); return "blob:archive"; };
  URL.revokeObjectURL = () => {};
  try {
    const controller = createImageExportController({
      getSelectedItems: () => items,
      getZipFilename: () => "Original.zip",
      isBusy: () => false,
      isDisposed: () => false,
      onBusyChange() {},
      onStatus() {},
      onCloseViewer() {},
      onClearSourceUrl() {},
      onScrollToFailures() {},
    });
    await controller.export("original");
    assert.equal(maximumFetches, 1, "original downloads use one in-flight request to limit memory");
    assert.equal(archives.length, 1);
    assert.equal(links[0].download, "Original.zip");
    const entries = await unzipStored(archives[0]);
    assert.deepEqual(entries.map(entry => entry.name), ["001.jpg", "002.gif", "003.mp4", "004.mp4", "005.webm"]);
    assert.deepEqual(entries.map(entry => [...entry.data]), [[...jpegBytes], [...gifBytes], [...mp4Bytes], [...mp4Bytes], [...webmBytes]]);
    assert.equal(controller.pending, null);
  } finally {
    Object.assign(globalThis, {chrome: previous.chrome, document: previous.document, fetch: previous.fetch, window: previous.window});
    URL.createObjectURL = previous.createObjectURL;
    URL.revokeObjectURL = previous.revokeObjectURL;
  }
});

test("original media uses existing credentials and private-target rules", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({url, options});
    return fakeResponse(jpeg, "image/jpeg");
  };
  try {
    await fetchOriginalMedia("https://example.test/same.jpg", "image", {sourcePage: "https://example.test/gallery"});
    await fetchOriginalMedia("https://cdn.test/other.jpg", "image", {sourcePage: "https://example.test/gallery"});
    assert.equal(requests[0].options.credentials, "include");
    assert.equal(requests[0].options.redirect, "error");
    assert.equal(requests[1].options.credentials, "omit");
    assert.equal(requests[1].options.redirect, "follow");
    assert.equal(requests[1].options.targetAddressSpace, "public");
    await assert.rejects(
      fetchOriginalMedia("http://127.0.0.1/private.jpg", "image", {sourcePage: "https://example.test/gallery"}),
      error => error.kind === "invalid-image",
    );
    assert.equal(requests.length, 2, "private cross-origin URLs are rejected before fetch");
  } finally {
    globalThis.fetch = previous.fetch;
  }
});

test("original media rejects HTML, mismatched signatures, and payloads above 64 MiB", async () => {
  const largeFtyp = new Uint8Array(8 * 1024);
  largeFtyp.set([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x61, 0x62, 0x63, 0x64], 0);
  new DataView(largeFtyp.buffer).setUint32(0, largeFtyp.length, false);
  largeFtyp.set([0x6d, 0x70, 0x34, 0x32], largeFtyp.length - 4);
  const avifFtyp = new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0]);
  globalThis.fetch = async url => {
    if (url.endsWith("/html")) return fakeResponse("<html>no</html>", "text/html");
    if (url.endsWith("/mismatch")) return fakeResponse("<html>no</html>", "image/jpeg");
    if (url.endsWith("/svg")) return fakeResponse("<svg/>", "image/svg+xml");
    if (url.endsWith("/avif-as-mp4")) return fakeResponse(avifFtyp, "video/mp4");
    if (url.endsWith("/late-mp4-brand")) return fakeResponse(largeFtyp, "video/mp4");
    if (url.endsWith("/mp4-as-gif")) return fakeResponse(new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0]), "video/mp4");
    return fakeResponse(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg", {"content-length": String(64 * 1024 * 1024 + 1)});
  };
  try {
    await assert.rejects(fetchOriginalMedia("https://example.test/html"), error => error.kind === "invalid-image");
    await assert.rejects(fetchOriginalMedia("https://example.test/mismatch"), error => error.kind === "invalid-image");
    await assert.rejects(fetchOriginalMedia("https://example.test/svg"), error => error.kind === "invalid-image");
    await assert.rejects(fetchOriginalMedia("https://example.test/avif-as-mp4", "video"), error => error.kind === "invalid-image");
    await assert.rejects(fetchOriginalMedia("https://example.test/late-mp4-brand", "video"), error => error.kind === "invalid-image");
    await assert.rejects(fetchOriginalMedia("https://example.test/mp4-as-gif", "gif"), error => error.kind === "invalid-image");
    await assert.rejects(fetchOriginalMedia("https://example.test/too-large"), error => error.kind === "invalid-image");
  } finally {
    globalThis.fetch = previous.fetch;
  }
});

test("original media honors timeout and caller cancellation", async () => {
  let observedAbort = false;
  globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      observedAbort = true;
      reject(new DOMException("aborted", "AbortError"));
    }, {once: true});
  });
  try {
    await assert.rejects(fetchOriginalMedia("https://example.test/wait", "image", {timeoutMs: 5}), error => error.kind === "timeout");
    assert.equal(observedAbort, true);

    observedAbort = false;
    const controller = new AbortController();
    const pending = fetchOriginalMedia("https://example.test/cancel", "image", {signal: controller.signal});
    controller.abort();
    await assert.rejects(pending, error => error.kind === "cancelled");
    assert.equal(observedAbort, true);
  } finally {
    globalThis.fetch = previous.fetch;
  }
});

test("ZIP extensions follow recognized MIME types and reject unknown or mismatched types", () => {
  const image = {url: "https://example.test/unknown", sourcePage: "https://example.test", selected: true};
  assert.equal(createImageZipEntries([image], new Map([[image, new Blob(["x"], {type: "image/avif"})]]), "original")[0].filename, "001.avif");
  assert.throws(() => createImageZipEntries([image], new Map([[image, new Blob(["x"], {type: "text/html"})]]), "original"), /形式を確認できません/);
  const gif = {...image, kind: "gif"};
  const video = {...image, kind: "video"};
  assert.equal(createImageZipEntries([gif], new Map([[gif, new Blob(["gif"], {type: "image/gif"})]]), "gif")[0].filename, "001.gif");
  assert.equal(createImageZipEntries([video], new Map([[video, new Blob(["mp4"], {type: "video/mp4"})]]), "mp4")[0].filename, "001.mp4");
  assert.throws(() => createImageZipEntries([gif], new Map([[gif, new Blob(["mp4"], {type: "video/mp4"})]]), "gif"), /形式が一致しません/);
  assert.throws(() => createImageZipEntries([video], new Map([[video, new Blob(["gif"], {type: "image/gif"})]]), "mp4"), /形式が一致しません/);
  assert.throws(() => createImageZipEntries([gif], new Map([[gif, new Blob(["mp4"], {type: "video/mp4"})]]), "original"), /形式が一致しません/);
});

test("MP4 export records a WebM response as a retryable preparation failure", async () => {
  const item = {url: "https://example.test/wrong.mp4", sourcePage: "https://example.test", selected: true, kind: "video"};
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
  const archives = [];
  globalThis.fetch = async () => fakeResponse(webm, "video/webm");
  URL.createObjectURL = blob => { archives.push(blob); return "blob:archive"; };
  const controller = createImageExportController({
    getSelectedItems: () => [item],
    getZipFilename: () => "Video.zip",
    isBusy: () => false,
    isDisposed: () => false,
    onBusyChange() {},
    onStatus() {},
    onCloseViewer() {},
    onClearSourceUrl() {},
    onScrollToFailures() {},
  });
  await controller.export("mp4");
  assert.equal(archives.length, 0);
  assert.equal(controller.pending?.failed.has(item), true);
  assert.match(controller.pending?.failed.get(item) ?? "", /形式が一致しません/);
});

test.after(() => {
  Object.assign(globalThis, {chrome: previous.chrome, document: previous.document, fetch: previous.fetch, window: previous.window});
  URL.createObjectURL = previous.createObjectURL;
  URL.revokeObjectURL = previous.revokeObjectURL;
});
