import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkRelativeImports, findModuleSpecifiers } from "../scripts/build-imports.mjs";

test("imports are read from syntax and ignore comments and string contents", () => {
  const source = `
    // import "./comment.js";
    const note = "export { value } from './string.js'";
    import { first } from "./first.js";
    export { second } from "./second.js";
    const lazy = import("./lazy.js");
  `;
  assert.deepEqual(findModuleSpecifiers(source, "app.js"), ["./first.js", "./second.js", "./lazy.js"]);
});

test("missing relative import targets are rejected", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "harvest-build-imports-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "app"));
  const importer = join(directory, "app", "index.js");
  await writeFile(importer, 'import "./missing.js";\n');
  await assert.rejects(checkRelativeImports([importer], directory), /import先が配布物にありません/);
});
