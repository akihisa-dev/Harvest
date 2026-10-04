import assert from "node:assert/strict";
import test from "node:test";
import {imageRecommendations, videoRecommendations} from "../dist/extension/core/export-recommendations.js";

const original = {format: "original", reason: "preserve"};
const pdf = {format: "pdf", reason: "series"};
const mp4 = {format: "mp4", reason: "playback"};
function image(path, details = {}) {
  return {url: new URL(path, "https://example.test").href, sourcePage: "https://example.test/view", selected: true, ...details};
}

test("静止画と動く画像には元データを保つ形式を推奨し、対象がなければ推薦しない", () => {
  assert.deepEqual(imageRecommendations([]), []);
  assert.deepEqual(imageRecommendations([image("/clip.mp4", {kind: "video"})]), []);
  for (const item of [image("/photo.jpg"), image("/animation.gif", {kind: "gif"}), image("/image", {recommendedFormat: "gif"})]) {
    assert.deepEqual(imageRecommendations([item]), [original]);
  }
});

test("同じシリーズまたはセットの複数静止画には元画像とPDFを用途別に推奨する", () => {
  for (const paths of [
    ["/gallery/001.jpg", "/gallery/002.jpg"],
    ["/gallery/photo-001.jpg", "/gallery/photo-002.jpg"],
    ["/viewer/page.jpg?page=1&mode=full", "/viewer/page.jpg?mode=full&page=2"],
  ]) {
    const selected = paths.map(path => Object.freeze(image(path)));
    const before = structuredClone(selected);
    assert.deepEqual(imageRecommendations(Object.freeze(selected)), [original, pdf]);
    assert.deepEqual(imageRecommendations([...selected].reverse()), [original, pdf], "選択順が変わっても推薦理由を保つ");
    assert.deepEqual(selected, before, "判定で選択項目を変更しない");
    assert.deepEqual(imageRecommendations(selected.slice(0, 1)), [original], "1枚だけではPDFを推奨しない");
  }
});

test("無関係なグループ・表紙・その他・アップロード画像をPDF推薦で一冊にまとめない", () => {
  for (const paths of [
    ["/gallery/001.jpg", "/other/002.jpg"],
    ["/gallery/001.jpg", "/gallery/002.jpg", "/other/001.jpg"],
    ["/gallery/001.jpg", "/gallery/002.jpg", "/other/001.jpg", "/other/002.jpg"],
    ["/gallery/001.jpg", "/gallery/002.png"],
    ["/cover/001.jpg", "/cover/002.jpg"],
    ["/thumbnails/photo-001.jpg", "/thumbnails/photo-002.jpg"],
    ["/one.jpg", "/two.jpg"],
    ["data:image/png;base64,AA==", "data:image/png;base64,AQ=="],
  ]) assert.deepEqual(imageRecommendations(paths.map(path => image(path))), [original], paths.join(", "));
});

test("動画や動く画像が混在してもPDF候補は静止画のまとまりだけで判定する", () => {
  const series = [image("/gallery/001.jpg"), image("/gallery/002.jpg")];
  const moving = [image("/clip.webm", {kind: "video"}), image("/animation.gif", {kind: "gif"}), image("/animated.webp", {recommendedFormat: "gif"})];
  assert.deepEqual(imageRecommendations([...moving, ...series]), [original, pdf]);
  assert.deepEqual(imageRecommendations([series[0], ...moving]), [original]);
  assert.deepEqual(imageRecommendations(moving), [original]);
  assert.deepEqual(imageRecommendations([...series, image("/other/one.jpg"), ...moving]), [original]);
});

test("動画には原本保持と再生用MP4を同時に推奨し、画像のみなら動画候補を出さない", () => {
  assert.deepEqual(videoRecommendations([]), []);
  assert.deepEqual(videoRecommendations([image("/photo.jpg"), image("/animation.gif", {kind: "gif"})]), []);
  for (const extension of ["mp4", "webm"]) {
    assert.deepEqual(videoRecommendations([image(`/clip.${extension}`, {kind: "video"})]), [original, mp4]);
    assert.deepEqual(videoRecommendations([image("/photo.jpg"), image(`/clip.${extension}`, {kind: "video"})]), [original, mp4]);
  }
});
