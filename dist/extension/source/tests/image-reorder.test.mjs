import assert from "node:assert/strict";
import test from "node:test";
import {createPreviewOrder, findNearestByRect, isPointerAfter} from "../dist/extension/app/image-reorder.js";

const rect = (left, top, width = 100, height = 80) => ({
  left, right: left + width, top, bottom: top + height, width, height,
});

test("画像行の前後判定は単列では縦、多列では横の中央位置を使う", () => {
  const row = rect(200, 100);
  assert.equal(isPointerAfter(row, {clientX: 220, clientY: 139}, true), false);
  assert.equal(isPointerAfter(row, {clientX: 220, clientY: 140}, true), true);
  assert.equal(isPointerAfter(row, {clientX: 249, clientY: 110}, false), false);
  assert.equal(isPointerAfter(row, {clientX: 250, clientY: 110}, false), true);
});

test("プレビュー順は対象行の前後へ元画像を挿入した配列を返す", () => {
  const order = ["a", "b", "c", "d"];
  assert.deepEqual(createPreviewOrder(order, "a", "c", false), ["b", "a", "c", "d"]);
  assert.deepEqual(createPreviewOrder(order, "a", "c", true), ["b", "c", "a", "d"]);
  assert.deepEqual(order, ["a", "b", "c", "d"], "入力配列は変更しない");
  assert.equal(createPreviewOrder(order, "a", "a", true), null);
  assert.equal(createPreviewOrder(order, "missing", "c", false), null);
});

test("最寄り行は矩形内を距離0、外側は矩形の端までの距離で選ぶ", () => {
  const rows = [["left", rect(0, 0)], ["right", rect(200, 0)]];
  assert.equal(findNearestByRect(rows, {clientX: 225, clientY: 20}), "right");
  assert.equal(findNearestByRect(rows, {clientX: 150, clientY: 20}), "left",
    "距離が同じ場合は元の並びで先の行を選ぶ");
  assert.equal(findNearestByRect([], {clientX: 10, clientY: 10}), null);
});
