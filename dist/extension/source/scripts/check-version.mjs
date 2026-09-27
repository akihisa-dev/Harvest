import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const template = JSON.parse(await readFile(new URL("manifest.template.json", root), "utf8"));
const generated = JSON.parse(await readFile(new URL("dist/extension/manifest.json", root), "utf8"));
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const versions = [packageJson.version, template.version, generated.version];

if (!versions.every((version) => typeof version === "string" && semver.test(version))) {
  throw new Error(`versionがSemVer形式ではありません: package=${packageJson.version}, template=${template.version}, generated=${generated.version}`);
}
if (!versions.every((version) => version === packageJson.version)) {
  throw new Error(`version不一致: package=${packageJson.version}, template=${template.version}, generated=${generated.version}`);
}
console.log(`version ok: ${packageJson.version}`);
