import { readFile } from "node:fs/promises";
import {assertExtensionVersion} from "./lib/extension-version.mjs";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const template = JSON.parse(await readFile(new URL("manifest.template.json", root), "utf8"));
const generated = JSON.parse(await readFile(new URL("dist/extension/manifest.json", root), "utf8"));
const versions = [packageJson.version, template.version, generated.version];

for (const [index, source] of ["package.json", "manifest.template.json", "dist/extension/manifest.json"].entries()) {
  assertExtensionVersion(versions[index], source);
}
if (!versions.every((version) => version === packageJson.version)) {
  throw new Error(`version不一致: package=${packageJson.version}, template=${template.version}, generated=${generated.version}`);
}
console.log(`version ok: ${packageJson.version}`);
