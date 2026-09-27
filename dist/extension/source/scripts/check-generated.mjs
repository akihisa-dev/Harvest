import { execFileSync } from "node:child_process";

const output = execFileSync(
  "git",
  ["status", "--porcelain=v1", "--untracked-files=all", "--", "dist/extension"],
  { encoding: "utf8" },
).trim();

if (output) {
  throw new Error(`dist/extensionがcommit済み生成物と一致しません。pnpm build後の差分をcommitしてください:\n${output}`);
}

console.log("generated artifacts ok: dist/extension is clean");
