import assert from "node:assert/strict";
import test from "node:test";
import {fetchImage} from "../dist/extension/app/media/image-fetch.js";
import {fetchOriginalMedia} from "../dist/extension/app/media/media-fetch.js";
import {ImageDataError} from "../dist/extension/app/contracts/image-data-contract.js";
import {preparePdfImages} from "../dist/extension/app/media/pdf-image.js";
import {baselineJpeg} from "./jpeg-fixtures.mjs";

const fetchers = [
  {name: "画像", timeout: 20_000, fetch: options => fetchImage("https://example.test/image", options)},
  {name: "メディア", timeout: 120_000, fetch: options => fetchOriginalMedia("https://example.test/image", "image", options)},
];
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const tick = () => new Promise(resolve => setImmediate(resolve));

test("画像とメディアの既定期限・HTTP理由・取得後のsignal解放を維持する", async () => {
  const previous = {fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout};
  try {
    for (const fetcher of fetchers) {
      const delays = [];
      const cleared = [];
      const controller = new AbortController();
      const listeners = new Set();
      const add = controller.signal.addEventListener.bind(controller.signal);
      const remove = controller.signal.removeEventListener.bind(controller.signal);
      controller.signal.addEventListener = (type, listener, ...args) => {
        listeners.add(listener);
        add(type, listener, ...args);
      };
      controller.signal.removeEventListener = (type, listener, ...args) => {
        listeners.delete(listener);
        remove(type, listener, ...args);
      };
      globalThis.setTimeout = (_callback, delay) => {
        delays.push(delay);
        return delays.length;
      };
      globalThis.clearTimeout = handle => { cleared.push(handle); };
      globalThis.fetch = async () => new Response(png, {headers: {"content-type": "image/png"}});
      await fetcher.fetch({signal: controller.signal});
      assert.equal(delays[0], fetcher.timeout);
      assert.deepEqual(cleared, [1]);
      assert.equal(listeners.size, 0);
      for (const [status, suffix] of [
        [401, "へのアクセスが拒否されました。"],
        [403, "へのアクセスが拒否されました。"],
        [404, "が見つかりませんでした。"],
        [410, "が見つかりませんでした。"],
        [408, "サーバーが応答できませんでした。"],
        [429, "サーバーが応答できませんでした。"],
        [503, "サーバーが応答できませんでした。"],
        [400, "を取得できませんでした。"]
      ]) {
        globalThis.fetch = async () => new Response(null, {status});
        await assert.rejects(fetcher.fetch({}), error => error.kind === "http" && error.status === status && error.message === fetcher.name + suffix);
      }
    }
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("本文が中断に応答しなくても期限で完了し、応答本文を解放する", async () => {
  const previous = globalThis.fetch;
  try {
    for (const fetcher of fetchers) {
      let signal;
      let cancelled = 0;
      const response = {
        ok: true,
        status: 200,
        bodyUsed: false,
        headers: new Headers({"content-type": "image/png"}),
        body: {
          getReader() { return {read: () => new Promise(() => {}), releaseLock() {} }; },
          cancel() {
            cancelled += 1;
            response.bodyUsed = true;
            return Promise.resolve();
          },
        }
      };
      globalThis.fetch = async (_url, options) => {
        signal = options.signal;
        return response;
      };
      await assert.rejects(fetcher.fetch({timeoutMs: 5}), error => error.kind === "timeout");
      assert.equal(signal.aborted, true);
      assert.equal(cancelled, 1);
      const controller = new AbortController();
      globalThis.fetch = async () => new Promise(() => {});
      const waiting = fetcher.fetch({signal: controller.signal});
      controller.abort();
      await assert.rejects(waiting, error => error.kind === "cancelled");
    }
  } finally {
    globalThis.fetch = previous;
  }
});

test("既存の取得失敗と中断状態が重なった場合の形式ごとの優先順位を維持する", async () => {
  const previous = globalThis.fetch;
  try {
    for (const fetcher of fetchers) {
      let aborted = false;
      // Model a cancellation observed while fetch rejects, without racing an abort event.
      const signal = {get aborted() { return aborted; }, addEventListener() {}, removeEventListener() {} };
      const original = new ImageDataError("invalid-image", "既存の画像失敗");
      globalThis.fetch = async () => {
        aborted = true;
        throw original;
      };
      await assert.rejects(fetcher.fetch({signal}), error => fetcher.name === "画像"
        ? error === original : error.kind === "cancelled" && error.message === "メディアの取得を中止しました。");
    }
  } finally {
    globalThis.fetch = previous;
  }
});

test("PDFは先に到着したbitmapを変換し、JPEGを混在させても入力順と未消費上限を保つ", async () => {
  const previous = {fetch: globalThis.fetch, document: globalThis.document, createImageBitmap: globalThis.createImageBitmap};
  let releaseHead;
  const head = new Promise(resolve => { releaseHead = resolve; });
  const started = [];
  const converted = [];
  const delivered = [];
  const items = ["head", "second", "jpeg", "last"].map(name => ({url: `https://example.test/${name}`}));
  globalThis.fetch = async url => {
    const name = new URL(url).pathname.slice(1);
    started.push(name);
    if (name === "head") await head;
    return new Response(name === "jpeg" ? baselineJpeg : name, {headers: {"content-type": name === "jpeg" ? "image/jpeg" : "image/png"}});
  };
  globalThis.createImageBitmap = async blob => {
    if (blob.type === "image/jpeg") return {width: 3, height: 2, close() {} };
    converted.push(await blob.text());
    return {width: 1, height: 1, close() {} };
  };
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect() {}, drawImage() {}, getImageData: () => ({data: new Uint8ClampedArray([1, 2, 3, 255])}),
      })
    })
  };
  let execution;
  try {
    execution = preparePdfImages(items, (item, result) => {
      assert.equal(result instanceof Error, false);
      delivered.push(item.url);
    });
    for (let attempt = 0; !converted.length && attempt < 100; attempt += 1) await tick();
    assert.deepEqual(converted, ["second"]);
    assert.deepEqual(started, ["head", "second", "jpeg"]);
    assert.deepEqual(delivered, []);
    releaseHead();
    await execution;
    assert.deepEqual(converted, ["second", "head", "last"]);
    assert.deepEqual(delivered, items.map(item => item.url));
  } finally {
    releaseHead();
    await execution?.catch(() => {});
    Object.assign(globalThis, previous);
  }
});

test("PDFは全取得が終わった後の最後の画像変換にも中断を伝え、画素を解放する", async () => {
  const previous = {fetch: globalThis.fetch, document: globalThis.document, createImageBitmap: globalThis.createImageBitmap};
  const controller = new AbortController();
  let finishDecode;
  let decoding = false;
  let released = 0;
  globalThis.fetch = async () => new Response("image", {headers: {"content-type": "image/png"}});
  globalThis.createImageBitmap = async () => {
    decoding = true;
    return new Promise(resolve => { finishDecode = () => resolve({width: 1, height: 1, close() { released += 1; } }); });
  };
  globalThis.document = {createElement() { throw new Error("中断後にCanvasを作ってはいけません"); } };
  let execution;
  try {
    execution = preparePdfImages([{url: "https://example.test/last"}], () => {}, {signal: controller.signal});
    const rejection = assert.rejects(execution, error => error.kind === "cancelled");
    for (let attempt = 0; !decoding && attempt < 100; attempt += 1) await tick();
    assert.equal(decoding, true);
    await tick();
    controller.abort();
    finishDecode();
    await rejection;
    assert.equal(released, 1);
  } finally {
    finishDecode?.();
    await execution?.catch(() => {});
    Object.assign(globalThis, previous);
  }
});
