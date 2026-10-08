import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("../scripts/check-version-staged.mjs", import.meta.url));
const next = fileURLToPath(new URL("../scripts/version-next.mjs", import.meta.url));
const files = ["package.json", "manifest.template.json", "dist/extension/manifest.json"];

test("未反映コミットの区分を順次加算し、下位桁をリセットする", () => {
  for (const [levels, expected] of [
    [["patch", "patch", "patch"], "1.2.6"],
    [["patch", "minor", "patch"], "1.3.1"],
    [["minor", "major", "patch"], "2.0.1"],
  ]) {
    assert.equal(execFileSync(process.execPath, [next, "1.2.3", ...levels], { encoding: "utf8" }).trim(), expected);
  }
  assert.notEqual(spawnSync(process.execPath, [next, "1.2.3", "unknown"]).status, 0);
});

test("通常コミットは版更新を要求せず、版更新では同期と登録漏れを検出する", t => {
  const root = mkdtempSync(join(tmpdir(), "harvest-version-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const write = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), JSON.stringify(value));
  };
  const check = () => spawnSync(process.execPath, [checker], { cwd: root, encoding: "utf8" });
  git("init", "--quiet");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.hooksPath", "/dev/null");
  for (const file of files) write(file, { version: "1.0.0" });
  git("add", ...files);
  assert.equal(check().status, 0); // Initial synchronized versions.
  git("commit", "--quiet", "-m", "initial");
  write("note.json", { note: "documentation" });
  git("add", "note.json");
  assert.equal(check().status, 0);
  write(files[0], { version: "1.0.0", description: "maintenance" });
  git("add", files[0]);
  assert.equal(check().status, 0);
  write(files[0], { version: "1.0.1" });
  git("add", files[0]);
  assert.notEqual(check().status, 0);
  // Unstaged matching files must not hide the mismatch in the index.
  for (const file of files.slice(1)) write(file, { version: "1.0.1" });
  assert.notEqual(check().status, 0);
  git("add", ...files.slice(1));
  assert.equal(check().status, 0);
  git("commit", "--quiet", "-m", "version update");
  write(files[0], { version: "1.0.0" });
  git("add", files[0]);
  assert.notEqual(check().status, 0);
});
