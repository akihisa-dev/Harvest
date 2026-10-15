import { execFileSync } from "node:child_process";
import path from "node:path";

import {checkRuntime} from "./lib/runtime.mjs";

checkRuntime();

let hooksPath;
try {
  hooksPath = execFileSync("git", ["config", "--local", "--get", "core.hooksPath"], {
    encoding: "utf8",
    timeout: 5000,
    killSignal: "SIGTERM",
  }).trim();
} catch {
  throw new Error("Gitフックが未設定です。pnpm setup:hooks を実行してください。");
}

if (path.resolve(hooksPath) !== path.resolve(".githooks")) {
  throw new Error(`Gitフックの設定先が .githooks ではありません（${hooksPath}）。pnpm setup:hooks を実行してください。`);
}
