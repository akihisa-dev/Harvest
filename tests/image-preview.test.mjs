import assert from "node:assert/strict";
import test from "node:test";
import {createImagePreviewLoader} from "../dist/extension/app/media/image-preview.js";

class PreviewImage {
  constructor() {
    this.dataset = {};
    this.attributes = new Map();
    this.isConnected = true;
    this.loading = "";
  }
  set src(value) { this.attributes.set("src", String(value)); }
  get src() { return this.attributes.get("src") ?? ""; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
}

for (const reuseQueued of [false, true]) {
  test(`画面外の待機を飛ばして${reuseQueued ? "既存" : "新規"}のビューアー対象を優先し、再表示で再開する`, async t => {
    let observer;
    t.mock.method(globalThis, "fetch", (url, options) => new Promise((resolve, reject) => {
      requests.push({url, resolve: () => resolve(new Response(new Uint8Array([1]), {headers: {"content-type": "image/png"}}))});
      options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {once: true});
    }));
    const previous = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(callback) {
        observer = this;
        this.callback = callback;
      }
      observe() {}
      unobserve() {}
      show(image, visible) { this.callback([{target: image, isIntersecting: visible}]); }
    };
    t.after(() => {
      if (previous === undefined) delete globalThis.IntersectionObserver;
      else globalThis.IntersectionObserver = previous;
    });
    const requests = [];
    const loader = createImagePreviewLoader();
    t.after(() => loader.clear());
    const images = Array.from({length: 8}, () => new PreviewImage());
    const items = images.map((_, i) => ({url: `https://cdn.example/queued-${i}.png`, sourcePage: "https://reader.example/book", selected: true}));
    images.forEach((image, i) => {
      loader.set(image, items[i]);
      observer.show(image, true);
    });
    assert.equal(requests.length, 3);
    images.forEach(image => observer.show(image, false));
    // One ordinary visible preview is still needed, but the viewer comes first.
    observer.show(images[3], true);
    const viewer = new PreviewImage();
    const viewerItem = reuseQueued ? items[7] : {...items[7], url: "https://cdn.example/new-viewer.png"};
    loader.set(viewer, viewerItem, true);
    requests[0].resolve();
    await waitFor(() => requests.length === 4);
    assert.equal(requests[3].url, viewerItem.url);
    assert.equal(requests.length, 4, "空いた1枠だけを使う");
    requests[3].resolve();
    await waitFor(() => requests.length === 5);
    assert.equal(requests[4].url, items[3].url);
    requests.slice(1, 3).forEach(request => request.resolve());
    requests[4].resolve();
    await waitFor(() => images[3].src.startsWith("blob:"));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(requests.length, 5, "画面外の待機項目を取得しない");
    observer.show(images[4], true);
    await waitFor(() => requests.length === 6);
    assert.equal(requests[5].url, items[4].url);
    requests[5].resolve();
    await waitFor(() => images[4].src.startsWith("blob:"));
    if (reuseQueued) {
      observer.show(images[7], true);
      assert.equal(images[7].src, viewer.src);
      loader.clearImage(viewer);
      assert.ok(images[7].src.startsWith("blob:"));
    }
    assert.equal(requests.filter(({url}) => url === viewerItem.url).length, 1);
  });
}

