import {gifBytes} from './media-fixtures.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import {ImageArchiveLimitError} from "../dist/extension/core/image-archive.js";
import {mediaTypeMatchesKind, originalMediaType} from "../dist/extension/core/media-types.js";
import {createStoredZip, storedZipDataLimit} from "../dist/extension/core/stored-zip.js";
import {indexedExportFilename} from "../dist/extension/core/split-export-formats.js";
import {prepareMixedExport} from "../dist/extension/app/media/mixed-export-preparation.js";
const mixedWork = selected => ({selected, imageFormat: "original", resolvedImageFormat: "original", videoFormat: "original", includeSourcePage: false, prepared: new Map(), failed: new Map(), saved: new Set()});

const item = (name, kind) => ({url: `https://example.test/${name}`, sourcePage: "https://example.test/page", selected: true, ...(kind ? {kind} : {})});
const gif = gifBytes;
const fakeSizedBlob = (size, type = "image/png") => ({size, type});

test("取得とZIP命名は同じMIME分類を使い、種類未指定画像のGIF互換を保つ", () => {
  for (const [mime, extension, kind] of [
    ["image/jpeg", "jpg", "image"],
    ["image/png", "png", "image"],
    ["image/gif", "gif", "gif"],
    ["image/webp", "webp", "image"],
    ["image/jxl", "jxl", "image"],
    ["image/avif", "avif", "image"],
    ["image/heic", "heic", "image"],
    ["image/heif", "heif", "image"],
    ["image/bmp", "bmp", "image"],
    ["image/tiff", "tif", "image"],
    ["video/mp4", "mp4", "video"],
    ["video/webm", "webm", "video"],
  ]) {
    const type = originalMediaType(` ${mime.toUpperCase()}; charset=binary `);
    assert.equal(type.extension, extension);
    assert.equal(type.kind, kind);
    assert.equal(indexedExportFilename(0, 1, type.extension), `001.${extension}`);
  }
  assert.equal(originalMediaType("image/svg+xml"), undefined);
  assert.equal(originalMediaType("text/html"), undefined);
  assert.equal(mediaTypeMatchesKind("image", "gif"), true);
  assert.equal(mediaTypeMatchesKind("gif", "image"), false);
  assert.equal(mediaTypeMatchesKind("image", "video"), false);
  assert.equal(indexedExportFilename(0, 1, originalMediaType("image/gif").extension), "001.gif");
});

test("mixed ZIP容量は再試行の成功分を加算し、超過画像を保持しない", async t => {
  const selected = [item("first"), item("second")];
  const limit = storedZipDataLimit(["001.webm", "002.webm"]);
  const controller = new AbortController();
  const options = {signal: controller.signal, isStopped: () => false, onProgress() {}};
  const response = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {type: "image/png"});
  t.mock.method(globalThis, "fetch", async () => new Response(response));
  const existing = {blob: fakeSizedBlob(limit - response.size + 1)};
  const work = mixedWork(selected);
  work.prepared.set(selected[0], existing);
  await assert.rejects(prepareMixedExport(work, options), ImageArchiveLimitError);
  assert.equal(work.prepared.size, 1);
  assert.equal(work.prepared.get(selected[0]), existing);
  assert.equal(work.failed.size, 0);

  existing.blob = fakeSizedBlob(limit - response.size);
  await prepareMixedExport(work, options);
  assert.equal(work.prepared.size, 2);
  assert.equal(work.prepared.get(selected[1]).blob.size, response.size);
  assert.equal(work.prepared.get(selected[0]), existing);

  const oversized = mixedWork(selected);
  oversized.prepared.set(selected[0], {blob: fakeSizedBlob(limit + 1)});
  let fetched = false;
  t.mock.method(globalThis, "fetch", () => {fetched = true; assert.fail("既存成功分の上限判定前に取得しない");});
  await assert.rejects(prepareMixedExport(oversized, options), ImageArchiveLimitError);
  assert.equal(fetched, false);
});

test("元形式のZIP容量は実際の拡張子で再確認し、概算だけで保存しない", async () => {
  const selected = [item("animation", "video")];
  const optimisticLimit = storedZipDataLimit(["001.jpg"]);
  const blob = fakeSizedBlob(optimisticLimit, "video/webm");
  const entries = [{filename: indexedExportFilename(0, selected.length, originalMediaType(blob.type).extension), blob}];
  assert.equal(entries[0].filename, "001.webm");
  assert.equal(entries[0].blob, blob);
  await assert.rejects(createStoredZip(entries), /ZIP全体がZIP形式の上限を超えています/);
});

