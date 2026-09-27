import assert from "node:assert/strict";
import test from "node:test";
import { defaultSelectedImageGroups, filterImagesByGroup, groupImages, imageGroupLabel, normalizeImageUrls, sortImageUrlsForSite } from "../dist/extension/core/images.js";

test("画像候補を元ページから解決し、重複と実行できないURLを除く", () => {
  assert.deepEqual(normalizeImageUrls([
    "/pages/01.jpg#preview",
    "https://example.com/pages/01.jpg",
    "../pages/02.png",
    "javascript:alert(1)",
    "data:image/png;base64,AA==",
    "http://[",
    "   ",
  ], "https://example.com/book/viewer/index.html"), [
    "https://example.com/pages/01.jpg",
    "https://example.com/book/pages/02.png",
  ]);
});

test("抽出済みURLとプロトコル相対URLを正規化する", () => {
  assert.deepEqual(normalizeImageUrls([
    "//cdn.example.com/pages/001.jpg",
    "https://example.com/pages/002.jpg%20",
    "https://example.com/pages/003.jpg%2520",
    "https://example.com/pages/004.jpg,https://example.com/pages/ignore.jpg",
    "https://example.com/pages/005.jpg%2Chttps://example.com/pages/ignore.jpg",
    "https://example.com/pages/006.jpg%252Chttps://example.com/pages/ignore.jpg",
  ], "https://example.com/viewer/index"), [
    "https://cdn.example.com/pages/001.jpg",
    "https://example.com/pages/002.jpg%20",
    "https://example.com/pages/003.jpg%2520",
    "https://example.com/pages/004.jpg,https://example.com/pages/ignore.jpg",
    "https://example.com/pages/005.jpg%2Chttps://example.com/pages/ignore.jpg",
    "https://example.com/pages/006.jpg%252Chttps://example.com/pages/ignore.jpg",
  ]);
});

test("URL内の空白とカンマを候補の区切りとして扱わない", () => {
  assert.deepEqual(normalizeImageUrls([
    "https://example.com/pages/name with space.jpg",
    "https://example.com/pages/name%20with%20space.jpg",
    "https://example.com/pages/name,part.jpg 2x",
  ], "https://example.com/viewer/index"), [
    "https://example.com/pages/name%20with%20space.jpg",
    "https://example.com/pages/name,part.jpg%202x",
  ]);
});

test("画像のまとまりはサイト名と保存先の階層で表す", () => {
  assert.equal(imageGroupLabel("https://example.com/book/pages/01.jpg"), "example.com / pages");
  assert.equal(imageGroupLabel("https://example.com/cover.jpg"), "example.com");
});

test("UI用の画像除外規則は本文画像を残す", () => {
  assert.deepEqual(normalizeImageUrls([
    "/assets/logo.png",
    "/assets/icon.png",
    "/pages/logo-01.jpg",
    "/pages/01.gif",
  ], "https://example.com/viewer/index"), [
    "https://example.com/pages/logo-01.jpg",
    "https://example.com/pages/01.gif",
  ]);
});

test("画像を漫画本文・表紙・単発のまとまりへ分類し、本文を初期選択する", () => {
  const groups = groupImages([
    "https://example.com/pages/001.jpg",
    "https://example.com/pages/002.jpg",
    "https://example.com/cover/001.jpg",
    "https://example.com/cover/002.jpg",
    "https://example.com/one.png",
  ]);
  assert.equal(groups["99_others"].label, "その他 (1枚)");
  const manga = Object.entries(groups).find(([, group]) => group.isMangaBody);
  const cover = Object.entries(groups).find(([, group]) => group.label.startsWith("表紙"));
  assert.equal(manga?.[1].label, "シリーズ (2枚)");
  assert.equal(cover?.[1].label, "表紙・サムネイル (2枚)");
  assert.equal(defaultSelectedImageGroups(groups)[manga[0]], true);
  assert.equal(defaultSelectedImageGroups(groups)[cover[0]], false);
});

test("表紙・サムネイルで表示を絞っても、選択状態と元の一覧を変えない", () => {
  const images = [
    {url: "https://example.com/pages/001.jpg", selected: true},
    {url: "https://example.com/cover/001.jpg", selected: false},
    {url: "https://example.com/cover/002.jpg", selected: true},
  ];
  const cover = Object.values(groupImages(images.map(item => item.url))).find(group => group.label.startsWith("表紙"));
  assert.ok(cover);
  assert.deepEqual(filterImagesByGroup(images, cover), [images[1], images[2]]);
  assert.deepEqual(images.map(item => item.selected), [true, false, true]);
  assert.deepEqual(filterImagesByGroup(images, null), images);
});

test("特定サイトだけファイル名の数値順に並べる", () => {
  const images = ["https://momon-ga.com/pages/10.jpg", "https://momon-ga.com/pages/2.jpg", "https://momon-ga.com/pages/1.jpg"];
  assert.deepEqual(sortImageUrlsForSite(images, "https://momon-ga.com/book"), [images[2], images[1], images[0]]);
  assert.deepEqual(sortImageUrlsForSite(images, "https://example.com/book"), images);
  assert.deepEqual(sortImageUrlsForSite(images, "https://not-momon-ga.com/book?from=momon-ga.com"), images);
});

test("数字で始まるまとまりはシリーズ、それ以外はセットと表示する", () => {
  const groups = groupImages([
    "https://example.com/gallery/001.jpg",
    "https://example.com/gallery/002.jpg",
    "https://example.com/gallery/photo-001.jpg",
    "https://example.com/gallery/photo-002.jpg",
    "https://example.com/pages/body-001.jpg",
    "https://example.com/pages/body-002.jpg",
  ]);
  assert.deepEqual(Object.values(groups).map(group => group.label), [
    "シリーズ (2枚)", "セット (2枚)", "セット (2枚)",
  ]);
});