test("一覧とビュアーは共有した認証方針でプレビューを取得し、使い終わったURLを解放する", async t => {
  const previousFetch = globalThis.fetch;
  const previousObserver = globalThis.IntersectionObserver;
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const requests = [];
  const revoked = [];
  let nextObjectUrl = 0;
  const observers = [];
  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = new Set();
      observers.push(this);
    }
    observe(image) { this.observed.add(image); }
    unobserve(image) { this.observed.delete(image); }
    intersect(image) { this.callback([{target: image, isIntersecting: true}]); }
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {configurable: true, writable: true, value: FakeIntersectionObserver});
  Object.defineProperty(URL, "createObjectURL", {configurable: true, writable: true, value: () => `blob:preview-${++nextObjectUrl}`});
  Object.defineProperty(URL, "revokeObjectURL", {configurable: true, writable: true, value: value => revoked.push(value)});
  globalThis.fetch = async (url, options) => {
    requests.push({url, options});
    return new Response(new Uint8Array([1, 2, 3]), {headers: {"content-type": "image/png"}});
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousObserver === undefined) delete globalThis.IntersectionObserver;
    else Object.defineProperty(globalThis, "IntersectionObserver", {configurable: true, writable: true, value: previousObserver});
    if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    else delete URL.createObjectURL;
    if (revokeObjectUrlDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
    else delete URL.revokeObjectURL;
  });

  const loader = createImagePreviewLoader();
  const cdnItem = {url: "https://cdn.example/page.png", sourcePage: "https://reader.example/book", selected: true};
  const listImage = new PreviewImage();
  const viewerImage = new PreviewImage();
  loader.set(listImage, cdnItem);
  assert.equal(requests.length, 0, "一覧画像は表示領域に入るまで取得しない");
  observers[0].intersect(listImage);
  loader.set(viewerImage, cdnItem, true);
  await waitFor(() => listImage.src.startsWith("blob:") && viewerImage.src.startsWith("blob:"));
  assert.equal(requests.length, 1, "同じプレビューは一覧とビュアーで共有する");
  assert.equal(requests[0].url, cdnItem.url);
  assert.equal(requests[0].options.credentials, "omit", "別オリジンの画像へログイン状態を送らない");
  assert.equal(requests[0].options.redirect, "follow");
  assert.equal(listImage.dataset.previewUrl, cdnItem.url);
  assert.equal(listImage.src, viewerImage.src);

  loader.clearImage(listImage);
  assert.deepEqual(revoked, [], "共有中の画像URLは片方の表示終了では破棄しない");
  loader.clearImage(viewerImage);
  assert.deepEqual(revoked, ["blob:preview-1"]);

  const sameOriginItem = {url: "https://reader.example/page.png", sourcePage: cdnItem.sourcePage, selected: true};
  const sameOriginImage = new PreviewImage();
  loader.set(sameOriginImage, sameOriginItem, true);
  await waitFor(() => sameOriginImage.src.startsWith("blob:"));
  assert.equal(requests[1].options.credentials, "include", "同一オリジン画像だけログイン状態を使う");
  assert.equal(requests[1].options.redirect, "error", "認証付きURLの転送を止める");

  const sourceSvg = {url: "data:image/svg+xml;charset=utf-8,%3Csvg/%3E", sourcePage: cdnItem.sourcePage, selected: true};
  const localImage = new PreviewImage();
  loader.set(localImage, sourceSvg, true);
  assert.equal(localImage.src, sourceSvg.url, "SourceのローカルSVGはそのまま表示する");
  assert.equal(requests.length, 2, "ローカルSVGはネットワークへ送らない");
  loader.clear();
  assert.equal(revoked.length, 2, "残りのオブジェクトURLをパネル終了時に解放する");
});

test("プレビュー取得は最大3件まで並行し、待機中に不要になった項目を飛ばす", async t => {
  const previousFetch = globalThis.fetch;
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const requests = [];
  let nextObjectUrl = 0;
  Object.defineProperty(URL, "createObjectURL", {configurable: true, writable: true, value: () => `blob:queue-${++nextObjectUrl}`});
  Object.defineProperty(URL, "revokeObjectURL", {configurable: true, writable: true, value() {} });
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
    const request = {url, resolve: () => resolve(new Response(new Uint8Array([1]), {headers: {"content-type": "image/png"}}))};
    requests.push(request);
    options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {once: true});
  });
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    else delete URL.createObjectURL;
    if (revokeObjectUrlDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
    else delete URL.revokeObjectURL;
  });

  const loader = createImagePreviewLoader();
  const images = Array.from({length: 5}, () => new PreviewImage());
  const items = images.map((_, index) => ({
    url: `https://cdn.example/${index + 1}.png`,
    sourcePage: "https://reader.example/book",
    selected: true,
  }));
  images.forEach((image, index) => loader.set(image, items[index], true));
  assert.equal(requests.length, 3, "同時に始めるネットワーク要求を3件に抑える");
  loader.clearImage(images[3]);
  requests.slice(0, 3).forEach(request => request.resolve());
  await waitFor(() => requests.length === 4);
  assert.equal(requests.some(request => request.url === items[3].url), false, "待機列から外した画像は要求しない");
  assert.equal(requests[3].url, items[4].url, "空いた枠は引き続き必要な画像に使う");
  requests[3].resolve();
  await waitFor(() => images[4].src.startsWith("blob:"));
  loader.clear();
});

