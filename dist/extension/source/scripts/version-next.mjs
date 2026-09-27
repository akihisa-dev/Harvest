import { readFile } from "node:fs/promises";

const allowedLevels = new Set(["major", "minor", "patch"]);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const args = process.argv.slice(2).filter((argument) => argument !== "--");
const semverPattern = /^(\d+)\.(\d+)\.(\d+)$/;

let current = packageJson.version;
let level;
let currentProvided = false;

for (const arg of args) {
  if (semverPattern.test(arg) && !currentProvided) {
    current = arg;
    currentProvided = true;
    continue;
  }
  if (allowedLevels.has(arg) && level === undefined) {
    level = arg;
    continue;
  }
  throw new Error(`引数が不正です: ${arg}（[現在値] <major|minor|patch>）`);
}

if (!semverPattern.test(current)) throw new Error(`不正なversion: ${current}`);
if (level === undefined) throw new Error("更新区分を指定してください: major、minor、patch");

const parts = current.split(".").map(Number);
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

console.log(parts.join("."));
