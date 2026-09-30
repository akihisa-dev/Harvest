import assert from "node:assert/strict";
import test from "node:test";
import { scanXMedia } from "../dist/extension/app/x-media-scan.js";

async function runOnPage(hostname, articles, callback = scanXMedia) {
  const previous = {
    document: globalThis.document,
    location: globalThis.location,
  };
  globalThis.document = {querySelectorAll: selector => selector === "article" ? articles : []};
  globalThis.location = {hostname, href: `https://${hostname}/home`};
  try {
    return callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
}

test("X記事のページ内Reactデータから各video_infoの最高bitrate MP4と画像サムネイルを返す", async () => {
  const article = {};
  Object.defineProperty(article, "__reactProps$test", {
    enumerable: false,
    value: {
      tweet: {
        legacy: {
          extended_entities: {
            media: [{
              type: "animated_gif",
              media_url_https: "https://pbs.twimg.com/media/preview.jpg?format=jpg&name=small",
              video_info: {variants: [
                {content_type: "video/mp4", bitrate: 832_000, url: "https://video.twimg.com/low.mp4"},
                {content_type: "application/x-mpegURL", bitrate: 8_000_000, url: "https://video.twimg.com/playlist.m3u8"},
                {content_type: "video/mp4; codecs=avc1", bitrate: 2_176_000, url: "https://video.twimg.com/high.mp4"},
                {content_type: "video/mp4", bitrate: 12_000_000, url: "blob:https://x.com/local"},
              ]},
            }],
          },
        },
      },
    },
  });

  assert.deepEqual(await runOnPage("x.com", [article]), [
    {
      url: "https://video.twimg.com/high.mp4",
      kind: "video",
      previewUrl: "https://pbs.twimg.com/media/preview.jpg?format=jpg&name=small",
    },
  ]);
});

test("article自身のfiberから親のmemoizedPropsをたどり、getterを呼ばない", async () => {
  let getterCalls = 0;
  const lazyVariant = {};
  Object.defineProperties(lazyVariant, {
    url: {get() { getterCalls += 1; return "https://video.twimg.com/should-not-read.mp4"; }},
    content_type: {value: "video/mp4"},
    bitrate: {value: 50_000},
  });
  const parentFiber = {
    memoizedProps: {
      mediaDetails: [{video_info: {variants: [
        {content_type: "video/mp4", bitrate: 90_000, url: "https://video.twimg.com/parent.mp4"},
        lazyVariant,
      ]}}],
    },
    return: null,
  };
  const articleFiber = {memoizedProps: {role: "article"}, return: parentFiber};
  const article = {};
  Object.defineProperty(article, "__reactFiber$test", {value: articleFiber});

  assert.deepEqual(await runOnPage("www.twitter.com", [article]), [
    {url: "https://video.twimg.com/parent.mp4", kind: "video"},
  ]);
  assert.equal(getterCalls, 0);
});

test("投稿動画を見つけたら祖先探索を止め、store・cache・clientの投稿外動画を拾わない", async () => {
  const video = url => ({video_info: {variants: [
    {content_type: "video/mp4", bitrate: 256_000, url},
  ]}});
  const postFiber = {
    memoizedProps: {
      tweet: {legacy: {extended_entities: {media: [video("https://video.twimg.com/post.mp4")]}}},
      store: {tweets: [video("https://video.twimg.com/store.mp4")]},
      cache: {entries: [video("https://video.twimg.com/cache.mp4")]},
    },
    return: {
      memoizedProps: {client: {responses: [video("https://video.twimg.com/client.mp4")]}},
      return: null,
    },
  };
  const article = {};
  Object.defineProperty(article, "__reactFiber$test", {
    value: {memoizedProps: {role: "article"}, return: postFiber},
  });

  assert.deepEqual(await runOnPage("x.com", [article]), [
    {url: "https://video.twimg.com/post.mp4", kind: "video"},
  ]);
});

test("X以外のページではReactデータを読まない", () => {
  let queryCalls = 0;
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  globalThis.document = {querySelectorAll() { queryCalls += 1; return []; }};
  globalThis.location = {hostname: "example.com", href: "https://example.com/"};
  try {
    assert.deepEqual(scanXMedia(), []);
    assert.equal(queryCalls, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
});

test("深く入れ子になった配列は深さ上限で打ち切る", async () => {
  let media = {video_info: {variants: [{content_type: "video/mp4", url: "https://video.twimg.com/deep.mp4"}]}};
  for (let index = 0; index < 45; index += 1) media = [media];
  const article = {};
  Object.defineProperty(article, "__reactProps$test", {value: {mediaDetails: media}});
  assert.deepEqual(await runOnPage("x.com", [article]), []);
});
