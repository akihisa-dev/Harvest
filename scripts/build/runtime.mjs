import {spawnSync} from "node:child_process";
import {copyFile, mkdir, readFile, readdir, realpath, writeFile} from "node:fs/promises";
import {dirname, join, sep} from "node:path";
import {copyJxlVendor, rewriteJxlAdapter} from "../jxl-build.mjs";
import {adaptMediabunnyVideoTiming} from "../mediabunny-build.mjs";

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

export async function compileTypeScript(root, stage) {
  const compiler = join(root, "node_modules", "typescript", "bin", "tsc");
  const result = spawnSync(process.execPath, [
    compiler, "--project", join(root, "tsconfig.json"), "--noEmit", "false",
    "--outDir", join(stage, ".compiled")
  ], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("TypeScriptのビルドに失敗しました。");
}

export async function copyRuntimeModules(stage) {
  const compiledExtension = join(stage, ".compiled", "extension");
  for (const file of await readdir(compiledExtension, { recursive: true })) {
    if (!file.endsWith(".js")) continue;
    const modulePath = file.split(sep).join("/");
    const source = join(compiledExtension, file);
    const destination = file === "background.js"
      ? join(stage, "background.js")
      : join(stage, "app", file === "app.js" ? "index.js" : file);
    await mkdir(dirname(destination), { recursive: true });
    if (modulePath === "workers/jxl-codec.js") {
      await copyFile(source, destination);
      await rewriteJxlAdapter(destination, "../vendor");
    } else if (modulePath === "workers/mp4-codec.js" || modulePath === "media/original-media-validation.js") {
      const code = await readFile(source, "utf8");
      await writeFile(destination, code.replace('from "harvest-vendor-mediabunny"', 'from "../vendor/mediabunny/index.js"'));
    } else {
      await copyFile(source, destination);
    }
  }
}

export async function buildBookmarkCaptureEntry(stage) {
  const code = await readFile(join(stage, "app/content/x-bookmark-capture.js"), "utf8");
  if (!code.startsWith("/**") || !code.includes("export function installXBookmarkCapture()")) {
    throw new Error("Xの読み取りスクリプトを生成できません。");
  }
  await writeFile(join(stage, "x-bookmark-capture.js"),
    "(() => {\n" + code.replace("export function installXBookmarkCapture()", "function installXBookmarkCapture()")
      + "\ninstallXBookmarkCapture();\n})();\n");
}

export async function copyVendorLibraries(root, stage) {
  const jxlPackage = join(root, "node_modules", "@jsquash", "jxl");
  const jxlVendor = join(stage, "app", "vendor", "jxl");
  const jxlRealPath = await realpath(jxlPackage);
  const wasmDetectPackage = join(dirname(dirname(jxlRealPath)), "wasm-feature-detect");
  const wasmDetectVendor = join(stage, "app", "vendor", "wasm-feature-detect");
  await copyJxlVendor({jxlPackage, jxlVendor, wasmDetectPackage, wasmDetectVendor});
  const mediaVendor = join(stage, "app", "vendor", "mediabunny");
  await mkdir(mediaVendor, {recursive: true});
  const mediaBundle = await readFile(join(root, "node_modules", "mediabunny", "dist", "bundles", "mediabunny.min.mjs"), "utf8");
  await writeFile(join(mediaVendor, "index.js"), adaptMediabunnyVideoTiming(mediaBundle));
  await copyFile(join(root, "node_modules", "mediabunny", "LICENSE"), join(mediaVendor, "LICENSE"));
  await trimVendorJavaScript(join(stage, "app", "vendor"));
}
