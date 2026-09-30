import assert from "node:assert/strict";
import test from "node:test";
import { mediaExportSelection, hasStillImages } from "../dist/extension/core/media-selection.js";
import { ImageCollection } from "../dist/extension/core/image-collection.js";

const items = [
  {url: "https://example.test/photo.png", selected: true, sourcePage: "https://example.test/"},
  {url: "https://example.test/animation.gif", kind: "gif", selected: true, sourcePage: "https://example.test/"},
  {url: "https://example.test/movie.mp4", kind: "video", selected: true, sourcePage: "https://example.test/"},
];
test("original preserves the selection and ordering while conversions exclude GIFs and videos", () => {
  assert.deepEqual(mediaExportSelection(items, "original"), items);
  for (const format of ["pdf", "jpg", "png", "jxl"]) assert.deepEqual(mediaExportSelection(items, format), [items[0]]);
  assert.equal(hasStillImages(items), true);
  assert.equal(hasStillImages(items.slice(1)), false);
  assert.equal(hasStillImages([]), false);
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
  assert.equal(mediaExportSelection(collection.selectedItems, "original").length, 3);
  assert.equal(mediaExportSelection(collection.selectedItems, "pdf").length, 1);
  collection.moveVisible(collection.items, movie, collection.items[0]);
  assert.equal(collection.items[0], movie);
  collection.restoreInitialOrderAndSelection();
  assert.equal(collection.itemForUrl(items[2].url), movie);
});
