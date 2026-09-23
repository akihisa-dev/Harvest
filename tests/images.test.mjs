import assert from "node:assert/strict";
import test from "node:test";
import { galleryLinkScore, imageGroupLabel, normalizeImageUrls } from "../dist/extension/core/images.js";

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
