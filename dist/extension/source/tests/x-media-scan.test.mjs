import assert from "node:assert/strict";
import test from "node:test";
import {scanXMedia} from "../dist/extension/app/x-media-scan.js";

async function runOnPage(hostname, articles, callback = scanXMedia, mediaElements = [], pathname = "/home") {
  const previous = {
    document: globalThis.document,
    location: globalThis.location,
  };
  globalThis.document = {
    querySelectorAll: selector => selector === "article"
      ? articles
      : mediaElements.filter(entry => entry.selectors.includes(selector)).map(entry => entry.element),
  };
  globalThis.location = {hostname, href: `https://${hostname}${pathname}`, pathname};
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
              video_info: {
                variants: [
                  {content_type: "video/mp4", bitrate: 832_000, url: "https://video.twimg.com/low.mp4"},
                  {content_type: "application/x-mpegURL", bitrate: 8_000_000, url: "https://video.twimg.com/playlist.m3u8"},
                  {content_type: "video/mp4; codecs=avc1", bitrate: 2_176_000, url: "https://video.twimg.com/high.mp4"},
                  {content_type: "video/mp4", bitrate: 12_000_000, url: "blob:https://x.com/local"},
                ]
              },
            }],
          },
        },
      },
    },
  });

  assert.deepEqual(await runOnPage("x.com", [article]), [
    {
      url: "https://video.twimg.com/high.mp4",
      variantUrls: ["https://video.twimg.com/low.mp4"],
      kind: "video",
      previewUrl: "https://pbs.twimg.com/media/preview.jpg?format=jpg&name=small",
    },
  ]);
});

test("article自身のfiberから親のmemoizedPropsをたどり、getterを呼ばない", async () => {
  let getterCalls = 0;
  const lazyVariant = {};
  Object.defineProperties(lazyVariant, {
    url: {
      get() {
        getterCalls += 1;
        return "https://video.twimg.com/should-not-read.mp4";
      }
    },
    content_type: {value: "video/mp4"},
    bitrate: {value: 50_000},
  });
  const parentFiber = {
    memoizedProps: {
      mediaDetails: [{
        video_info: {
          variants: [
            {content_type: "video/mp4", bitrate: 90_000, url: "https://video.twimg.com/parent.mp4"},
            lazyVariant,
          ]
        }
      }],
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

test("articleがない動画プレイヤーのprops.media.variantsから最高bitrateのMP4を読む", async () => {
  const player = {};
  Object.defineProperty(player, "__reactProps$player", {
    value: {
      media: {
        media_url_https: "https://pbs.twimg.com/media/player-preview.jpg?format=jpg",
        variants: [
          {content_type: "video/mp4", bitrate: 400_000, url: "https://video.twimg.com/player-low.mp4"},
          {content_type: "application/x-mpegURL", bitrate: 9_000_000, url: "https://video.twimg.com/player.m3u8"},
          {content_type: "video/mp4", bitrate: 1_600_000, url: "https://video.twimg.com/player-high.mp4"},
        ],
      },
      cache: {variants: [{content_type: "video/mp4", bitrate: 99_000_000, url: "https://video.twimg.com/cache.mp4"}]},
    },
  });

  assert.deepEqual(await runOnPage("x.com", [], scanXMedia, [{element: player, selectors: ['[data-testid="videoPlayer"]']}], "/status/person/123/video/1"), [
    {
      url: "https://video.twimg.com/player-high.mp4",
      variantUrls: ["https://video.twimg.com/player-low.mp4"],
      kind: "video",
      previewUrl: "https://pbs.twimg.com/media/player-preview.jpg?format=jpg",
    },
  ]);
});

test("video/1のdialog player props.source.srcを記事の候補より先に返す", async () => {
  const article = {};
  Object.defineProperty(article, "__reactProps$article", {
    value: {
      tweet: {
        legacy: {
          extended_entities: {
            media: [{
              video_info: {
                variants: [
                  {content_type: "video/mp4", bitrate: 800_000, url: "https://video.twimg.com/background.mp4"},
                ]
              }
            }]
          }
        }
      },
    },
  });
  const video = {};
  Object.defineProperty(video, "__reactFiber$video", {
    value: {
      memoizedProps: {role: "video", source: {src: "https://video.twimg.com/expanded.mp4?tag=12"}},
      return: null,
    },
  });

  assert.deepEqual(await runOnPage("x.com", [article], scanXMedia, [{element: video, selectors: ["dialog video"]}], "/status/person/123/video/1"), [
    {url: "https://video.twimg.com/expanded.mp4?tag=12", kind: "video"},
    {url: "https://video.twimg.com/background.mp4", kind: "video"},
  ]);
});

test("投稿動画を見つけたら祖先探索を止め、store・cache・clientの投稿外動画を拾わない", async () => {
  const video = url => ({
    video_info: {
      variants: [
        {content_type: "video/mp4", bitrate: 256_000, url},
      ]
    }
  });
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
  globalThis.document = {
    querySelectorAll() {
      queryCalls += 1;
      return [];
    }
  };
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


test("同じプレイヤーのsrcとvariantは最高画質へ統合し、別動画と直接srcの代用を保つ", async () => {
  const low = "https://video.twimg.com/one/low/clip.mp4", high = "https://video.twimg.com/one/high/clip.mp4";
  const other = "https://video.twimg.com/two/high/clip.mp4";
  const player = {
    __reactProps$player: {
      src: low,
      video_info: {
        variants: [
          {url: low, content_type: "video/mp4", bitrate: 1}, {url: high, content_type: "video/mp4", bitrate: 10},
        ]
      }
    }
  };
  const direct = {__reactProps$direct: {src: low}};
  const second = {__reactProps$second: {src: other}};
  const candidates = await runOnPage("x.com", [], scanXMedia, [direct, player, second].map(element => ({element, selectors: ['[data-testid="videoPlayer"]']})));
  assert.deepEqual(candidates, [{url: high, kind: "video", variantUrls: [low]}, {url: other, kind: "video"}]);
  assert.deepEqual(await runOnPage("x.com", [], scanXMedia, [{element: direct, selectors: ['[data-testid="videoPlayer"]']}]), [{url: low, kind: "video"}]);
});


test("複数の再生情報にまたがる同一動画の画質関係を保持し、サムネイル追加で失わない", async () => {
  const low = "https://video.twimg.com/low.mp4", medium = "https://video.twimg.com/medium.mp4", high = "https://video.twimg.com/high.mp4";
  const player = variants => ({__reactProps$player: {video_info: {variants: variants.map(([url, bitrate]) => ({url, bitrate, content_type: "video/mp4"}))}}});
  const elements = [
    player([[low, 1], [medium, 2]]),
    player([[medium, 2], [high, 3]]),
    {__reactProps$source: {source: {src: high}, poster: "https://pbs.twimg.com/preview.jpg"}}
  ];
  const candidates = await runOnPage("x.com", [], scanXMedia, elements.map(element => ({element, selectors: ['[data-testid="videoPlayer"]']})));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, high);
  assert.deepEqual(candidates[0].variantUrls.sort(), [low, medium].sort());
  assert.equal(candidates[0].previewUrl, "https://pbs.twimg.com/preview.jpg");
});
