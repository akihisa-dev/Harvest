import assert from "node:assert/strict";
import test from "node:test";
import { createImagePreviewLoader } from "../dist/extension/app/image-preview.js";

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
    constructor(callback) { this.callback = callback; this.observed = new Set(); observers.push(this); }
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
  Object.defineProperty(URL, "revokeObjectURL", {configurable: true, writable: true, value() {}});
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
    constructor(callback) { this.callback = callback; this.observed = new Set(); observers.push(this); }
    observe(image) { this.observed.add(image); }
    unobserve(image) { this.observed.delete(image); }
    intersect(image, isIntersecting) { this.callback([{target: image, isIntersecting}]); }
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {configurable: true, writable: true, value: FakeIntersectionObserver});
  Object.defineProperty(URL, "createObjectURL", {configurable: true, writable: true, value: () => {
    const objectUrl = `blob:bounded-${++nextObjectUrl}`;
    created.push(objectUrl);
    alive.add(objectUrl);
    return objectUrl;
  }});
  Object.defineProperty(URL, "revokeObjectURL", {configurable: true, writable: true, value: objectUrl => {
    revoked.push(objectUrl);
    alive.delete(objectUrl);
  }});
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
  Object.defineProperty(URL, "createObjectURL", {configurable: true, writable: true, value() {
    objectUrls += 1;
    return "blob:oversized";
  }});
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

async function waitFor(predicate) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail("プレビュー取得が完了しませんでした");
}
