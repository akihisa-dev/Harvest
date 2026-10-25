import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const hook = fileURLToPath(new URL("../.githooks/pre-push", import.meta.url));
const checker = fileURLToPath(new URL("../scripts/check-generated.mjs", import.meta.url));
test("pre-pushは再生成後の配布物漏れを拒否し、無関係な差分を許容する", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harvest-pre-push-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const git = (...args) => execFileSync("git", args, {cwd: root});
  git("init", "--quiet"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
  fs.mkdirSync(path.join(root, "dist/extension"), {recursive: true});
  fs.mkdirSync(path.join(root, "bin"));
  // Only the build boundary is stubbed: the real cleanliness check runs afterwards.
  fs.writeFileSync(path.join(root, "bin/pnpm"), `#!/bin/sh
if [ "$1" = "verify" ]; then cp source.txt dist/extension/app.js; else exec "$NODE_BIN" "$CHECKER"; fi
`, {mode: 0o755});
  const write = (name, value) => fs.writeFileSync(path.join(root, name), value);
  write("source.txt", "old"); write("dist/extension/app.js", "old");
  git("add", "source.txt", "dist/extension/app.js"); git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture");
  const run = () => spawnSync("sh", [hook], {cwd: root, encoding: "utf8", env: {...process.env, PATH: `${root}/bin:${process.env.PATH}`, NODE_BIN: process.execPath, CHECKER: checker}});
  assert.equal(run().status, 0);
  write("source.txt", "new"); git("add", "source.txt"); git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "source only");
  let result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /dist\/extension/);
  git("add", "dist/extension/app.js"); git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "artifact");
  write("unrelated.txt", "work in progress"); assert.equal(run().status, 0);
  write("dist/extension/app.js", "stale"); git("add", "dist/extension/app.js"); git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "stale artifact");
  assert.notEqual(run().status, 0);
});
