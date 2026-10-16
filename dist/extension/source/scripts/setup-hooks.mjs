import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {repositoryPathsMatch} from "./lib/repository-path.mjs";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const gitRoot = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
if (gitRoot.status !== 0 || !repositoryPathsMatch(root, gitRoot.stdout.trim())) {
  throw new Error("HarvestのGitルートで実行してください。");
}
const result = spawnSync("git", ["config", "--local", "core.hooksPath", ".githooks"], { cwd: root, stdio: "inherit" });
if (result.status !== 0) throw new Error("Gitフックを設定できませんでした。");
console.log("Git hooks configured for this repository.");
