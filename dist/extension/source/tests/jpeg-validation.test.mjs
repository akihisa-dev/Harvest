import assert from "node:assert/strict";
import test from "node:test";
import {getOriginalJpegPage, inspectJpegStructure} from "../dist/extension/core/jpeg.js";
import {baselineJpeg, progressiveJpeg, exifJpeg, brokenJpegs, undecodableJpeg} from "./jpeg-fixtures.mjs";

test("JPEG直接保存候補は完全な成分・表・走査・終端を持ち、正常な元データを保持する", () => {
  for (const bytes of [baselineJpeg, progressiveJpeg]) {
    assert.deepEqual(getOriginalJpegPage(bytes), {jpeg: bytes, width: 3, height: 2});
    assert.equal(getOriginalJpegPage(bytes).jpeg, bytes);
  }
  assert.equal(getOriginalJpegPage(exifJpeg), null, "EXIFは従来どおりPDF直接埋込みの対象外");
  assert.deepEqual(inspectJpegStructure(exifJpeg), {width: 3, height: 2, canEmbed: false});
  assert.ok(getOriginalJpegPage(undecodableJpeg), "構造上の候補でもブラウザーの画素検証が必要");
  for (const [name, bytes] of Object.entries(brokenJpegs)) {
    assert.equal(inspectJpegStructure(bytes), null, name);
    assert.equal(getOriginalJpegPage(bytes), null, name);
  }
});
