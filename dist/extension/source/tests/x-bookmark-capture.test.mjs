import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {installXBookmarkCapture} from "../dist/extension/app/content/x-bookmark-capture.js";

function response(ids, clear = false) {
  return {data: {bookmark_timeline_v2: {timeline: {instructions: [
    ...(clear ? [{type: "TimelineClearCache"}] : []),
    {type: "TimelineAddEntries", entries: ids.map(id => ({content: {itemContent: {tweet_results: {result: {
      rest_id: String(id), author: "private author", legacy: {full_text: "private text", extended_entities: {media: [
        {type: "photo", media_url_https: `https://pbs.twimg.com/media/${id}.jpg`},
      ]}},
    }}}}}))},
  ]}}}};
}

function captureFixture() {
  const pending = [], events = new Map();
  const window = {fetch: (...args) => new Promise((resolve, reject) => pending.push({args, resolve, reject}))};
  const location = new URL("https://x.com/i/history");
  class XHR extends EventTarget { open() {} send() {} }
  const context = vm.createContext({window, location, URL, Request, XMLHttpRequest: XHR,
    history: {pushState() {}, replaceState() {}}, addEventListener: (name, listener) => events.set(name, listener)});
  vm.runInContext(`(${installXBookmarkCapture.toString()})()`, context);
  return {
    window, pending, events,
    request(cursor, operation = "Bookmarks") {
      return window.fetch(`/i/api/graphql/fixture/${operation}?variables=${encodeURIComponent(JSON.stringify(cursor ? {cursor} : {}))}`);
    },
    snapshot: () => structuredClone(window.__harvestBookmarkMediaV1()),
    complete(index, value) { pending[index].resolve(new Response(JSON.stringify(value), {headers: {"content-type": "application/json"}})); },
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("新しい先頭取得の後に到着した古い成功と失敗は現在の一覧へ混入しない", async () => {
  const fixture = captureFixture();
  const oldHead = fixture.request();
  await settle();
  const oldNext = fixture.request("next");
  await settle();
  const currentHead = fixture.request();
  await settle();
  fixture.complete(2, response([9]));
  assert.deepEqual(await (await currentHead).json(), response([9]), "呼出し元にも元の応答を返す");
  await settle();
  fixture.complete(0, response([1]));
  await oldHead;
  fixture.pending[1].reject(new Error("old request failed"));
  await assert.rejects(oldNext, /old request failed/);
  await settle();
  const snapshot = fixture.snapshot();
  assert.deepEqual(snapshot.posts.map(post => post.postId), ["9"]);
  assert.equal(snapshot.limited, false);
  assert.equal(snapshot.received, true);
  assert.equal(fixture.pending.length, 3, "観察以外の追加要求を行わない");
});

test("一覧内のキャッシュ消去は世代を保ち、失敗と画面切替で保持状態を正しく区別する", async () => {
  const fixture = captureFixture();
  let work = fixture.request();
  fixture.complete(0, response([1]));
  await work;
  await settle();
  const initial = fixture.snapshot();
  fixture.window.__harvestBookmarkScanMemoryV1 = {posts: ["old"]};
  work = fixture.request("next");
  fixture.complete(1, response([2], true));
  await work;
  await settle();
  const cleared = fixture.snapshot();
  assert.deepEqual(cleared.posts.map(post => post.postId), ["2"]);
  assert.equal(cleared.epoch, initial.epoch + 1);
  assert.equal(fixture.window.__harvestBookmarkScanMemoryV1, undefined);
  assert.equal(JSON.stringify(cleared).includes("private"), false);
  work = fixture.request("later");
  fixture.complete(2, {data: {unknown: true}});
  await work;
  await settle();
  assert.deepEqual(fixture.snapshot().posts, cleared.posts);
  assert.equal(fixture.snapshot().limited, true);
  work = fixture.request(undefined, "Likes");
  fixture.complete(3, response([99]));
  await work;
  await settle();
  assert.deepEqual(fixture.snapshot(), {posts: [], limited: false, received: false, epoch: cleared.epoch + 1});
});
