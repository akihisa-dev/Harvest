import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {chromium} from "playwright";

const extensionRoot = resolve(process.env.HARVEST_TEST_EXTENSION_DIR ?? fileURLToPath(new URL("../dist/extension/", import.meta.url)));
const modules = Object.fromEntries(await Promise.all(["page-scan", "x-page-state", "x-media-scan"].map(async name =>
  [name, await readFile(resolve(extensionRoot, "app", `${name}.js`), "utf8")])));
const post = (id, content) => `<article data-testid="tweet" id="post-${id}"><a role="link" href="/user/status/${id}"><time>Today</time></a>${content}</article>`;
const photo = name => `<a role="link" href="/user/status/123/photo/1"><img src="https://pbs.twimg.com/media/${name}.jpg" width="40" height="40"></a>`;

test("履歴画面で遅れて表示される投稿と引用の複数写真・動画を読み取る", async () => {
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.route("https://x.com/**", route => route.fulfill({contentType: "text/html", body: "<!doctype html><main></main>"}));
    await page.route("https://pbs.twimg.com/**", route => route.abort());
    await page.goto("https://x.com/i/history");
    const result = await page.evaluate(async sources => {
      const loaded = {};
      for (const [name, source] of Object.entries(sources)) {
        const url = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
        try { loaded[name] = await import(url); }
        finally { URL.revokeObjectURL(url); }
      }
      const main = document.querySelector("main");
      main.innerHTML = '<img src="https://pbs.twimg.com/profile_images/1/person.jpg">';
      const before = await loaded["page-scan"].scanDocument();
      setTimeout(() => {
        const article = document.createElement("article");
        article.dataset.testid = "tweet";
        article.innerHTML = '<a href="/user/status/123"><time>Today</time></a><img src="https://pbs.twimg.com/media/first?format=jpg&name=small">';
        article.__reactFiber$fixture = {memoizedProps: {}, return: {memoizedProps: {tweet: {
          rest_id: "123", legacy: {extended_entities: {media: [
            {type: "photo", media_url_https: "https://pbs.twimg.com/media/first.jpg"},
            {type: "photo", media_url_https: "https://pbs.twimg.com/media/second.jpg"},
            {type: "video", media_url_https: "https://pbs.twimg.com/media/poster.jpg",
              video_info: {variants: [{url: "https://video.twimg.com/clip.mp4", content_type: "video/mp4"}]}},
          ]}, quoted_status: {rest_id: "456", legacy: {extended_entities: {media: [
            {type: "photo", media_url_https: "https://pbs.twimg.com/media/quoted.jpg"},
          ]}}}},
        }}, return: null}};
        main.append(article);
      }, 350);
      const state = await loaded["x-page-state"].waitForXPage(false, 2_000);
      return {before, state, after: await loaded["page-scan"].scanDocument(),
        media: loaded["x-media-scan"].scanXMedia(), scoped: loaded["x-media-scan"].scanXMedia("123")};
    }, modules);
    assert.deepEqual(result.before.images, ["https://pbs.twimg.com/profile_images/1/person.jpg"]);
    assert.equal(result.state.status, "ready");
    assert.ok(result.after.images.includes("https://pbs.twimg.com/media/first?format=jpg&name=small"));
    assert.deepEqual(new Set(result.media.map(item => item.url)), new Set([
      "https://pbs.twimg.com/media/first.jpg", "https://pbs.twimg.com/media/second.jpg",
      "https://pbs.twimg.com/media/quoted.jpg", "https://video.twimg.com/clip.mp4",
    ]));
    assert.equal(result.media.find(item => item.kind === "video").previewUrl, "https://pbs.twimg.com/media/poster.jpg");
    assert.equal(result.scoped.some(item => item.url.includes("quoted")), false);
    assert.equal(result.scoped.filter(item => item.kind === "image").length, 2);
  } finally { await browser.close(); }
});

