import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

async function pngSize(path) {
  const bytes = await readFile(new URL(path, import.meta.url));
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("提出用のアイコンと掲載画像は指定されたPNG寸法である", async () => {
  for (const size of [16, 32, 48, 128]) {
    assert.deepEqual(await pngSize(`../dist/extension/icons/icon-${size}.png`), [size, size]);
  }
  assert.deepEqual(await pngSize("../store/assets/promo-small.png"), [440, 280]);
  assert.deepEqual(await pngSize("../store/assets/screenshot-01.png"), [1280, 800]);
});
