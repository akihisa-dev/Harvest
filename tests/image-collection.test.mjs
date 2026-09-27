import assert from "node:assert/strict";
import test from "node:test";
import {ImageCollection} from "../dist/extension/core/image-collection.js";

const urls = [
  "https://example.test/pages/001.jpg",
  "https://example.test/cover/001.jpg",
  "https://example.test/pages/002.jpg",
  "https://example.test/cover/002.jpg",
];

test("収集モデルは本文を初期選択し、選択とまとまりの状態を一元管理する", () => {
  const collection = new ImageCollection();
  collection.replace(urls, "https://example.test/view");
  const bodyKey = Object.entries(collection.groups).find(([, group]) => group.items[0] === urls[0])[0];
  const coverKey = Object.entries(collection.groups).find(([, group]) => group.items[0] === urls[1])[0];

  assert.deepEqual(collection.items.map(item => item.selected), [true, false, true, false]);
  assert.equal(collection.items[0].sourcePage, "https://example.test/view");
  assert.deepEqual(collection.groupSelection(bodyKey), {checked: true, indeterminate: false});
  collection.setGroupSelected(bodyKey, false);
  assert.deepEqual(collection.groupSelection(bodyKey), {checked: false, indeterminate: false});
  collection.setSelected(urls[1], true);
  assert.deepEqual(collection.groupSelection(coverKey), {checked: false, indeterminate: true});
  assert.equal(collection.hasSelection, true);
  collection.setAllSelected(false);
  assert.equal(collection.hasSelection, false);
});

test("表示中の画像だけを並べ替え、隠れた画像の位置を保ち、元の順序へ戻す", () => {
  const collection = new ImageCollection();
  collection.replace(urls, "https://example.test/view");
  const bodyKey = Object.entries(collection.groups).find(([, group]) => group.items[0] === urls[0])[0];
  const bodyItems = collection.visibleItems(bodyKey);
  assert.deepEqual(bodyItems.map(item => item.url), [urls[0], urls[2]]);

  assert.equal(collection.moveVisible(bodyItems, bodyItems[0], bodyItems[1]), true);
  assert.deepEqual(collection.items.map(item => item.url), [urls[2], urls[1], urls[0], urls[3]]);
  assert.deepEqual(collection.visibleItems(bodyKey).map(item => item.url), [urls[2], urls[0]]);
  assert.equal(collection.positionOf(bodyItems[0]), 2);
  assert.equal(collection.positionOf(bodyItems[1]), 0);
  assert.equal(collection.matchesInitialOrder(), false);

  collection.resetOrder();
  assert.deepEqual(collection.items.map(item => item.url), urls);
  assert.equal(collection.matchesInitialOrder(), true);
});

test("再収集は項目の識別子と索引を更新し、古い順序を引き継がない", () => {
  const collection = new ImageCollection();
  collection.replace(urls, "https://example.test/first");
  const oldItem = collection.items[0];
  collection.moveVisible(collection.items, collection.items[0], collection.items[3]);
  collection.replace(urls, "https://example.test/second");

  assert.notEqual(collection.items[0], oldItem);
  assert.equal(collection.positionOf(oldItem), undefined);
  assert.equal(collection.positionOf(collection.items[0]), 0);
  assert.equal(collection.itemForUrl(urls[0]), collection.items[0]);
  assert.equal(collection.items[0].sourcePage, "https://example.test/second");
  assert.equal(collection.matchesInitialOrder(), true);
});

test("不正な表示順の適用を拒否して現在の順序を保つ", () => {
  const collection = new ImageCollection();
  collection.replace(urls, "https://example.test/view");
  const visible = collection.visibleItems(null);
  const before = collection.items.map(item => item.url);

  assert.equal(collection.applyVisibleOrder(visible, [visible[0], visible[0], ...visible.slice(2)]), false);
  assert.deepEqual(collection.items.map(item => item.url), before);
});
