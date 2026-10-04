import assert from "node:assert/strict";
import test from "node:test";
import {isStillImage} from "../dist/extension/core/split-export-formats.js";
import { ImageCollection } from "../dist/extension/core/image-collection.js";

const items = [
  {url: "https://example.test/photo.png", selected: true, sourcePage: "https://example.test/"},
  {url: "https://example.test/animation.gif", kind: "gif", selected: true, sourcePage: "https://example.test/"},
  {url: "https://example.test/movie.mp4", kind: "video", selected: true, sourcePage: "https://example.test/"},
];
test("現行の静止画像判定はGIF・動画と取得後に判明したGIFを除く", () => {
  assert.deepEqual(items.filter(isStillImage), [items[0]]);
  assert.equal(items.slice(1).some(isStillImage), false);
  assert.equal([].some(isStillImage), false);
  assert.equal(isStillImage({...items[0], recommendedFormat: "gif"}), false);
});
test("collection retains media identity and preview metadata across ordering and selection", () => {
  const collection = new ImageCollection();
  const poster = "https://example.test/poster.jpg";
  collection.replace(items.map(item => item.url), "https://example.test/", [
    {url: items[1].url, kind: "gif"}, {url: items[2].url, kind: "video", previewUrl: poster},
  ]);
  const movie = collection.itemForUrl(items[2].url);
  assert.equal(movie.kind, "video");
  assert.equal(movie.previewUrl, poster);
  collection.setAllSelected(true);
  assert.equal(collection.selectedItems.length, 3, "mixed保存の入力は全媒体を維持する");
  assert.deepEqual(collection.selectedItems.filter(isStillImage), [collection.items[0]]);
  assert.equal(collection.selectedItems[1].kind, "gif");
  assert.equal(collection.selectedItems[2], movie);
  collection.moveVisible(collection.items, movie, collection.items[0]);
  assert.equal(collection.items[0], movie);
  collection.restoreInitialOrderAndSelection();
  assert.equal(collection.itemForUrl(items[2].url), movie);
});
