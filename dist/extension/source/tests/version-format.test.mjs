import test from "node:test";
import assert from "node:assert/strict";
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {execFileSync, spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {assertExtensionVersion} from "../scripts/lib/extension-version.mjs";
import {buildExtension} from "../scripts/build/pipeline.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const versionFiles = ["package.json", "manifest.template.json", "dist/extension/manifest.json"];
const invalidVersions = ["1.7.38-beta.1", "1.7.38+build.1", "1.2", "1.2.3.4", "01.2.3", "1.2.3\n", "65536.0.0", "1.65536.0", "1.0.65536", "0.0.0", "-1.2.3", null, 123];

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "harvest-version-format-"));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  cpSync(join(project, "scripts"), join(root, "scripts"), {recursive: true});
  cpSync(join(project, "_locales"), join(root, "_locales"), {recursive: true});
  const packageJson = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(project, "manifest.template.json"), "utf8"));
  const writeVersions = versions => versionFiles.forEach((file, index) => {
    mkdirSync(dirname(join(root, file)), {recursive: true});
    writeFileSync(join(root, file), JSON.stringify({...(index ? manifest : packageJson), version: versions[index]}));
  });
  const run = script => spawnSync(process.execPath, [join(root, "scripts", script)], {cwd: root, encoding: "utf8"});
  return {root, writeVersions, run};
}

test("Chrome用の3整数だけを受け付け、通常版と上限・不正文字を区別する", () => {
  for (const version of ["1.0.0", "1.7.37", "0.1.0", "65535.65535.65535"]) {
    assert.deepEqual(assertExtensionVersion(version), version.split(".").map(Number));
  }
  for (const version of invalidVersions) assert.throws(() => assertExtensionVersion(version), /Chrome拡張用の3つの整数/);
});

test("同期した不正な版も版検査・manifest検査・配布入口で拒否し、既存出力を保持する", async t => {
  const {root, writeVersions, run} = fixture(t);
  for (const version of ["1.7.38-beta.1", "1.7.38+build.1", "1.0.65536", "0.0.0"]) {
    writeVersions([version, version, version]);
    const before = readFileSync(join(root, "dist/extension/manifest.json"));
    for (const script of ["check-version.mjs", "check-manifest.mjs", "package-extension.mjs"]) {
      const result = run(script);
      assert.notEqual(result.status, 0, `${script}: ${version}`);
      assert.match(result.stderr, /Chrome拡張用の3つの整数/);
    }
    await assert.rejects(buildExtension(root), /Chrome拡張用の3つの整数/);
    assert.deepEqual(readFileSync(join(root, "dist/extension/manifest.json")), before);
  }
  writeVersions(["1.7.37", "1.7.37", "1.7.37"]);
  for (const script of ["check-version.mjs", "check-manifest.mjs"]) assert.equal(run(script).status, 0);
  writeVersions(["1.7.37", "1.7.38", "1.7.37"]);
  for (const script of ["check-version.mjs", "check-manifest.mjs"]) assert.notEqual(run(script).status, 0);
  await assert.rejects(buildExtension(root), /一致/);
});

test("ステージで同期したプレリリース版も拒否し、採番の上限越えを各加算で止める", t => {
  const {root, writeVersions, run} = fixture(t);
  const git = (...args) => execFileSync("git", args, {cwd: root, stdio: "pipe"});
  git("init", "--quiet");
  writeVersions(["1.0.1-beta.1", "1.0.1-beta.1", "1.0.1-beta.1"]);
  git("add", ...versionFiles);
  const result = run("check-version-staged.mjs");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Chrome拡張用の3つの整数/);
  const next = (...args) => spawnSync(process.execPath, [join(project, "scripts/version-next.mjs"), ...args], {encoding: "utf8"});
  for (const args of [["65535.0.0", "major"], ["1.65535.0", "minor"], ["1.0.65535", "patch", "minor"], ["01.0.0", "patch"]]) {
    assert.notEqual(next(...args).status, 0);
  }
  assert.equal(next("1.0.65535", "minor", "patch").stdout.trim(), "1.1.1");
});