test("画面外プレビューを24件まで保持し、共有中のURLを避けて再表示時に再取得する", async t => {
  const previousFetch = globalThis.fetch;
  const previousObserver = globalThis.IntersectionObserver;
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const requests = [];
  const created = [];
  const revoked = [];
  const alive = new Set();
  const observers = [];
  let nextObjectUrl = 0;
  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = new Set();
      observers.push(this);
    }
    observe(image) { this.observed.add(image); }
    unobserve(image) { this.observed.delete(image); }
    intersect(image, isIntersecting) { this.callback([{target: image, isIntersecting}]); }
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {configurable: true, writable: true, value: FakeIntersectionObserver});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: () => {
      const objectUrl = `blob:bounded-${++nextObjectUrl}`;
      created.push(objectUrl);
      alive.add(objectUrl);
      return objectUrl;
    }
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: objectUrl => {
      revoked.push(objectUrl);
      alive.delete(objectUrl);
    }
  });
  globalThis.fetch = async (url, options) => {
    requests.push({url, options});
    return new Response(new Uint8Array([1, 2, 3]), {headers: {"content-type": "image/png"}});
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousObserver === undefined) delete globalThis.IntersectionObserver;
    else Object.defineProperty(globalThis, "IntersectionObserver", {configurable: true, writable: true, value: previousObserver});
    if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    else delete URL.createObjectURL;
    if (revokeObjectUrlDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
    else delete URL.revokeObjectURL;
  });

  const loader = createImagePreviewLoader();
  const observer = observers[0];
  const sharedItem = {url: "https://cdn.example/shared.png", sourcePage: "https://reader.example/book", selected: true};
  const sharedListImage = new PreviewImage();
  const viewerImage = new PreviewImage();
  loader.set(sharedListImage, sharedItem);
  observer.intersect(sharedListImage, true);
  loader.set(viewerImage, sharedItem, true);
  await waitFor(() => sharedListImage.src.startsWith("blob:") && viewerImage.src.startsWith("blob:"));
  const sharedObjectUrl = viewerImage.src;
  observer.intersect(sharedListImage, false);

  const images = Array.from({length: 32}, (_, index) => new PreviewImage());
  const items = images.map((_, index) => ({
    url: `https://cdn.example/${index + 1}.png`,
    sourcePage: sharedItem.sourcePage,
    selected: true,
  }));
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    loader.set(image, items[index]);
    observer.intersect(image, true);
    await waitFor(() => image.src.startsWith("blob:"));
    observer.intersect(image, false);
  }

  assert.equal(alive.size, 24, "共有中のビュアー画像を含め保持URLは上限内に収まる");
  assert.equal(revoked.includes(sharedObjectUrl), false, "一覧とビュアーで共有中のURLは破棄しない");
  assert.equal(viewerImage.src, sharedObjectUrl);
  assert.equal(images[0].src, "", "古い画面外画像はURL解放時にsrcも外す");
  assert.equal(revoked.includes(created[1]), true, "上限を超えた最古の画面外URLを解放する");

  observer.intersect(images[0], true);
  await waitFor(() => images[0].src.startsWith("blob:") && images[0].src !== created[1]);
  assert.equal(requests.filter(request => request.url === items[0].url).length, 2, "再表示時はプレビューを再取得する");
  assert.equal(alive.size, 24, "再取得しても保持URL数の上限を保つ");

  loader.clearImage(viewerImage);
  assert.equal(revoked.includes(sharedObjectUrl), false, "ビュアー解除後も一覧参照が残るURLは保持する");
  for (const image of images) loader.clearImage(image);
  assert.equal(alive.size, 1, "他の一覧画像を外しても共有項目の一覧URLを保持する");

  const laterImages = Array.from({length: 24}, (_, index) => new PreviewImage());
  for (let index = 0; index < laterImages.length; index += 1) {
    const image = laterImages[index];
    const item = {
      url: `https://cdn.example/later-${index + 1}.png`,
      sourcePage: sharedItem.sourcePage,
      selected: true,
    };
    loader.set(image, item);
    observer.intersect(image, true);
    await waitFor(() => image.src.startsWith("blob:"));
    observer.intersect(image, false);
  }
  assert.equal(revoked.includes(sharedObjectUrl), true, "ビュアー解除後の一覧URLも上限超過で追放する");
  assert.equal(sharedListImage.src, "", "追放した共有項目の一覧srcを外す");
  assert.equal(alive.size, 24);

  loader.clear();
  assert.equal(alive.size, 0, "パネル終了時に残りのURLをすべて解放する");
});

