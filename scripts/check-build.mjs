import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const expected = JSON.parse(await readFile(new URL("../manifest.template.json", import.meta.url), "utf8"));
const actual = JSON.parse(await readFile(new URL("../dist/extension/manifest.json", import.meta.url), "utf8"));
assert.deepEqual(actual, expected, "生成manifestがtemplateと一致しません。");

for (const path of [
  "../dist/extension/background.js",
  "../dist/extension/app/index.html",
  "../dist/extension/app/index.js",
  "../dist/extension/app/style.css",
  "../dist/extension/core/images.js",
  "../dist/extension/core/pdf.js",
  "../dist/extension/_locales/ja/messages.json"
]) {
  await access(new URL(path, import.meta.url));
}
console.log("Extension build output is complete.");