test("Xの対象投稿IDを待機・DOM・再生情報の全経路で照合し、他投稿を代用しない", async () => {
  const browser = await chromium.launch({channel: "chrome", headless: true});
  try {
    const page = await browser.newPage();
    await page.route("https://x.com/**", route => route.fulfill({contentType: "text/html", body: "<!doctype html><title>Post</title>"}));
    await page.route("https://pbs.twimg.com/**", route => route.abort());
    await page.route("https://video.twimg.com/**", route => route.abort());
    await page.goto("https://x.com/user/status/123/video/1");
    await page.evaluate(async sources => {
      window.scopedModules = {};
      for (const [name, source] of Object.entries(sources)) {
        const url = URL.createObjectURL(new Blob([source], {type: "text/javascript"}));
        try {
          window.scopedModules[name] = await import(url);
        }
        finally {
          URL.revokeObjectURL(url);
        }
      }
    }, modules);

    const run = async (html, expectVideo = false, setup) => {
      await page.evaluate(markup => { document.body.innerHTML = markup; }, html);
      if (setup) await page.evaluate(setup);
      return await page.evaluate(async video => {
        const {waitForXPage} = window.scopedModules["x-page-state"];
        const {scanDocument} = window.scopedModules["page-scan"];
        const {scanXMedia} = window.scopedModules["x-media-scan"];
        const state = await waitForXPage(video, 650, "123");
        let scan;
        try {
          scan = await scanDocument("123");
        } catch {
          scan = null;
        }
        return {state, scan, extra: scanXMedia("123")};
      }, expectVideo);
    };

    const deleted = await run(`<main><div>This Post was deleted</div>${post("999", photo("other"))}</main>`);
    assert.deepEqual(deleted, {state: {status: "unavailable"}, scan: null, extra: []});
    const restricted = await run(`<main><div>This Post is only available in the X app</div>${post("999", '<video src="https://video.twimg.com/other.mp4"></video>')}</main>`, true, () => {
      document.querySelector("video").__reactProps$fixture = {src: "https://video.twimg.com/other.mp4"};
    });
    assert.deepEqual(restricted, {state: {status: "restricted"}, scan: null, extra: []});

    const quoted = `<div role="link"><a href="/quoted/status/777"><time>Yesterday</time></a>${photo("quoted")}<video src="https://video.twimg.com/quoted.mp4"></video></div>`;
    const normal = await run(`<main>${post("123", `${photo("target")}<div data-testid="tweetText">This Post was deleted</div>${quoted}<video id="target-video" src="https://video.twimg.com/target.mp4"></video>`)}${post("456", photo("reply"))}<section aria-label="Recommendations">${post("999", photo("recommended"))}</section></main>`, true, () => {
      const media = url => ({video_info: {variants: [{url, content_type: "video/mp4", bitrate: 10}]}});
      const target = {
        rest_id: "123",
        legacy: {
          extended_entities: {media: [media("https://video.twimg.com/target-state.mp4")]},
          quoted_status: {rest_id: "777", extended_entities: {media: [media("https://video.twimg.com/quoted-state.mp4")]}}
        }
      };
      const unrelated = {rest_id: "999", legacy: {extended_entities: {media: [media("https://video.twimg.com/other-state.mp4")]}}};
      document.querySelector("#post-123").__reactFiber$fixture = {
        memoizedProps: {role: "article"},
        return: {
          memoizedProps: {tweet: target, tweetResults: [unrelated]}, return: null,
        }
      };
      document.querySelector("#target-video").__reactFiber$fixture = {
        memoizedProps: {role: "video"},
        return: {
          memoizedProps: {media: {variants: [{url: "https://video.twimg.com/unowned-ancestor.mp4", content_type: "video/mp4"}]}},
          return: null,
        }
      };
      document.querySelector("#post-999").__reactProps$fixture = {tweet: unrelated};
    });
    assert.equal(normal.state.status, "ready");
    assert.deepEqual(normal.scan.images, ["https://pbs.twimg.com/media/target.jpg"]);
    assert.deepEqual(new Set(normal.scan.media.map(item => item.url)), new Set(["https://pbs.twimg.com/media/target.jpg", "https://video.twimg.com/target.mp4"]));
    assert.deepEqual(normal.extra, [{url: "https://video.twimg.com/target-state.mp4", kind: "video"}]);

    const timeline = await page.evaluate(async () => ({
      scan: await window.scopedModules["page-scan"].scanDocument(),
      extra: window.scopedModules["x-media-scan"].scanXMedia(),
    }));
    assert.ok(timeline.scan.images.includes("https://pbs.twimg.com/media/reply.jpg"));
    assert.ok(timeline.scan.images.includes("https://pbs.twimg.com/media/quoted.jpg"));
    assert.ok(timeline.extra.some(item => item.url === "https://video.twimg.com/other-state.mp4"));

    const modal = await run(`<main>${post("999", photo("background"))}</main><div role="dialog"><a href="/user/status/123">View post</a><div data-testid="videoPlayer" id="target-player"></div></div><div role="dialog"><a href="/user/status/999">Other post</a><video src="https://video.twimg.com/other-modal.mp4"></video></div>`, true, () => {
      document.querySelector("#target-player").__reactProps$fixture = {media: {variants: [{url: "https://video.twimg.com/modal.mp4", content_type: "video/mp4"}]}};
      document.querySelector("video").__reactProps$fixture = {src: "https://video.twimg.com/other-modal.mp4"};
    });
    assert.equal(modal.state.status, "ready");
    assert.deepEqual(modal.scan.images, []);
    assert.deepEqual(modal.extra, [{url: "https://video.twimg.com/modal.mp4", kind: "video"}]);

    const quotedOnly = await run(`<main>${post("999", `<div role="link"><a href="/user/status/123"><time>Quoted</time></a>${photo("quoted-target")}</div><p>This Post was deleted</p>`)}</main>`);
    assert.deepEqual(quotedOnly, {state: {status: "timeout"}, scan: null, extra: []});

    const quoteVideoOnly = await run(`<main>${post("123", `${photo("target")}${quoted}`)}</main>`, true);
    assert.equal(quoteVideoOnly.state.status, "timeout", "引用内の動画で対象動画の準備完了にしない");
    assert.equal(quoteVideoOnly.scan.media.some(item => item.kind === "video"), false);
  } finally {
    await browser.close();
  }
});
