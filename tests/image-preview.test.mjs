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

async function waitFor(predicate) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail("プレビュー取得が完了しませんでした");
}
