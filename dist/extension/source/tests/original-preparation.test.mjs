import assert from "node:assert/strict";
import test from "node:test";
import {prepareMixedExport} from "../dist/extension/app/media/mixed-export-preparation.js";
import {pngBytes} from "./original-fixtures.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const createWork = () => ({
  selected: Array.from({length: 6}, (_, index) => ({url: `https://example.test/${index}.png`, kind: "image", selected: true})),
  imageFormat: "recommend", resolvedImageFormat: "original", videoFormat: "original", includeSourcePage: false,
  prepared: new Map(), failed: new Map(), saved: new Set(),
});

test("原本画像は先頭待ちでも3件に収まり、順序・破損拒否・失敗分だけの再試行を保つ", async t => {
  const work = createWork(), requests = [], progress = [];
  let releaseHead;
  const head = new Promise(resolve => { releaseHead = resolve; });
  let retry = false;
  t.mock.method(globalThis, "fetch", async url => {
    requests.push(url);
    if (url === work.selected[0].url) await head;
    const bytes = Uint8Array.from(pngBytes);
    if (!retry && url === work.selected[2].url) bytes[29] ^= 1; // Corrupt IHDR CRC.
    return new Response(bytes, {headers: {"content-type": "image/png"}});
  });
  const options = {signal: new AbortController().signal, isStopped: () => false, onProgress: (...value) => progress.push(value)};
  const execution = prepareMixedExport(work, options);
  try {
    for (let attempt = 0; requests.length < 3 && attempt < 100; attempt++) await tick();
    await tick();
    assert.deepEqual(requests, work.selected.slice(0, 3).map(item => item.url));
    assert.equal(work.prepared.size, 0, "先頭より前に後続を公開しない");
  } finally {
    releaseHead();
    await execution;
  }
  assert.deepEqual([...work.prepared.keys()], work.selected.filter((_, index) => index !== 2));
  assert.deepEqual([...work.failed.keys()], [work.selected[2]]);
  assert.deepEqual(progress, Array.from({length: 6}, (_, index) => [index + 1, 6]));
  for (const {blob} of work.prepared.values()) assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), Uint8Array.from(pngBytes));
  const retained = new Map(work.prepared);
  requests.length = 0; retry = true;
  await prepareMixedExport(work, options);
  assert.deepEqual(requests, [work.selected[2].url]);
  assert.equal(work.prepared.size, 6);
  assert.equal(work.failed.size, 0);
  for (const [item, prepared] of retained) assert.equal(work.prepared.get(item), prepared);
});

test("原本画像の中止で3件の取得を止め、待機中の後続を開始しない", async t => {
  const work = createWork(), controller = new AbortController(), requested = [], aborted = [];
  t.mock.method(globalThis, "fetch", (url, {signal}) => {
    requested.push(url);
    return new Promise((_, reject) => signal.addEventListener("abort", () => {
      aborted.push(url);
      reject(signal.reason);
    }, {once: true}));
  });
  const execution = prepareMixedExport(work, {
    signal: controller.signal, isStopped: () => controller.signal.aborted,
    onProgress() { assert.fail("中止した結果を通知しない"); },
  });
  const settled = execution.catch(error => { if (error.name !== "AbortError") throw error; });
  try {
    for (let attempt = 0; requested.length < 3 && attempt < 100; attempt++) await tick();
    assert.deepEqual(requested, work.selected.slice(0, 3).map(item => item.url));
  } finally {
    controller.abort();
    await settled;
  }
  assert.deepEqual(aborted, requested);
  assert.equal(requested.length, 3);
  assert.equal(work.prepared.size, 0);
  assert.equal(work.failed.size, 0);
});
