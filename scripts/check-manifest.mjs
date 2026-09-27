import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../manifest.template.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

if (manifest.manifest_version !== 3) throw new Error("manifest_versionは3である必要があります。");
if (manifest.version !== packageJson.version) throw new Error("manifestとpackage.jsonのversionが一致しません。");
if (!manifest.default_locale || !manifest.name || !manifest.description) {
  throw new Error("manifestの名称、説明、既定localeが必要です。");
}
if (manifest.action?.default_popup || !manifest.action?.default_title) {
  throw new Error("アイコンはポップアップを使わず、サイドパネルを開く必要があります。");
}
if (manifest.side_panel?.default_path !== "app/index.html" ||
    manifest.background?.service_worker !== "background.js" ||
    !manifest.permissions?.includes("sidePanel")) {
  throw new Error("サイドパネルの設定が不足しています。");
}
for (const size of [16, 32, 48, 128]) {
  if (manifest.icons?.[size] !== `icons/icon-${size}.png`) {
    throw new Error(`${size}pxのアイコン設定が不足しています。`);
  }
}
if (manifest.default_locale !== "en") throw new Error("未対応言語の既定表示は英語にしてください。");
for (const locale of ["ja", "en"]) {
  const messages = JSON.parse(await readFile(new URL(`../_locales/${locale}/messages.json`, import.meta.url), "utf8"));
  for (const value of [manifest.name, manifest.description, manifest.action.default_title]) {
    const key = /^__MSG_(\w+)__$/.exec(value)?.[1];
    if (!key || !messages[key]?.message) throw new Error(`${locale}のmanifest翻訳が不足しています。`);
  }
}
console.log("Manifest template is valid.");
