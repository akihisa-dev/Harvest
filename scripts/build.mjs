import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import process from "node:process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const output = join(dist, "extension");
const stage = join(dist, ".extension-stage-" + process.pid);
const backup = join(dist, ".extension-backup-" + process.pid);
const manifest = JSON.parse(await readFile(join(root, "manifest.template.json"), "utf8"));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
let movedOldOutput = false;

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
  await mkdir(join(stage, "_locales", "ja"), { recursive: true });
  await copyFile(join(stage, ".compiled", "extension", "background.js"), join(stage, "background.js"));
  await copyFile(join(root, "app", "index.html"), join(stage, "app", "index.html"));
  await copyFile(join(root, "app", "style.css"), join(stage, "app", "style.css"));
  await copyFile(join(stage, ".compiled", "extension", "app.js"), join(stage, "app", "index.js"));
  await copyFile(join(stage, ".compiled", "core", "images.js"), join(stage, "core", "images.js"));
  await copyFile(join(stage, ".compiled", "core", "pdf.js"), join(stage, "core", "pdf.js"));
  for (const size of [16, 32, 48, 128]) {
    await copyFile(join(root, "assets", "icons", `icon-${size}.png`), join(stage, "icons", `icon-${size}.png`));
  }
  await copyFile(join(root, "_locales", "ja", "messages.json"), join(stage, "_locales", "ja", "messages.json"));
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
