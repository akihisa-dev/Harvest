import {cp, copyFile, mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {projectRoot, readJson} from "../lib/project.mjs";
import {applicationAssets, correspondingSource} from "./artifact-plan.mjs";
import {replaceDirectory} from "./output-transaction.mjs";
import {compileTypeScript, copyRuntimeModules, buildBookmarkCaptureEntry, copyVendorLibraries} from "./runtime.mjs";

export async function buildExtension(root = projectRoot) {
  const manifest = await readJson(join(root, "manifest.template.json"));
  const packageJson = await readJson(join(root, "package.json"));
  if (manifest.version !== packageJson.version) {
    throw new Error("package.jsonとmanifest.template.jsonのversionが一致しません。");
  }
  const dist = join(root, "dist");
  await mkdir(dist, {recursive: true});
  await replaceDirectory(join(dist, "extension"), async stage => {
    await mkdir(stage);
    await compileTypeScript(root, stage);
    await copyRuntimeModules(stage);
    await buildBookmarkCaptureEntry(stage);
    await copyVendorLibraries(root, stage);
    await cp(join(stage, ".compiled", "core"), join(stage, "core"), {recursive: true});
    for (const [source, destination] of [...applicationAssets(), ...await correspondingSource(root)]) {
      const target = join(stage, destination);
      await mkdir(dirname(target), {recursive: true});
      await copyFile(join(root, source), target);
    }
    await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await rm(join(stage, ".compiled"), {recursive: true, force: true});
  });
}
