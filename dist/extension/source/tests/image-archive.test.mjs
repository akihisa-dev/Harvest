import assert from "node:assert/strict";
import test from "node:test";
import {ImageArchiveLimitError, ImageArchivePlan, createImageZipEntries} from "../dist/extension/core/image-archive.js";
import {mediaTypeMatchesKind, originalMediaType} from "../dist/extension/core/media-types.js";
import {storedZipDataLimit} from "../dist/extension/core/stored-zip.js";
import {prepareImageArchive} from "../dist/extension/app/image-archive-preparation.js";

const item = (name, kind) => ({url: `https://example.test/${name}`, sourcePage: "https://example.test/page", selected: true, ...(kind ? {kind} : {})});
const gif = new TextEncoder().encode("GIF89a");
const fakeSizedBlob = (size, type = "image/png") => ({size, type});

test("取得とZIP命名は同じMIME分類を使い、種類未指定画像のGIF互換を保つ", () => {
  for (const [mime, extension, kind] of [
    ["image/jpeg", "jpg", "image"], ["image/png", "png", "image"], ["image/gif", "gif", "gif"],
    ["image/webp", "webp", "image"], ["image/jxl", "jxl", "image"], ["image/avif", "avif", "image"],
    ["image/heic", "heic", "image"], ["image/heif", "heif", "image"], ["image/bmp", "bmp", "image"],
    ["image/tiff", "tif", "image"], ["video/mp4", "mp4", "video"], ["video/webm", "webm", "video"],
  ]) {
    const type = originalMediaType(` ${mime.toUpperCase()}; charset=binary `);
    assert.equal(type.extension, extension);
    assert.equal(type.kind, kind);
    const selected = item(extension, kind);
    const blob = new Blob([extension], {type: mime});
    const entries = createImageZipEntries([selected], new Map([[selected, blob]]), "original");
    assert.equal(entries[0].filename, `001.${extension}`);
    assert.equal(entries[0].blob, blob, "元のBlobを複製しない");
  }
  assert.equal(originalMediaType("image/svg+xml"), undefined);
  assert.equal(originalMediaType("text/html"), undefined);
  assert.equal(mediaTypeMatchesKind("image", "gif"), true);
  assert.equal(mediaTypeMatchesKind("gif", "image"), false);
  assert.equal(mediaTypeMatchesKind("image", "video"), false);
  const legacy = item("legacy");
  assert.equal(createImageZipEntries([legacy], new Map([[legacy, new Blob([gif], {type: "image/gif"})]]), "original")[0].filename, "001.gif");
});

test("ZIP容量は再試行の成功分を含めて加算し、超過画像を保持しない", () => {
  const selected = [item("first"), item("second")];
  const limit = storedZipDataLimit(["001.png", "002.png"]);
  const existing = fakeSizedBlob(limit - 4);
  const prepared = new Map([[selected[0], existing]]);
  const plan = new ImageArchivePlan(selected, prepared, "png");
  assert.equal(plan.remainingBytes, 4);
  assert.throws(() => plan.retain(selected[1], fakeSizedBlob(5)), ImageArchiveLimitError);
  assert.equal(prepared.size, 1);
  assert.equal(plan.remainingBytes, 4);
  const last = fakeSizedBlob(4);
  plan.retain(selected[1], last);
  assert.equal(plan.remainingBytes, 0);
  assert.deepEqual(plan.entries().map(entry => entry.blob), [existing, last]);
  assert.throws(() => new ImageArchivePlan(selected, new Map([[selected[0], fakeSizedBlob(limit + 1)]]), "png"), ImageArchiveLimitError);
});

test("元形式は実際の拡張子で容量を再確認し、取得前の概算だけで保存しない", () => {
  const selected = [item("animation", "video")];
  const optimisticLimit = storedZipDataLimit(["001.jpg"]);
  const prepared = new Map();
  const plan = new ImageArchivePlan(selected, prepared, "original");
  plan.retain(selected[0], fakeSizedBlob(optimisticLimit, "video/webm"));
  assert.equal(plan.remainingBytes, 0);
  assert.throws(() => plan.entries(), ImageArchiveLimitError);
});

test("メディアの不一致は容量超過より先に判定し、未準備や不明形式の理由も維持する", () => {
  const selected = [item("animation", "gif")];
  const prepared = new Map();
  const plan = new ImageArchivePlan(selected, prepared, "gif");
  assert.throws(() => plan.retain(selected[0], fakeSizedBlob(0xffffffff, "video/mp4")), {
    name: "RangeError", message: "選択項目と保存データの形式が一致しません。",
  });
  assert.throws(() => plan.retain(selected[0], fakeSizedBlob(0xffffffff, "text/html")), {
    name: "RangeError", message: "保存するデータの形式を確認できません。",
  });
  assert.throws(() => plan.entries(), {name: "RangeError", message: "保存する画像が準備されていません。"});
  assert.equal(prepared.size, 0);
});

test("画面から独立した準備は成功結果を保持し、失敗分だけを再取得して入力順へ戻す", async () => {
  const previousFetch = globalThis.fetch;
  const selected = [item("first", "gif"), item("second", "gif"), item("third", "gif")];
  const work = {format: "gif", selected, prepared: new Map(), failed: new Map()};
  const requests = [];
  const progress = [];
  let failing = true;
  const controller = new AbortController();
  const options = {signal: controller.signal, isStopped: () => controller.signal.aborted, fallbackFailure: "fallback",
    onProgress: (...value) => progress.push(value)};
  globalThis.fetch = async url => {
    requests.push(url);
    return url === selected[1].url && failing
      ? new Response(null, {status: 404})
      : new Response(gif, {headers: {"content-type": "image/gif"}});
  };
  try {
    assert.equal(await prepareImageArchive(work, options), null);
    assert.deepEqual([...work.prepared.keys()], [selected[0], selected[2]]);
    assert.deepEqual([...work.failed], [[selected[1], "メディアが見つかりませんでした。"]]);
    assert.deepEqual(progress, [[1, 3], [2, 3], [3, 3]]);
    const retained = work.prepared.get(selected[0]);
    requests.length = progress.length = 0;
    failing = false;
    const entries = await prepareImageArchive(work, options);
    assert.deepEqual(requests, [selected[1].url]);
    assert.deepEqual(progress, [[1, 1]]);
    assert.equal(work.failed.size, 0);
    assert.equal(work.prepared.get(selected[0]), retained);
    assert.deepEqual(entries.map(entry => entry.filename), ["001.gif", "002.gif", "003.gif"]);
    assert.equal(entries[0].blob, retained);
  } finally { globalThis.fetch = previousFetch; }
});

test("準備開始直後の中止では通信も進捗通知も開始しない", async () => {
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  let requested = 0;
  globalThis.fetch = async () => { requested += 1; throw new Error("must not fetch"); };
  try {
    const work = {format: "gif", selected: [item("first", "gif")], prepared: new Map(), failed: new Map()};
    const execution = prepareImageArchive(work, {
      signal: controller.signal, isStopped: () => controller.signal.aborted, fallbackFailure: "fallback",
      onProgress() { assert.fail("中止した作業は進捗を進めない"); },
    });
    controller.abort();
    assert.equal(await execution, null);
    assert.equal(requested, 0);
    assert.equal(work.prepared.size, 0);
    assert.equal(work.failed.size, 0);
  } finally { globalThis.fetch = previousFetch; }
});
