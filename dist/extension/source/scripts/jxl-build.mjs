import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {createHash} from "node:crypto";

const encoderFiles = ["jxl_enc.js", "jxl_enc.wasm"];

export async function verifyJxlPackage(root, jxlPackage) {
  const provenance = JSON.parse(await readFile(join(root, "third_party", "jxl", "provenance.json"), "utf8"));
  const pkg = JSON.parse(await readFile(join(jxlPackage, "package.json"), "utf8"));
  if (pkg.name !== provenance.package || pkg.version !== provenance.version) {
    throw new Error("JXLの版と第三者表示の由来が一致しません。");
  }
  for (const [file, expected] of Object.entries(provenance.sha256)) {
    const actual = createHash("sha256").update(await readFile(join(jxlPackage, file))).digest("hex");
    if (actual !== expected) throw new Error(`JXLの第三者表示を再確認してください: ${file}`);
  }
}

export async function copyJxlVendor({jxlPackage, jxlVendor}) {
  await mkdir(join(jxlVendor, "codec", "enc"), {recursive: true});
  for (const file of encoderFiles) {
    await copyFile(join(jxlPackage, "codec", "enc", file), join(jxlVendor, "codec", "enc", file));
  }
  for (const file of ["utils.js", "LICENSE"]) {
    await copyFile(join(jxlPackage, file), join(jxlVendor, file));
  }
}

export async function rewriteJxlAdapter(path, vendorPath = "./vendor") {
  const source = await readFile(path, "utf8");
  const code = source
    .replaceAll('import("harvest-vendor-jxl-encoder")', `import("${vendorPath}/jxl/codec/enc/jxl_enc.js")`)
    .replaceAll('import("harvest-vendor-jxl-utils")', `import("${vendorPath}/jxl/utils.js")`);
  if (code.includes("harvest-vendor-jxl-")) throw new Error("JXLエンコーダーの参照を拡張機能内のファイルへ変換できません。");
  await writeFile(path, code);
}