test("上限超過寸法のPNGはプレビュー用Blob URLを作らない", async t => {
  const previousFetch = globalThis.fetch;
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  let objectUrls = 0;
  const pngHeader = new Uint8Array(24);
  pngHeader.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(pngHeader.buffer);
  view.setUint32(8, 13);
  pngHeader.set([73, 72, 68, 82], 12);
  view.setUint32(16, 8_001);
  view.setUint32(20, 8_000);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true, writable: true, value() {
      objectUrls += 1;
      return "blob:oversized";
    }
  });
  globalThis.fetch = async () => new Response(pngHeader, {headers: {"content-type": "image/png"}});
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    else delete URL.createObjectURL;
  });

  const loader = createImagePreviewLoader();
  const image = new PreviewImage();
  loader.set(image, {url: "https://cdn.example/oversized.png", sourcePage: "https://reader.example/book", selected: true}, true);
  await waitFor(() => image.dataset.previewFailed === "true");
  assert.equal(image.src, "", "上限超過画像をimg要素へ渡さない");
  assert.equal(objectUrls, 0, "拒否した画像のBlob URLを作らない");
  loader.clear();
});

test("一覧とビュアーは一時失敗後に待ち時間を置いて同じプレビューを再試行する", async t => {
  const previousFetch = globalThis.fetch;
  const previousObserver = globalThis.IntersectionObserver;
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const requests = [];
  const observers = [];
  let nextObjectUrl = 0;
  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    unobserve() {}
    intersect(image, isIntersecting = true) { this.callback([{target: image, isIntersecting}]); }
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {configurable: true, writable: true, value: FakeIntersectionObserver});
  Object.defineProperty(URL, "createObjectURL", {configurable: true, writable: true, value: () => `blob:retry-${++nextObjectUrl}`});
  globalThis.fetch = async (url, options) => {
    requests.push({url, options});
    if (requests.length === 1) throw new Error("temporary network failure");
    return new Response(new Uint8Array([1, 2, 3]), {headers: {"content-type": "image/png"}});
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousObserver === undefined) delete globalThis.IntersectionObserver;
    else Object.defineProperty(globalThis, "IntersectionObserver", {configurable: true, writable: true, value: previousObserver});
    if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    else delete URL.createObjectURL;
  });

  const loader = createImagePreviewLoader();
  const item = {url: "https://cdn.example/retry.png", sourcePage: "https://reader.example/book", selected: true};
  const listImage = new PreviewImage();
  const viewerImage = new PreviewImage();
  loader.set(listImage, item);
  observers[0].intersect(listImage);
  await waitFor(() => listImage.dataset.previewFailed === "true");
  assert.equal(requests.length, 1);
  assert.deepEqual(loader.diagnostics, {bound: 1, ready: 0, failed: 1, pending: 0});

  observers[0].intersect(listImage, false);
  observers[0].intersect(listImage, true);
  loader.set(viewerImage, item, true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requests.length, 1, "失敗直後の再表示とViewer表示では連続要求しない");

  await new Promise(resolve => setTimeout(resolve, 1_000));
  observers[0].intersect(listImage, false);
  observers[0].intersect(listImage, true);
  await waitFor(() => listImage.src.startsWith("blob:") && viewerImage.src.startsWith("blob:"));
  assert.equal(requests.length, 2, "待ち時間後の再表示で再要求する");
  assert.equal(listImage.src, viewerImage.src, "一覧とViewerは同じ再試行結果を共有する");
  assert.equal(listImage.dataset.previewFailed, undefined, "成功後に一覧の失敗状態を解除する");
  assert.equal(viewerImage.dataset.previewFailed, undefined, "成功後にViewerの失敗状態を解除する");
  assert.deepEqual(loader.diagnostics, {bound: 1, ready: 1, failed: 0, pending: 0});
  loader.clear();
});

async function waitFor(predicate) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail("プレビュー取得が完了しませんでした");
}
