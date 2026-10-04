import assert from "node:assert/strict";
import test from "node:test";
import {originalItemExtension} from "../dist/extension/core/export-formats.js";
import {imageExportFormats, videoExportFormats, isImageExportFormat, isVideoExportFormat} from "../dist/extension/core/split-export-formats.js";
import {resolveImageExportFormat} from "../dist/extension/core/export-recommendations.js";
import {individualFilename} from "../dist/extension/core/export-files.js";
const image = {url: "https://example.test/image.jpg", sourcePage: "https://example.test/", selected: true};
const gif = {...image, url: "https://example.test/image.gif", kind: "gif"};
const video = {...image, url: "https://example.test/video.webm", kind: "video"};

test("画像・動画の独立した形式候補と受理値が一致し、他媒体の選択を除外しない", () => {
  assert.deepEqual(imageExportFormats, ["original", "recommend", "pdf", "jpg", "png", "jxl"]);
  assert.deepEqual(videoExportFormats, ["original", "recommend", "mp4"]);
  for (const value of [...imageExportFormats, ...videoExportFormats, "gif", "webm", "PDF", "", null, undefined, 1]) {
    assert.equal(isImageExportFormat(value), imageExportFormats.includes(value));
    assert.equal(isVideoExportFormat(value), videoExportFormats.includes(value));
  }
  const selected = [video, image, gif];
  assert.equal(resolveImageExportFormat("recommend", selected), "original");
  for (const format of imageExportFormats.filter(value => value !== "recommend")) assert.equal(resolveImageExportFormat(format, selected), format);
  assert.deepEqual(selected, [video, image, gif], "形式解決で選択と順序を変えない");
});

test("単体名はページ名を使い、複数の個別保存は入力番号を保つ", () => {
  assert.equal(individualFilename("Artwork.zip", "001.gif", 1), "Artwork.gif");
  assert.equal(individualFilename("Artwork.zip", "001.mp4", 2), "Artwork_001.mp4");
  assert.equal(individualFilename("Artwork.zip", "002.mp4", 2), "Artwork_002.mp4");
});

test("元の拡張子はクエリ指定・data URL・判別できないURLを扱う", () => {
  assert.equal(originalItemExtension({...image, url: "https://example.test/file.jpg?FORMAT=webp"}), "WEBP");
  assert.equal(originalItemExtension({...image, url: "data:image/png;base64,AAAA"}), "PNG");
  assert.equal(originalItemExtension({...image, url: "https://example.test/file"}), null);
  assert.equal(originalItemExtension({...gif, url: "https://example.test/file"}), "GIF");
});
