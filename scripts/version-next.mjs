import { readFile } from "node:fs/promises";
import {assertExtensionVersion} from "./lib/extension-version.mjs";

const allowedLevels = new Set(["major", "minor", "patch"]);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const args = process.argv.slice(2).filter((argument) => argument !== "--");

let current = packageJson.version;
const levels = [];
let currentProvided = false;

for (const arg of args) {
  if (/^\d/.test(arg) && !currentProvided && levels.length === 0) {
    assertExtensionVersion(arg, "現在のversion");
    current = arg;
    currentProvided = true;
    continue;
  }
  if (allowedLevels.has(arg)) {
    levels.push(arg);
    continue;
  }
  throw new Error(`引数が不正です: ${arg}（[現在値] <major|minor|patch>...）`);
}

const parts = assertExtensionVersion(current, "現在のversion");
if (levels.length === 0) throw new Error("更新区分を指定してください: major、minor、patch");

for (const level of levels) {
  if (level === "major") {
    parts[0] += 1;
    parts[1] = 0;
    parts[2] = 0;
  } else if (level === "minor") {
    parts[1] += 1;
    parts[2] = 0;
  } else {
    parts[2] += 1;
  }
  assertExtensionVersion(parts.join("."), `${level}加算後のversion`);
}

console.log(parts.join("."));
