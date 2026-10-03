import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import {projectRoot, filesUnder} from "./lib/project.mjs";
import {applicationAssets, correspondingSource} from "./build/artifact-plan.mjs";
import { checkRelativeImports } from "./build-imports.mjs";

const root = projectRoot;
const output = join(root, "dist", "extension");
const expected = JSON.parse(await readFile(join(root, "manifest.template.json"), "utf8"));
const actual = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
assert.deepEqual(actual, expected, "生成manifestがtemplateと一致しません。");

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

for (const [source, destination] of [...applicationAssets(), ...await correspondingSource(root)]) {
  const distributed = join(output, destination);
  const [input, built] = await Promise.all([readFile(join(root, source)), readFile(distributed)]);
  assert.deepEqual(built, input, `配布物の内容が正本と一致しません: ${destination}`);
}

console.log("Extension build output and module imports are complete.");
