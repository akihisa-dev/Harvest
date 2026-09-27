import assert from "node:assert/strict";
import test from "node:test";
import { scanTab, scanUrl } from "../dist/extension/app/page-access.js";

function fixture(t, overrides = {}) {
  const updated = new Set();
  const removed = new Set();
  const closed = [];
  const previous = globalThis.chrome;
  globalThis.chrome = {
    tabs: {
      create: async () => ({id: 8}),
      get: async () => ({status: "complete", url: "https://example.com/page"}),
      remove: async id => { closed.push(id); },
      onUpdated: {addListener: fn => updated.add(fn), removeListener: fn => updated.delete(fn)},
      onRemoved: {addListener: fn => removed.add(fn), removeListener: fn => removed.delete(fn)},
      ...overrides,
    },
    scripting: {executeScript: async () => [{result: {url: "https://example.com/page", title: "page", images: []}}]},
  };
  t.after(() => { globalThis.chrome = previous; });
  return {updated, removed, closed};
}

test("一時タブの読み込み完了後に解析し、タブと待機リスナーを解放する", async t => {
  const state = fixture(t);
  assert.equal((await scanUrl("https://example.com/page")).title, "page");
  assert.deepEqual(state.closed, [8]);
  assert.equal(state.updated.size + state.removed.size, 0);
});

test("タブが途中で閉じられた場合は時間切れを待たずに失敗し後始末する", async t => {
  const state = fixture(t, {get: async () => ({status: "loading"})});
  const work = scanUrl("https://example.com/page");
  const rejected = assert.rejects(work, /閉じられました/);
  await Promise.resolve();
  for (const listener of state.removed) listener(8);
  await rejected;
  assert.deepEqual(state.closed, [8]);
  assert.equal(state.updated.size + state.removed.size, 0);
});

test("一時タブの取得失敗でもリスナーとタブを解放する", async t => {
  const state = fixture(t, {get: async () => { throw new Error("missing tab"); }});
  await assert.rejects(scanUrl("https://example.com/page"), /開けません/);
  assert.deepEqual(state.closed, [8]);
  assert.equal(state.updated.size + state.removed.size, 0);
});

test("読み込みが完了しないタブは時間切れになり解放される", async t => {
  const state = fixture(t, {get: async () => ({status: "loading"})});
  t.mock.timers.enable({apis: ["setTimeout"]});
  const rejected = assert.rejects(scanUrl("https://example.com/page"), /時間切れ/);
  await Promise.resolve();
  t.mock.timers.tick(20000);
  await rejected;
  assert.deepEqual(state.closed, [8]);
  assert.equal(state.updated.size + state.removed.size, 0);
});

test("パネル終了による中断は待機を解放し、遅い解析結果を受け取らない", async t => {
  const state = fixture(t);
  let finish;
  chrome.scripting.executeScript = () => new Promise(resolve => { finish = resolve; });
  const controller = new AbortController();
  const rejected = assert.rejects(scanUrl("https://example.com/page", controller.signal), /終了しました/);
  for (let i = 0; i < 5 && !finish; i++) await Promise.resolve();
  assert.ok(finish);
  controller.abort();
  await rejected;
  finish([{result: {url: "https://example.com/page", title: "late", images: []}}]);
  assert.deepEqual(state.closed, [8]);
  assert.equal(state.updated.size + state.removed.size, 0);
});

test("解析中に別ページへ移動したタブの古い結果を採用しない", async t => {
  fixture(t, {get: async () => ({url: "https://example.com/next"})});
  await assert.rejects(scanTab(8), /ページが移動/);
});

test("解析自体が応答しない場合にも時間切れになる", async t => {
  fixture(t);
  t.mock.timers.enable({apis: ["setTimeout"]});
  chrome.scripting.executeScript = () => new Promise(() => {});
  const rejected = assert.rejects(scanTab(8), /時間切れ/);
  t.mock.timers.tick(20000);
  await rejected;
});

test("読み込み後の解析中にタブが閉じられても即座に失敗する", async t => {
  const state = fixture(t);
  chrome.scripting.executeScript = () => new Promise(() => {});
  const rejected = assert.rejects(scanTab(8), /閉じられました/);
  for (const listener of state.removed) listener(8);
  await rejected;
  assert.equal(state.removed.size, 0);
});
