import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copyJxlVendor, rewriteJxlAdapter } from "../scripts/jxl-build.mjs";

test("JXL build stages the single-thread encoder and required licenses only", async t => {
  const root = await mkdtemp(join(tmpdir(), "harvest-jxl-build-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const jxlPackage = join(root, "jxl-package");
  const jxlVendor = join(root, "output", "jxl");
  await mkdir(join(jxlPackage, "codec", "enc"), {recursive: true});
  for (const file of ["jxl_enc.js", "jxl_enc.wasm", "jxl_enc_mt.js", "jxl_enc_mt.wasm", "jxl_enc_mt.worker.js"]) {
    await writeFile(join(jxlPackage, "codec", "enc", file), file);
  }
  await writeFile(join(jxlPackage, "utils.js"), "utils");
  await writeFile(join(jxlPackage, "LICENSE"), "Apache-2.0 JXL");

  await copyJxlVendor({jxlPackage, jxlVendor});

  assert.deepEqual((await readdir(join(jxlVendor, "codec", "enc"))).sort(), ["jxl_enc.js", "jxl_enc.wasm"]);
  assert.equal(await readFile(join(jxlVendor, "LICENSE"), "utf8"), "Apache-2.0 JXL");
  assert.deepEqual(await readdir(join(root, "output")), ["jxl"]);
});

test("JXL adapter references are rewritten to bundled files", async t => {
  const root = await mkdtemp(join(tmpdir(), "harvest-jxl-adapter-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, "jxl-codec.js");
  for (const vendorPath of ["./vendor", "../vendor"]) {
    await writeFile(path, 'import("harvest-vendor-jxl-encoder"); import("harvest-vendor-jxl-utils");');
    await rewriteJxlAdapter(path, vendorPath);
    assert.equal(await readFile(path, "utf8"), `import("${vendorPath}/jxl/codec/enc/jxl_enc.js"); import("${vendorPath}/jxl/utils.js");`);
  }
});
