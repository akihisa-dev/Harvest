import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import test from "node:test";
import {replaceDirectory} from "../scripts/build/output-transaction.mjs";
import {correspondingSource} from "../scripts/build/artifact-plan.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "harvest-build-transaction-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const output = join(root, "extension");
  await mkdir(output);
  await writeFile(join(output, "manifest.json"), "previous");
  return {root, output};
}
const prepare = async stage => { await mkdir(stage); await writeFile(join(stage, "manifest.json"), "next"); };

test("build preparation failure keeps the old distribution and removes partial output", async t => {
  const {root, output} = await fixture(t);
  await assert.rejects(replaceDirectory(output, async stage => {
    await prepare(stage); throw new Error("compile failed");
  }), /compile failed/);
  assert.equal(await readFile(join(output, "manifest.json"), "utf8"), "previous");
  assert.deepEqual(await readdir(root), ["extension"]);
});

test("publication failure restores the old distribution", async t => {
  const {root, output} = await fixture(t);
  let calls = 0;
  await assert.rejects(replaceDirectory(output, prepare, {rename: async (...args) => {
    if (++calls === 2) throw new Error("publish failed");
    await rename(...args);
  }}), /publish failed/);
  assert.equal(await readFile(join(output, "manifest.json"), "utf8"), "previous");
  assert.deepEqual(await readdir(root), ["extension"]);
});

test("restoration failure preserves the only previous copy for recovery", async t => {
  const {root, output} = await fixture(t);
  let calls = 0;
  await assert.rejects(replaceDirectory(output, prepare, {rename: async (...args) => {
    if (++calls > 1) throw new Error("filesystem unavailable");
    await rename(...args);
  }}), AggregateError);
  const [workspace] = await readdir(root);
  assert.equal(await readFile(join(root, workspace, "previous/manifest.json"), "utf8"), "previous");
});

test("successful builds replace a previous distribution and also support first builds", async t => {
  const {root, output} = await fixture(t);
  for (let attempt = 0; attempt < 2; attempt++) {
    await replaceDirectory(output, prepare);
    assert.equal(await readFile(join(output, "manifest.json"), "utf8"), "next");
    assert.deepEqual(await readdir(root), ["extension"]);
    await rm(output, {recursive: true});
  }
});

test("corresponding source follows nested build and test support files", async t => {
  const {root} = await fixture(t);
  for (const file of ["src/core/item.ts", "scripts/build/pipeline.mjs", "scripts/windows-zip.ps1", "tests/support/browser.mjs", "tests/.DS_Store"]) {
    await mkdir(join(root, file, ".."), {recursive: true});
    await writeFile(join(root, file), "fixture");
  }
  const plan = new Map(await correspondingSource(root));
  for (const file of ["src/core/item.ts", "scripts/build/pipeline.mjs", "scripts/windows-zip.ps1", "tests/support/browser.mjs"]) {
    assert.equal(plan.get(file), join("source", file));
  }
  assert.equal(plan.has("tests/.DS_Store"), false);
});
