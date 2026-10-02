import assert from "node:assert/strict";
import test from "node:test";
import {availableExportFormats, initialExportFormat, restoredExportFormat, isExportFormat} from "../dist/extension/core/export-formats.js";
import {mediaExportSelection} from "../dist/extension/core/media-selection.js";

const image = {url: "https://example.test/image.jpg", sourcePage: "https://example.test/", selected: true};
const gif = {...image, url: "https://example.test/image.gif", kind: "gif"};
const video = {...image, url: "https://example.test/video.webm", kind: "video"};

test("保存候補・自動選択・対象の抽出は同じ種類の契約を使い、混在しても順序を保つ", () => {
  for (const [items, formats, initial] of [
    [[], ["pdf", "jpg", "png", "jxl"], "jxl"],
    [[image], ["pdf", "jpg", "png", "jxl"], "jxl"],
    [[gif], ["gif"], "gif"],
    [[video], ["mp4"], "mp4"],
    [[gif, image], ["gif", "pdf", "jpg", "png", "jxl"], "gif"],
    [[gif, video, image], ["mp4", "gif", "pdf", "jpg", "png", "jxl"], "mp4"],
  ]) {
    assert.deepEqual(availableExportFormats(items), formats);
    assert.equal(initialExportFormat(items, "jxl"), initial);
    for (const format of formats) {
      const kind = format === "mp4" ? "video" : format === "gif" ? "gif" : "image";
      assert.deepEqual(mediaExportSelection(items, format), items.filter(item => (item.kind ?? "image") === kind));
    }
  }
  assert.deepEqual(mediaExportSelection([video, image, gif], "original"), [video, image, gif]);
  assert.deepEqual(mediaExportSelection([video, image, gif], "legacy-unknown"), [image]);
});

test("保存設定の対応値と、解析前の静止画像用選択を維持する", () => {
  for (const format of ["pdf", "jpg", "png", "jxl", "mp4", "gif"]) {
    assert.equal(isExportFormat(format), true);
    assert.equal(restoredExportFormat(format), ["gif", "mp4"].includes(format) ? "pdf" : format);
  }
  for (const value of ["original", "webm", "PDF", "", null, undefined, 1]) assert.equal(isExportFormat(value), false);
});
