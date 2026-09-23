import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (status) throw new Error("release対象のworktreeがcleanではありません。");

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const tag = `v${packageJson.version}`;
const existing = execFileSync("git", ["tag", "--list", tag], { encoding: "utf8" }).trim();
if (existing) throw new Error(`同名のローカルtagが存在します: ${tag}`);

console.log(`release ok: ${tag} is available for the current commit`);
