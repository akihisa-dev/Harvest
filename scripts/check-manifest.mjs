import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../manifest.template.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

if (manifest.manifest_version !== 3) throw new Error("manifest_versionは3である必要があります。");
if (manifest.version !== packageJson.version) throw new Error("manifestとpackage.jsonのversionが一致しません。");
if (!manifest.default_locale || !manifest.name || !manifest.description) {
  throw new Error("manifestの名称、説明、既定localeが必要です。");
}
if (!manifest.action?.default_popup) throw new Error("action.default_popupが必要です。");
await access(new URL("../_locales/ja/messages.json", import.meta.url));
console.log("Manifest template is valid.");
