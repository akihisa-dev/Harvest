import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const encoderFiles = ["jxl_enc.js", "jxl_enc.wasm"];

export async function copyJxlVendor({jxlPackage, jxlVendor, wasmDetectPackage, wasmDetectVendor}) {
  await mkdir(join(jxlVendor, "codec", "enc"), {recursive: true});
  for (const file of encoderFiles) {
    await copyFile(join(jxlPackage, "codec", "enc", file), join(jxlVendor, "codec", "enc", file));
  }
  for (const file of ["utils.js", "LICENSE"]) {
    await copyFile(join(jxlPackage, file), join(jxlVendor, file));
  }
  await mkdir(join(wasmDetectVendor, "dist", "esm"), {recursive: true});
  await copyFile(join(wasmDetectPackage, "dist", "esm", "index.js"), join(wasmDetectVendor, "dist", "esm", "index.js"));
  await copyFile(join(wasmDetectPackage, "LICENSE"), join(wasmDetectVendor, "LICENSE"));
}

export async function rewriteJxlAdapter(path, vendorPath = "./vendor") {
  const source = await readFile(path, "utf8");
  const code = source
    .replaceAll('import("harvest-vendor-jxl-encoder")', `import("${vendorPath}/jxl/codec/enc/jxl_enc.js")`)
    .replaceAll('import("harvest-vendor-jxl-utils")', `import("${vendorPath}/jxl/utils.js")`);
  if (code.includes("harvest-vendor-jxl-")) throw new Error("JXLエンコーダーの参照を拡張機能内のファイルへ変換できません。");
  await writeFile(path, code);
}
