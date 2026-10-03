import {mkdtemp, rename, rm} from "node:fs/promises";
import {basename, dirname, join} from "node:path";

// The transaction owns only its unique workspace. An old distribution stays
// usable until preparation succeeds, and is restored if publication fails.
export async function replaceDirectory(output, prepare, operations = {rename}) {
  const workspace = await mkdtemp(join(dirname(output), `.${basename(output)}-build-`));
  const stage = join(workspace, "stage");
  const backup = join(workspace, "previous");
  let retainedBackup = false;
  try {
    await prepare(stage);
    let moved = false;
    try { await operations.rename(output, backup); moved = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await operations.rename(stage, output); }
    catch (error) {
      if (moved) {
        try { await operations.rename(backup, output); }
        catch (restoreError) {
          retainedBackup = true;
          throw new AggregateError([error, restoreError], `配布物の復元に失敗しました。退避先: ${backup}`);
        }
      }
      throw error;
    }
  } finally {
    // Never erase the only previous copy when restoration itself failed.
    if (!retainedBackup) await rm(workspace, {recursive: true, force: true});
  }
}
