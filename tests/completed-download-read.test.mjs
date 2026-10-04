import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {readCompletedDownload} from "./support/animation-panel.mjs";
import {animatedGif} from "./animation-fixtures.mjs";

for (const initial of ["empty", "missing"]) {
  test(`completed download waits for ${initial} file to contain its actual bytes`, async t => {
    const directory = await mkdtemp(join(tmpdir(), "harvest-download-read-"));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const filename = join(directory, "animation.gif");
    if (initial === "empty") await writeFile(filename, Buffer.alloc(0));
    const timer = setTimeout(() => writeFile(filename, animatedGif), 60);
    t.after(() => clearTimeout(timer));
    assert.deepEqual(await readCompletedDownload(filename), animatedGif);
  });
}

test("completed download rejects a file that remains empty at the existing deadline", async t => {
  const directory = await mkdtemp(join(tmpdir(), "harvest-download-read-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const filename = join(directory, "empty.gif");
  await writeFile(filename, Buffer.alloc(0));
  await assert.rejects(readCompletedDownload(filename), /stayed empty or unavailable: initialSize=0/);
});

test("completed download propagates other filesystem failures", async t => {
  const directory = await mkdtemp(join(tmpdir(), "harvest-download-read-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await assert.rejects(readCompletedDownload(directory), {code: "EISDIR"});
});
