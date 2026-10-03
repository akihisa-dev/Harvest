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
  const wasmDetectPackage = join(root, "wasm-detect-package");
  const jxlVendor = join(root, "output", "jxl");
  const wasmDetectVendor = join(root, "output", "wasm-feature-detect");
  await mkdir(join(jxlPackage, "codec", "enc"), {recursive: true});
  await mkdir(join(wasmDetectPackage, "dist", "esm"), {recursive: true});
  for (const file of ["jxl_enc.js", "jxl_enc.wasm", "jxl_enc_mt.js", "jxl_enc_mt.wasm", "jxl_enc_mt.worker.js"]) {
    await writeFile(join(jxlPackage, "codec", "enc", file), file);
  }
  await writeFile(join(jxlPackage, "utils.js"), "utils");
  await writeFile(join(jxlPackage, "LICENSE"), "Apache-2.0 JXL");
  await writeFile(join(wasmDetectPackage, "dist", "esm", "index.js"), "detect");
  await writeFile(join(wasmDetectPackage, "LICENSE"), "Apache-2.0 wasm-feature-detect");

  await copyJxlVendor({jxlPackage, jxlVendor, wasmDetectPackage, wasmDetectVendor});

  assert.deepEqual((await readdir(join(jxlVendor, "codec", "enc"))).sort(), ["jxl_enc.js", "jxl_enc.wasm"]);
  assert.equal(await readFile(join(jxlVendor, "LICENSE"), "utf8"), "Apache-2.0 JXL");
  assert.equal(await readFile(join(wasmDetectVendor, "LICENSE"), "utf8"), "Apache-2.0 wasm-feature-detect");
  assert.equal(await readFile(join(wasmDetectVendor, "dist", "esm", "index.js"), "utf8"), "detect");
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
