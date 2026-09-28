import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runtimeCheck = fileURLToPath(new URL("../scripts/check-runtime.mjs", import.meta.url));

function createRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harvest-check-runtime-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ packageManager: "pnpm@12.5.1" }));
  return root;
}

function runCheck(root) {
  return spawnSync(process.execPath, [runtimeCheck], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_user_agent: "pnpm/12.5.1" },
  });
}

test("check-runtime explains how to enable missing Git hooks", (t) => {
  const root = createRepo(t);
  const result = runCheck(root);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Gitフックが未設定です。pnpm setup:hooks を実行してください。/);
});

test("check-runtime accepts the repository Git hooks directory", (t) => {
  const root = createRepo(t);
  execFileSync("git", ["config", "--local", "core.hooksPath", ".githooks"], { cwd: root });
  const result = runCheck(root);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /runtime ok:/);
});

test("check-runtime guides setup when Git hooks point elsewhere", (t) => {
  const root = createRepo(t);
  execFileSync("git", ["config", "--local", "core.hooksPath", ".other-hooks"], { cwd: root });
  const result = runCheck(root);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Gitフックの設定先が .githooks ではありません/);
  assert.match(result.stderr, /pnpm setup:hooks を実行してください/);
});
