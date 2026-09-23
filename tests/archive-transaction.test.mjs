import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { replaceArchiveAfterValidation } from "../scripts/archive-transaction.mjs";

async function createTemporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "harvest-archive-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("validation failure preserves the previous archive and removes the temporary file", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const outputPath = join(directory, "Harvest-extension.zip");
  await writeFile(outputPath, "previous archive");

  await assert.rejects(
    replaceArchiveAfterValidation(outputPath, {
      createArchive: (temporaryPath) => writeFile(temporaryPath, "invalid archive"),
      validateArchive: async () => { throw new Error("archive validation failed"); }
    }),
    /archive validation failed/
  );

  assert.equal(await readFile(outputPath, "utf8"), "previous archive");
  assert.deepEqual(await readdir(directory), ["Harvest-extension.zip"]);
});

test("validated archive replaces the previous archive", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const outputPath = join(directory, "Harvest-extension.zip");
  await writeFile(outputPath, "previous archive");

  await replaceArchiveAfterValidation(outputPath, {
    createArchive: (temporaryPath) => writeFile(temporaryPath, "validated archive"),
    validateArchive: async (temporaryPath) => {
      assert.equal(await readFile(temporaryPath, "utf8"), "validated archive");
    }
  });

  assert.equal(await readFile(outputPath, "utf8"), "validated archive");
  assert.deepEqual(await readdir(directory), ["Harvest-extension.zip"]);
});
