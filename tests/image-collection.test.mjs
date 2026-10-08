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

test("解析直後の順序とPDF選択を同時に復元する", () => {
  const collection = new ImageCollection();
  collection.replace(urls, "https://example.test/view");
  const initialSelection = collection.items.map(item => item.selected);
  collection.setAllSelected(true);
  assert.equal(collection.matchesInitialOrderAndSelection(), false);
  collection.moveVisible(collection.items, collection.items[0], collection.items[3]);
  collection.restoreInitialOrderAndSelection();
  assert.deepEqual(collection.items.map(item => item.url), urls);
  assert.deepEqual(collection.items.map(item => item.selected), initialSelection);
  assert.equal(collection.matchesInitialOrderAndSelection(), true);
});

test("不正な表示順の適用を拒否して現在の順序を保つ", () => {
  const collection = new ImageCollection();
  collection.replace(urls, "https://example.test/view");
  const visible = collection.visibleItems(null);
  const before = collection.items.map(item => item.url);

  assert.equal(collection.applyVisibleOrder(visible, [visible[0], visible[0], ...visible.slice(2)]), false);
  assert.deepEqual(collection.items.map(item => item.url), before);
});

test("画像・動画・GIFを形式別に分け、並べ替えと復元後も所属と選択を保つ", () => {
  const mediaUrls = [
    "https://example.test/pages/001.png",
    "https://example.test/pages/002.png",
    "https://example.test/pages/003.webp",
    "https://example.test/media/clip.mp4",
    "https://example.test/media/clip.webm",
    "https://example.test/media/animation.gif",
  ];
  const collection = new ImageCollection();
  collection.replace(mediaUrls, "https://example.test/view", [
    {url: mediaUrls[3], kind: "video"},
    {url: mediaUrls[4], kind: "video"},
    {url: mediaUrls[5], kind: "gif"},
  ]);

  const groups = Object.entries(collection.groups);
  const groupContaining = url => groups.find(([, group]) => group.items.includes(url));
  const png = groupContaining(mediaUrls[0]);
  const webp = groupContaining(mediaUrls[2]);
  const mp4 = groupContaining(mediaUrls[3]);
  const webm = groupContaining(mediaUrls[4]);
  const gif = groupContaining(mediaUrls[5]);
  assert.match(png[1].label, /^PNG · /);
  assert.match(webp[1].label, /^WEBP · /);
  assert.equal(mp4[1].label, "MP4 (1件)");
  assert.equal(webm[1].label, "WEBM (1件)");
  assert.equal(gif[1].label, "GIF (1件)");
  assert.notEqual(png[0], webp[0]);
  assert.notEqual(mp4[0], webm[0]);
  assert.deepEqual(collection.items.map(item => item.selected), [true, true, false, false, false, false]);

  collection.setSelected(mediaUrls[0], true);
  const pngItems = collection.visibleItems(png[0]);
  collection.moveVisible(pngItems, pngItems[0], pngItems[1]);
  assert.deepEqual(collection.itemsInGroup(png[0]).map(item => item.url), [mediaUrls[1], mediaUrls[0]]);
  collection.resetOrder();
  assert.deepEqual(collection.itemsInGroup(png[0]).map(item => item.url), [mediaUrls[0], mediaUrls[1]]);
  assert.equal(collection.itemForUrl(mediaUrls[0]).selected, true);
  assert.equal(collection.itemForUrl(mediaUrls[3]).selected, false);
});

test("形式がクエリやdata URL MIMEにある画像も形式別にまとめる", () => {
  const queryPng = "https://example.test/image?id=1&format=png";
  const dataWebp = "data:image/webp;base64,AA==";
  const collection = new ImageCollection();
  collection.replace([queryPng, dataWebp], "https://example.test/view");
  const labels = Object.values(collection.groups).map(group => group.label);
  assert.ok(labels.some(label => label.startsWith("PNG · ")));
  assert.ok(labels.some(label => label.startsWith("WEBP · ")));
});
