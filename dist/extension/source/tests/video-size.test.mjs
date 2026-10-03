import assert from "node:assert/strict";
import test from "node:test";
import {fetchVideoSize, createVideoSizeLoader} from "../dist/extension/app/video-size.js";
import {formatFileSize} from "../dist/extension/core/file-size.js";

const item = {url: "https://media.example.test/movie.mp4", sourcePage: "https://page.example.test/", kind: "video"};

test("動画サイズは本文を読まずHEADで確認し、取得先と認証の制限を守る", async t => {
  const requests = [];
  let length = "12345678";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({url, options});
    return new Response(null, {headers: {"content-length": length}});
  });
  assert.equal(await fetchVideoSize(item), 12345678);
  assert.equal(formatFileSize(12345678), "12.3 MB");
  assert.equal(formatFileSize(999), "999 B");
  assert.equal(requests[0].url, item.url);
  assert.equal(requests[0].options.method, "HEAD");
  assert.equal(requests[0].options.credentials, "omit");
  await fetchVideoSize({...item, sourcePage: item.url});
  assert.equal(requests[1].options.credentials, "include");
  assert.equal(requests[1].options.redirect, "error");
  for (length of ["", "0", "-1", "1.5", "9007199254740992"]) assert.equal(await fetchVideoSize(item), null);
  const before = requests.length;
  await assert.rejects(fetchVideoSize({...item, url: "http://127.0.0.1/movie.mp4"}));
  assert.equal(requests.length, before);
});

test("サイズ取得は同時3件までとし、削除後の結果を表示せず失敗時は不明にする", async t => {
  const pending = [];
  t.mock.method(globalThis, "fetch", (url, options) => new Promise(resolve => pending.push({resolve, options})));
  const loader = createVideoSizeLoader({loading: "Checking size…", unknown: "Size unknown"});
  const elements = Array.from({length: 4}, () => ({textContent: "", hidden: true}));
  for (const element of elements) loader.set(element, item);
  assert.equal(pending.length, 3);
  loader.set(elements[0], item);
  assert.equal(pending.length, 3);
  loader.release(elements[0]);
  const previous = elements[0].textContent;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending[0].options.signal.aborted, true);
  assert.equal(pending.length, 4);
  pending[0].resolve(new Response(null, {headers: {"content-length": "1000"}}));
  pending[1].resolve(new Response(null, {headers: {"content-length": "2000"}}));
  pending[2].resolve(new Response(null, {status: 405}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements[0].textContent, previous);
  assert.equal(elements[1].textContent, "2.0 KB");
  assert.match(elements[2].textContent, /Size unknown|サイズ不明/);
  loader.clear();
  assert.equal(pending[3].options.signal.aborted, true);
});
