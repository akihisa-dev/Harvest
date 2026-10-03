import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultDisplayedImageGroup,
  defaultSelectedImageGroups,
  filterImagesByGroup,
  groupImages,
  imageGroupLabel,
  normalizeImageUrls
} from "../dist/extension/core/images.js";

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
    "/assets/animation.gif",
    "/pages/logo-01.jpg",
    "/pages/01.gif",
  ], "https://example.com/viewer/index"), [
    "https://example.com/assets/animation.gif",
    "https://example.com/pages/logo-01.jpg",
    "https://example.com/pages/01.gif",
  ]);
});

test("PHP・CGI経由の画像候補をURL拡張子だけで除外しない", () => {
  assert.deepEqual(normalizeImageUrls([
    "https://example.com/image.php?id=123",
    "https://example.com/view.cgi?page=5",
    "https://example.com/icon.svg",
    "https://example.com/favicon.ico",
  ], "https://example.com/article"), [
    "https://example.com/image.php?id=123",
    "https://example.com/view.cgi?page=5",
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

test("画像はサイトによらず検出順を保ち、重複だけを除く", () => {
  for (const pageUrl of ["https://example.com/book", "https://gallery.example.test/book"]) {
    assert.deepEqual(normalizeImageUrls([
      "/pages/10.jpg", "/pages/2.jpg", "/pages/1.jpg", "/pages/2.jpg",
    ], pageUrl), [
      new URL("/pages/10.jpg", pageUrl).href,
      new URL("/pages/2.jpg", pageUrl).href,
      new URL("/pages/1.jpg", pageUrl).href,
    ]);
  }
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

test("同じ画像パスのクエリ連番は系列ごとにまとめ、パス型連番も維持する", () => {
  const pages = [
    "https://example.com/viewer/page.jpg?page=1&mode=full",
    "https://example.com/viewer/page.jpg?mode=full&page=2",
  ];
  const thumbnails = [
    "https://example.com/viewer/page.jpg?thumb=1&mode=small",
    "https://example.com/viewer/page.jpg?thumb=2&mode=small",
  ];
  const alternate = [
    "https://example.com/viewer/page.jpg?page=1&mode=preview",
    "https://example.com/viewer/page.jpg?page=2&mode=preview",
  ];
  const pathPages = [
    "https://example.com/viewer/01.jpg",
    "https://example.com/viewer/02.jpg",
  ];
  const groups = Object.values(groupImages([...pages, ...thumbnails, ...alternate, ...pathPages]));
  assert.equal(groups.length, 4);
  for (const series of [pages, thumbnails, alternate, pathPages]) {
    assert.deepEqual(groups.find(group => group.items.includes(series[0]))?.items, series);
  }
});

test("解析後の表示とPDF選択は本文を優先し、本文がなければ従来の順位で選ぶ", () => {
  const groups = groupImages([
    "https://example.com/pages/body-001.jpg",
    "https://example.com/pages/body-002.jpg",
    "https://example.com/gallery/001.jpg",
    "https://example.com/gallery/002.jpg",
    "https://example.com/larger/001.jpg",
    "https://example.com/larger/002.jpg",
    "https://example.com/larger/003.jpg",
    "https://example.com/one.jpg",
  ]);
  const key = defaultDisplayedImageGroup(groups);
  assert.equal(groups[key].label, "セット (2枚)");
  assert.deepEqual(Object.entries(defaultSelectedImageGroups(groups)).filter(([, selected]) => selected).map(([key]) => key), [key]);
  const fallbacks = [
    ["https://example.com/gallery/photo-01.jpg", "https://example.com/gallery/photo-02.jpg"],
    ["https://example.com/cover/01.jpg", "https://example.com/cover/02.jpg"],
    ["https://example.com/one.jpg"],
  ];
  for (let index = 0; index < fallbacks.length; index++) {
    const fallbackGroups = groupImages(fallbacks.slice(index).flat());
    assert.equal(fallbackGroups[defaultDisplayedImageGroup(fallbackGroups)].label, ["セット (2枚)", "表紙・サムネイル (2枚)", "その他 (1枚)"][index]);
  }
  assert.equal(defaultDisplayedImageGroup({}), null);
  assert.deepEqual(defaultSelectedImageGroups({}), {});
});

test("少数の数値画像より多数の本文を選び、本文同士と本文なしの順位を保つ", () => {
  const numeric = ["https://example.com/gallery/01.jpg", "https://example.com/gallery/02.jpg"];
  const body = Array.from({length: 20}, (_, index) => `https://example.com/gallery/page-${String(index + 1).padStart(3, "0")}.jpg`);
  const groups = groupImages([...numeric, ...body]);
  const selected = groups[defaultDisplayedImageGroup(groups)];
  assert.deepEqual(selected.items, body);
  assert.equal(selected.isMangaBody, true);
  assert.deepEqual(Object.entries(defaultSelectedImageGroups(groups)).filter(([, value]) => value).map(([key]) => key), [defaultDisplayedImageGroup(groups)]);

  const numericBody = groupImages([...numeric.map(url => url.replace("/gallery/", "/pages/")), ...body]);
  assert.deepEqual(numericBody[defaultDisplayedImageGroup(numericBody)].items,
    numeric.map(url => url.replace("/gallery/", "/pages/")));

  const noBody = groupImages([...numeric, "https://example.com/gallery/photo-01.jpg", "https://example.com/gallery/photo-02.jpg"]);
  assert.deepEqual(noBody[defaultDisplayedImageGroup(noBody)].items, numeric);

  const uploaded = groupImages(["data:image/jpeg;base64,AA==", ...body]);
  assert.equal(uploaded[defaultDisplayedImageGroup(uploaded)].priority, 0);
});
