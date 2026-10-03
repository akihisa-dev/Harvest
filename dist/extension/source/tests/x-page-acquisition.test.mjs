import assert from "node:assert/strict";
import test from "node:test";
import {acquireXPage, xPageTarget} from "../dist/extension/app/browser/x-page-acquisition.js";
import {mergeBookmarkSnapshots, supplementXSnapshot} from "../dist/extension/app/browser/x-scan-evidence.js";

const url = "https://x.com/i/history";
const photo = id => ({key: `post:${id}`, postId: String(id),
  observed: [{kind: "image", url: `https://pbs.twimg.com/media/${id}.jpg`}], roots: []});
const snapshot = posts => ({url, posts, limited: false, bookmarkList: "bookmarks", bookmarkContinuation: true});
const page = () => ({url, title: "Bookmarks", images: []});

test("続きの一覧順を優先し、画面外投稿と古い証拠を保持して入力を変更しない", () => {
  const previous = snapshot([1, 2, 3, 4].map(photo));
  previous.limited = true;
  const next = snapshot([3, 5, 2].map(photo));
  next.posts[2].observed.push({kind: "video", url: "blob:old-player"});
  const before = structuredClone({previous, next});
  const result = mergeBookmarkSnapshots(previous, next);
  assert.deepEqual(result.posts.map(post => post.postId), ["3", "5", "1", "2", "4"]);
  assert.equal(result.limited, true);
  assert.deepEqual(result.posts.find(post => post.postId === "2").observed, next.posts[2].observed);
  assert.deepEqual({previous, next}, before);
  assert.deepEqual(mergeBookmarkSnapshots(snapshot([1, 2].map(photo)), snapshot([3, 4].map(photo)))
    .posts.map(post => post.postId), ["1", "2", "3", "4"]);
});

test("不足再読は元の投稿順と消えた観測を保持し、無関係な新しい投稿を追加しない", () => {
  const previous = snapshot([photo(1), photo(2)]);
  previous.posts[0].observed.push({kind: "video", previewUrl: "https://pbs.twimg.com/amplify_video_thumb/1.jpg"});
  const retry = snapshot([{...photo(1), observed: [], roots: [{value: {url: "https://video.twimg.com/1.mp4"}, player: true, requireIdentity: false}]}, photo(99)]);
  retry.limited = true;
  const result = supplementXSnapshot(previous, retry);
  assert.deepEqual(result.posts.map(post => post.postId), ["1", "2"]);
  assert.deepEqual(result.posts[0].observed, previous.posts[0].observed);
  assert.deepEqual(result.posts[0].roots, retry.posts[0].roots);
  assert.equal(result.posts[1], previous.posts[1]);
  assert.equal(result.limited, true);
  assert.deepEqual(previous.posts[0].roots, []);
});

test("停止要求は進行中の続き取得を待ち、その応答を取り込んでから次の取得を止める", async () => {
  let stop = false, finish;
  const calls = [], progress = [];
  let reads = 0;
  const reader = {
    async scanPostMedia() { calls.push("read"); return snapshot((++reads === 1 ? [1] : [1, 2]).map(photo)); },
    assertSourceUrl(source) { assert.equal(source, url); },
    fetchBookmarkPage() { calls.push("fetch"); return new Promise(resolve => { finish = resolve; }); },
    waitForPost() { throw new Error("Loaded bookmarks must not wait for a post"); },
    scanPost() { throw new Error("Loaded bookmarks must not replace the initial scan"); },
    waitForMediaRetry() { throw new Error("Complete media must not retry"); },
  };
  const work = acquireXPage(reader, page(), xPageTarget(url), undefined, {
    shouldStop: () => stop, onProgress: count => progress.push(count),
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["read", "fetch"]);
  stop = true;
  finish({status: "advanced", cursor: "next"});
  const result = await work;
  assert.deepEqual(calls, ["read", "fetch", "read"]);
  assert.deepEqual(progress, [1, 2]);
  assert.deepEqual(result.result.images, [1, 2].map(id => `https://pbs.twimg.com/media/${id}?format=jpg&name=orig`));
  assert.equal(result.result.xDiagnostics.bookmarkStopped, true);
  assert.equal(result.result.xDiagnostics.bookmarkIncomplete, true);
  assert.equal(result.checkBookmarkList, true);
});

for (const status of ["end", "failed"]) test(`続き取得の${status}でも最後の再読を統合し、完了と部分取得を区別する`, async () => {
  let reads = 0;
  const calls = [];
  const reader = {
    async scanPostMedia() { calls.push("read"); return snapshot([photo(++reads)]); },
    assertSourceUrl() {},
    async fetchBookmarkPage() { calls.push("fetch"); return {status}; },
    waitForPost() { throw new Error("unexpected wait"); },
    scanPost() { throw new Error("unexpected rescan"); },
    waitForMediaRetry() { throw new Error("unexpected retry"); },
  };
  const result = await acquireXPage(reader, page(), xPageTarget(url));
  assert.deepEqual(calls, ["read", "fetch", "read"]);
  assert.equal(result.result.images.length, 2);
  assert.equal(result.result.xDiagnostics.bookmarkIncomplete, status === "failed" ? true : undefined);
});
