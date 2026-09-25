import assert from "node:assert/strict";
import test from "node:test";
import { defaultSelectedImageGroups, galleryLinkScore, groupImages, imageGroupLabel, normalizeImageUrls, sortImageUrlsForSite } from "../dist/extension/core/images.js";

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

test("抽出結果のsrcset表記とプロトコル相対URLを実際に正規化する", () => {
  assert.deepEqual(normalizeImageUrls([
    "//cdn.example.com/pages/001.jpg 1000w",
    "https://example.com/pages/002.jpg%20 1200w",
    "https://example.com/pages/003.jpg%2520 1400w",
    "https://example.com/pages/004.jpg,https://example.com/pages/ignore.jpg",
    "https://example.com/pages/005.jpg%2Chttps://example.com/pages/ignore.jpg",
    "https://example.com/pages/006.jpg%252Chttps://example.com/pages/ignore.jpg",
  ], "https://example.com/viewer/index"), [
    "https://cdn.example.com/pages/001.jpg",
    "https://example.com/pages/002.jpg",
    "https://example.com/pages/003.jpg",
    "https://example.com/pages/004.jpg",
    "https://example.com/pages/005.jpg",
    "https://example.com/pages/006.jpg",
  ]);
});

test("画像のまとまりはサイト名と保存先の階層で表す", () => {
  assert.equal(imageGroupLabel("https://example.com/book/pages/01.jpg"), "example.com / pages");
  assert.equal(imageGroupLabel("https://example.com/cover.jpg"), "example.com");
});

test("画像一覧に関係しそうな同一サイトのリンクだけを候補にする", () => {
  const source = "https://example.com/book";
  assert.ok(galleryLinkScore({url: "/book/gallery", label: "全ページを見る"}, source) > 0);
  assert.equal(galleryLinkScore({url: "/about", label: "運営会社"}, source), 0);
  assert.equal(galleryLinkScore({url: "https://other.example/gallery", label: "ギャラリー"}, source), -1);
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
  const manga = Object.entries(groups).find(([, group]) => group.isMangaBody);
  const cover = Object.entries(groups).find(([, group]) => group.label.startsWith("表紙"));
  assert.equal(manga?.[1].label, "漫画本編 [連番] (2枚)");
  assert.equal(cover?.[1].label, "表紙・サムネイル (2枚)");
  assert.equal(defaultSelectedImageGroups(groups)[manga[0]], true);
  assert.equal(defaultSelectedImageGroups(groups)[cover[0]], false);
});

test("特定サイトだけファイル名の数値順に並べる", () => {
  const images = ["https://momon-ga.com/pages/10.jpg", "https://momon-ga.com/pages/2.jpg", "https://momon-ga.com/pages/1.jpg"];
  assert.deepEqual(sortImageUrlsForSite(images, "https://momon-ga.com/book"), [images[2], images[1], images[0]]);
  assert.deepEqual(sortImageUrlsForSite(images, "https://example.com/book"), images);
});
