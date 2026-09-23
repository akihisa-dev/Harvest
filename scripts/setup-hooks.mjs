import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const gitRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
if (gitRoot.status !== 0 || gitRoot.stdout.trim() !== root) {
  throw new Error("HarvestのGitルートで実行してください。");
}
const result = spawnSync("git", ["config", "--local", "core.hooksPath", ".githooks"], { cwd: root, stdio: "inherit" });
if (result.status !== 0) throw new Error("Gitフックを設定できませんでした。");
console.log("Git hooks configured for this repository.");
