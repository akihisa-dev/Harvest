import assert from "node:assert/strict";
import test from "node:test";
import {isBookmarkPageResult, isPageScan, isXPageState, isXMediaSnapshot} from "../dist/extension/app/contracts/page-contracts.js";
import {PageReadSession} from "../dist/extension/app/browser/page-read-session.js";

const page = {url: "https://example.test/", title: "", images: ["data:image/png;base64,AAAA"]};
const snapshot = {url: page.url, limited: false, posts: [{key: "element:0", observed: [{kind: "video"}],
  roots: [{value: {arbitrary: [1, "unknown evidence"]}, requireIdentity: false, player: true}]}]};

test("ページ契約は正常な省略項目と未解析証拠を許容し、URLポリシーを変更しない", () => {
  assert.equal(isPageScan(page), true);
  assert.equal(isPageScan({...page, media: [{url: "blob:anything", kind: "gif", previewUrl: ""}]}), true);
  for (const status of ["ready", "restricted", "unavailable", "timeout"]) assert.equal(isXPageState({status}), true);
  assert.equal(isXMediaSnapshot(snapshot), true);
  for (const bookmarkList of ["bookmarks", "other"]) assert.equal(isXMediaSnapshot({...snapshot, bookmarkList}), true);
  for (const bookmarkList of [null, true, "likes"]) assert.equal(isXMediaSnapshot({...snapshot, bookmarkList}), false);
  assert.equal(isXMediaSnapshot({url: "", posts: [], limited: true}), true);
});

test("ページ契約は配列の中の不正値や不正な状態を拒否する", () => {
  for (const guard of [isPageScan, isXPageState, isXMediaSnapshot]) {
    for (const value of [null, [], {}, "result"]) assert.equal(guard(value), false);
  }
  for (const value of [
    {...page, title: 1}, {...page, images: [null]}, {...page, media: [{url: "a", kind: "audio"}]},
    {...page, media: [{url: "a", kind: "image", previewUrl: 1}]}, {...page, xDiagnostics: {limited: false}},
  ]) assert.equal(isPageScan(value), false);
  assert.equal(isXPageState({status: "unknown"}), false);
  for (const posts of [[null], [{key: "a", observed: "bad", roots: []}],
    [{key: "a", observed: [{kind: "audio"}], roots: []}],
    [{key: "a", observed: [], roots: [{player: true, requireIdentity: "yes"}]}]]) {
    assert.equal(isXMediaSnapshot({...snapshot, posts}), false);
  }
});

test("続き取得の契約は進んだcursorを必須にし、終端と取得失敗を区別する", () => {
  assert.equal(isBookmarkPageResult({status: "advanced", cursor: "next"}), true);
  for (const status of ["end", "unavailable", "stalled", "failed", "changed"]) {
    assert.equal(isBookmarkPageResult({status}), true);
    assert.equal(isBookmarkPageResult({status, cursor: ""}), true);
  }
  for (const result of [null, [], {}, {status: "advanced"}, {status: "advanced", cursor: ""},
    {status: "advanced", cursor: 1}, {status: "ready"}, {status: "end", cursor: null}]) {
    assert.equal(isBookmarkPageResult(result), false);
  }
});

test("ページ読み取りは不正な受信値を公開せず、初回失敗で出典を確定しない", async t => {
  const previous = globalThis.chrome;
  let result;
  const listeners = new Set();
  globalThis.chrome = {
    tabs: {onRemoved: {addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)}},
    scripting: {executeScript: async () => [{result, documentId: "doc"}]},
  };
  t.after(() => { globalThis.chrome = previous; });
  const session = new PageReadSession(1);
  result = {...page, images: [1]};
  await assert.rejects(session.scanInitialPage(), /ページを読み取れません/);
  assert.equal(listeners.size, 0);
  result = page;
  assert.equal(await session.scanInitialPage(), page);
  session.assertSourceUrl(page.url);
  result = {status: "bogus"};
  await assert.rejects(session.waitForPost(false), /投稿を読み取れません/);
  result = {...page, media: [null]};
  await assert.rejects(session.scanPost(), /投稿を読み取れません/);
  result = {...snapshot, posts: [null]};
  await assert.rejects(session.scanPostMedia(), /動画情報を読み取れません/);
  result = snapshot;
  assert.equal(await session.scanPostMedia(), snapshot);
});

for (const change of ["none", "list", "unknown", "url", "document", "loading"]) {
  test(`Bookmark最終確認は一覧とURL/documentを照合する: ${change}`, async t => {
    const previous = globalThis.chrome, listeners = new Set(), calls = [];
    const url = "https://x.com/i/history";
    globalThis.chrome = {
      tabs: {get: async () => ({url, status: change === "loading" ? "loading" : "complete"}),
        onRemoved: {addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)}},
      scripting: {executeScript: async request => {
        calls.push(request);
        if (request.func.name === "scanDocument") return [{result: {url, title: "Bookmarks", images: []}, documentId: "original"}];
        return [{result: {url: change === "url" ? `${url}?changed` : url, limited: false, posts: [],
          ...(change === "unknown" ? {} : {bookmarkList: change === "list" ? "other" : "bookmarks"})},
        documentId: change === "document" ? "replacement" : "original"}];
      }},
    };
    t.after(() => { globalThis.chrome = previous; });
    const session = new PageReadSession(1);
    await session.scanInitialPage();
    if (["none", "unknown"].includes(change)) await session.verifyCurrentPage(true);
    else await assert.rejects(session.verifyCurrentPage(true), /ページが移動/);
    if (change !== "loading") {
      assert.equal(calls.at(-1).world, "MAIN");
      assert.deepEqual(calls.at(-1).args, [null, [], true]);
    } else assert.equal(calls.length, 1);
    assert.equal(listeners.size, 0);
  });
}
