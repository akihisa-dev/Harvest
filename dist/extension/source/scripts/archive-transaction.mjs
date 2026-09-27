import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function replaceArchiveAfterValidation(outputPath, { createArchive, validateArchive }) {
  const temporaryPath = join(dirname(outputPath), `.${basename(outputPath)}.${randomUUID()}.tmp.zip`);

  try {
    await createArchive(temporaryPath);
    await validateArchive(temporaryPath);
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}
