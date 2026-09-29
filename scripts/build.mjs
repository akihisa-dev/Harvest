import { spawnSync } from "node:child_process";
import { access, cp, copyFile, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import process from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const output = join(dist, "extension");
const stage = join(dist, ".extension-stage-" + process.pid);
const backup = join(dist, ".extension-backup-" + process.pid);
const manifest = JSON.parse(await readFile(join(root, "manifest.template.json"), "utf8"));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
let movedOldOutput = false;

async function trimVendorJavaScript(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await trimVendorJavaScript(path);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      const source = await readFile(path, "utf8");
      const trimmed = source.replace(/[ \t]+(?=\r?$)/gm, "");
      if (trimmed !== source) await writeFile(path, trimmed);
    }
  }
}

if (manifest.version !== packageJson.version) {
  throw new Error("package.jsonとmanifest.template.jsonのversionが一致しません。");
}

await mkdir(dist, { recursive: true });
await rm(stage, { recursive: true, force: true });
await rm(backup, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

try {
  const compiler = join(root, "node_modules", "typescript", "bin", "tsc");
  const result = spawnSync(process.execPath, [
    compiler, "--project", join(root, "tsconfig.json"), "--noEmit", "false",
    "--outDir", join(stage, ".compiled")
  ], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("TypeScriptのビルドに失敗しました。");

  await mkdir(join(stage, "app"), { recursive: true });
  await mkdir(join(stage, "core"), { recursive: true });
  await mkdir(join(stage, "icons"), { recursive: true });
  await mkdir(join(stage, "brand"), { recursive: true });
  await mkdir(join(stage, "source", "assets", "brand"), { recursive: true });
  await mkdir(join(stage, "source", "assets", "icons"), { recursive: true });
  await mkdir(join(stage, "source", "app"), { recursive: true });
  await mkdir(join(stage, "source", "src", "core"), { recursive: true });
  await mkdir(join(stage, "source", "src", "extension"), { recursive: true });
  await mkdir(join(stage, "source", "scripts"), { recursive: true });
  await mkdir(join(stage, "source", "tests"), { recursive: true });
  for (const locale of ["ja", "en"]) await mkdir(join(stage, "_locales", locale), { recursive: true });
  const compiledExtension = join(stage, ".compiled", "extension");
  for (const file of await readdir(compiledExtension, { recursive: true })) {
    if (!file.endsWith(".js")) continue;
    const source = join(compiledExtension, file);
    const destination = file === "background.js"
      ? join(stage, "background.js")
      : join(stage, "app", file === "app.js" ? "index.js" : file);
    await mkdir(dirname(destination), { recursive: true });
    if (file === "jxl-codec.js") {
      const code = (await readFile(source, "utf8")).replace('import("harvest-vendor-jxl")', 'import("./vendor/jxl/encode.js")');
      if (code.includes("harvest-vendor-jxl")) throw new Error("JXLエンコーダーの参照を拡張機能内のファイルへ変換できません。");
      await writeFile(destination, code);
    } else {
      await copyFile(source, destination);
    }
  }
  const jxlPackage = join(root, "node_modules", "@jsquash", "jxl");
  const jxlVendor = join(stage, "app", "vendor", "jxl");
  const jxlRealPath = await realpath(jxlPackage);
  const wasmDetectPackage = join(dirname(dirname(jxlRealPath)), "wasm-feature-detect");
  const wasmDetectVendor = join(stage, "app", "vendor", "wasm-feature-detect");
  await mkdir(join(jxlVendor, "codec"), {recursive: true});
  await cp(join(jxlPackage, "codec", "enc"), join(jxlVendor, "codec", "enc"), {recursive: true});
  for (const file of ["encode.js", "meta.js", "utils.js", "LICENSE"]) {
    await copyFile(join(jxlPackage, file), join(jxlVendor, file));
  }
  await mkdir(join(wasmDetectVendor, "dist", "esm"), {recursive: true});
  const featureDetect = await readFile(join(wasmDetectPackage, "dist", "esm", "index.js"), "utf8");
  await writeFile(join(wasmDetectVendor, "dist", "esm", "index.js"), featureDetect);
  await copyFile(join(wasmDetectPackage, "LICENSE"), join(wasmDetectVendor, "LICENSE"));
  const jxlEncode = join(jxlVendor, "encode.js");
  const jxlCode = (await readFile(jxlEncode, "utf8")).replace(
    "from 'wasm-feature-detect'",
    "from '../wasm-feature-detect/dist/esm/index.js'",
  );
  if (jxlCode.includes("from 'wasm-feature-detect'")) throw new Error("JXLの機能検出参照を拡張機能内のファイルへ変換できません。");
  await writeFile(jxlEncode, jxlCode);
  await trimVendorJavaScript(join(stage, "app", "vendor"));
  await cp(join(stage, ".compiled", "core"), join(stage, "core"), { recursive: true });
  await copyFile(join(root, "app", "index.html"), join(stage, "app", "index.html"));
  await copyFile(join(root, "app", "style.css"), join(stage, "app", "style.css"));
  await copyFile(join(root, "app", "legal.html"), join(stage, "app", "legal.html"));
  await copyFile(join(root, "assets", "brand", "harvest-geometric-logo.svg"), join(stage, "brand", "harvest-geometric-logo.svg"));
  for (const size of [16, 32, 48, 128]) {
    await copyFile(join(root, "assets", "icons", `icon-${size}.png`), join(stage, "icons", `icon-${size}.png`));
  }
  for (const locale of ["ja", "en"]) {
    await copyFile(join(root, "_locales", locale, "messages.json"), join(stage, "_locales", locale, "messages.json"));
  }
  await copyFile(join(root, "LICENSE"), join(stage, "LICENSE"));
  await copyFile(join(root, "SOURCE.md"), join(stage, "SOURCE.md"));
  await copyFile(join(root, "LICENSE"), join(stage, "source", "LICENSE"));
  await copyFile(join(root, "SOURCE.md"), join(stage, "source", "README.md"));
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "manifest.template.json"]) {
    await copyFile(join(root, file), join(stage, "source", file));
  }
  for (const file of ["index.html", "style.css", "legal.html"]) {
    await copyFile(join(root, "app", file), join(stage, "source", "app", file));
  }
  await cp(join(root, "src", "core"), join(stage, "source", "src", "core"), { recursive: true });
  await cp(join(root, "src", "extension"), join(stage, "source", "src", "extension"), { recursive: true });
  for (const directory of ["scripts", "tests"]) {
    for (const file of await readdir(join(root, directory))) {
      if (!file.endsWith(".mjs")) continue;
      await copyFile(join(root, directory, file), join(stage, "source", directory, file));
    }
  }
  await copyFile(join(root, "assets", "brand", "harvest-logo-master.png"), join(stage, "source", "assets", "brand", "harvest-logo-master.png"));
  await copyFile(join(root, "assets", "brand", "harvest-geometric-logo.svg"), join(stage, "source", "assets", "brand", "harvest-geometric-logo.svg"));
  for (const size of [16, 32, 48, 128]) {
    await copyFile(join(root, "assets", "icons", `icon-${size}.png`), join(stage, "source", "assets", "icons", `icon-${size}.png`));
  }
  for (const locale of ["ja", "en"]) {
    await mkdir(join(stage, "source", "_locales", locale), { recursive: true });
    await copyFile(join(root, "_locales", locale, "messages.json"), join(stage, "source", "_locales", locale, "messages.json"));
  }
  await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await rm(join(stage, ".compiled"), { recursive: true, force: true });

  try {
    await access(output);
    await rename(output, backup);
    movedOldOutput = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await rename(stage, output);
  } catch (error) {
    if (movedOldOutput) await rename(backup, output);
    throw error;
  }
  if (movedOldOutput) await rm(backup, { recursive: true, force: true });
  console.log("Built dist/extension.");
} catch (error) {
  await rm(stage, { recursive: true, force: true });
  throw error;
}
