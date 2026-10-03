import assert from "node:assert/strict";
import test from "node:test";
import {availableExportFormats, initialExportFormat, restoredExportFormat, isExportFormat, originalItemExtension, recommendedItemFormat} from "../dist/extension/core/export-formats.js";
import {createImageZipEntries} from "../dist/extension/core/image-archive.js";
import {saveFilesIndividually} from "../dist/extension/core/export-files.js";
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
    assert.deepEqual(availableExportFormats(items), ["original", "recommend", ...formats]);
    assert.equal(initialExportFormat(items, "jxl"), initial);
    for (const format of formats) {
      const kind = format === "mp4" ? "video" : format === "gif" ? "gif" : "image";
      assert.deepEqual(mediaExportSelection(items, format), items.filter(item => (item.kind ?? "image") === kind));
    }
  }
  assert.deepEqual(mediaExportSelection([video, image, gif], "original"), [video, image, gif]);
  assert.deepEqual(mediaExportSelection([video, image, gif], "recommend"), [video, image, gif]);
  assert.deepEqual(mediaExportSelection([video, image, gif], "legacy-unknown"), [image]);
});

test("推奨形式は項目ごとの種類に追従し、混在した選択も順序を保ってすべて保存する", () => {
  const items = [video, image, gif];
  assert.deepEqual(items.map(recommendedItemFormat), ["mp4", "png", "gif"]);
  for (const preference of ["original", "recommend"]) {
    assert.equal(initialExportFormat(items, preference), preference);
  }
  const prepared = new Map(items.map((item, index) => [item, new Blob(["data"], {type: ["video/mp4", "image/png", "image/gif"][index]})]));
  assert.deepEqual(createImageZipEntries(items, prepared, "recommend").map(entry => entry.filename), ["001.mp4", "002.png", "003.gif"]);
  assert.equal(saveFilesIndividually("recommend", items.length, items), false);
  assert.equal(saveFilesIndividually("recommend", 2, [video, video]), true);
  prepared.set(video, new Blob(["wrong type"], {type: "image/png"}));
  assert.throws(() => createImageZipEntries(items, prepared, "recommend"), /形式が一致しません/);
});

test("元の拡張子はクエリ指定・data URL・判別できないURLを扱う", () => {
  assert.equal(originalItemExtension({...image, url: "https://example.test/file.jpg?FORMAT=webp"}), "WEBP");
  assert.equal(originalItemExtension({...image, url: "data:image/png;base64,AAAA"}), "PNG");
  assert.equal(originalItemExtension({...image, url: "https://example.test/file"}), null);
  assert.equal(originalItemExtension({...gif, url: "https://example.test/file"}), "GIF");
});

test("保存設定の対応値と、解析前の静止画像用選択を維持する", () => {
  for (const format of ["original", "recommend", "pdf", "jpg", "png", "jxl", "mp4", "gif"]) {
    assert.equal(isExportFormat(format), true);
    assert.equal(restoredExportFormat(format), ["gif", "mp4"].includes(format) ? "pdf" : format);
  }
  for (const value of ["webm", "PDF", "", null, undefined, 1]) assert.equal(isExportFormat(value), false);
});
