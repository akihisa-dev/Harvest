import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRelativeImports } from "./build-imports.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "dist", "extension");
const expected = JSON.parse(await readFile(join(root, "manifest.template.json"), "utf8"));
const actual = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
assert.deepEqual(actual, expected, "生成manifestがtemplateと一致しません。");

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

for (const path of [
  "background.js",
  "x-bookmark-capture.js",
  "app/index.html",
  "app/index.js",
  "app/workers/mp4-conversion-worker.js",
  "app/vendor/mediabunny/index.js",
  "app/vendor/mediabunny/LICENSE",
  "app/style.css",
  "brand/harvest-geometric-logo.svg",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "_locales/ja/messages.json",
  "_locales/en/messages.json",
  "source/scripts/windows-zip.ps1"
]) {
  await access(join(output, path));
}

const runtimeFiles = (await filesUnder(output)).filter((path) => path.endsWith(".js"));
await checkRelativeImports(runtimeFiles, output);

for (const sourceFile of (await filesUnder(join(root, "src"))).filter((path) => !path.endsWith("/.DS_Store"))) {
  const distributed = join(output, "source", relative(root, sourceFile));
  await access(distributed).catch(() => {
    assert.fail(`配布sourceに必要なファイルがありません: ${relative(root, sourceFile)}`);
  });
}

console.log("Extension build output and module imports are complete.");