test("mixed準備は媒体不一致・不明形式を失敗として保持し、未準備結果を保存可能にしない", async t => {
  const selected = [item("animation", "gif")];
  const controller = new AbortController();
  for (const [bytes, mime] of [[gif, "video/mp4"], ["html", "text/html"]]) {
    t.mock.method(globalThis, "fetch", async () => new Response(bytes, {headers: {"content-type": mime}}));
    const work = mixedWork(selected);
    assert.equal(work.prepared.has(selected[0]), false);
    await prepareMixedExport(work, {signal: controller.signal, isStopped: () => false, onProgress() {}});
    assert.equal(work.prepared.has(selected[0]), false, "不一致を準備済みに登録しない");
    assert.equal(work.failed.size, 1);
    assert.match(work.failed.get(selected[0]), /形式|種類/);
  }
});

test("画面から独立した準備は成功結果を保持し、失敗分だけを再取得して入力順へ戻す", async () => {
  const previousFetch = globalThis.fetch;
  const selected = [item("first", "gif"), item("second", "gif"), item("third", "gif")];
  const work = mixedWork(selected);
  const requests = [];
  const progress = [];
  let failing = true;
  const controller = new AbortController();
  const options = {
    signal: controller.signal,
    isStopped: () => controller.signal.aborted,
    onProgress: (...value) => progress.push(value)
  };
  globalThis.fetch = async url => {
    requests.push(url);
    return url === selected[1].url && failing
      ? new Response(null, {status: 404})
      : new Response(gif, {headers: {"content-type": "image/gif"}});
  };
  try {
    await prepareMixedExport(work, options);
    assert.deepEqual([...work.prepared.keys()], [selected[0], selected[2]]);
    assert.deepEqual([...work.failed], [[selected[1], "メディアが見つかりませんでした。"]]);
    assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
    const retained = work.prepared.get(selected[0]);
    requests.length = progress.length = 0;
    failing = false;
    await prepareMixedExport(work, options);
    const entries = selected.map((item, index) => ({filename: indexedExportFilename(index, selected.length, originalMediaType(work.prepared.get(item).blob.type).extension), blob: work.prepared.get(item).blob}));
    assert.deepEqual(requests, [selected[1].url]);
    assert.deepEqual(progress, [[1, 1]]);
    assert.equal(work.failed.size, 0);
    assert.equal(work.prepared.get(selected[0]), retained);
    assert.deepEqual(entries.map(entry => entry.filename), ["001.gif", "002.gif", "003.gif"]);
    assert.equal(entries[0].blob, retained.blob);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("準備開始直後の中止では通信も進捗通知も開始しない", async () => {
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  let requested = 0;
  globalThis.fetch = async () => {
    requested += 1;
    throw new Error("must not fetch");
  };
  try {
    const work = mixedWork([item("first", "gif")]);
    const execution = prepareMixedExport(work, {
      signal: controller.signal,
      isStopped: () => controller.signal.aborted,
        onProgress() { assert.fail("中止した作業は進捗を進めない"); },
    });
    controller.abort();
    await execution;
    assert.equal(requested, 0);
    assert.equal(work.prepared.size, 0);
    assert.equal(work.failed.size, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("mixed推奨の原本経路は実レスポンスのGIF/PNGと元Blobを保持する", async t => {
  const selected = [item("no-extension", "image"), item("static.webp", "image")];
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  t.mock.method(globalThis, "fetch", async url => new Response(url === selected[0].url ? gif : png, {headers: {"content-type": url === selected[0].url ? "image/gif" : "image/png"}}));
  const work = {...mixedWork(selected), imageFormat: "recommend", resolvedImageFormat: "original"};
  await prepareMixedExport(work, {signal: new AbortController().signal, isStopped: () => false, onProgress() {}});
  assert.equal(work.failed.size, 0);
  assert.equal(selected[0].recommendedFormat, "gif");
  assert.deepEqual(selected.map(item => work.prepared.get(item).blob.type), ["image/gif", "image/png"]);
  assert.deepEqual([...new Uint8Array(await work.prepared.get(selected[0]).blob.arrayBuffer())], [...gif]);
  assert.deepEqual([...new Uint8Array(await work.prepared.get(selected[1]).blob.arrayBuffer())], [...png]);
  assert.deepEqual(selected.map((item, index) => indexedExportFilename(index, selected.length, originalMediaType(work.prepared.get(item).blob.type).extension)), ["001.gif", "002.png"]);
});
