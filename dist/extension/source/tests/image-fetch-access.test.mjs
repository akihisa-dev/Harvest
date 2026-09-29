import assert from "node:assert/strict";
import test from "node:test";
import {fetchImage} from "../dist/extension/app/image-fetch.js";

test("画像取得は出典と同じオリジンだけ認証情報を使い、認証付き転送を拒否する", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({url, credentials: options.credentials, redirect: options.redirect});
    return new Response(new Uint8Array([1]), {headers: {"content-type": "image/png"}});
  };
  try {
    await fetchImage("https://example.test/a.png", {sourcePage: "https://example.test/gallery"});
    await fetchImage("https://cdn.example.test/a.png", {sourcePage: "https://example.test/gallery"});
    await fetchImage("https://example.test/a.png", {sourcePage: "http://example.test/gallery"});
    await fetchImage("https://example.test/a.png", {});
    assert.deepEqual(requests, [
      {url: "https://example.test/a.png", credentials: "include", redirect: "error"},
      {url: "https://cdn.example.test/a.png", credentials: "omit", redirect: "follow"},
      {url: "https://example.test/a.png", credentials: "omit", redirect: "follow"},
      {url: "https://example.test/a.png", credentials: "omit", redirect: "follow"},
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("公開ページが差し込んだローカル宛先や資格情報付きURLは通信前に拒否する", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("通信してはいけません"); };
  try {
    for (const url of [
      "http://127.0.0.1/private.png",
      "http://192.168.1.5/private.png",
      "http://[::1]/private.png",
      "http://router.local/private.png",
      "https://user:secret@other.example.test/a.png",
    ]) {
      await assert.rejects(fetchImage(url, {sourcePage: "https://example.test/gallery"}), error =>
        error.kind === "invalid-image" && /取得できません/.test(error.message));
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
