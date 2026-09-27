import { execFileSync } from "node:child_process";

const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);
const requiredFiles = ["package.json", "manifest.template.json", "dist/extension/manifest.json"];

function readStaged(file) {
  try {
    return execFileSync("git", ["show", `:${file}`], { encoding: "utf8" });
  } catch {
    throw new Error(`同一commitに${file}を含めてください。`);
  }
}

for (const file of requiredFiles) {
  if (!staged.includes(file)) throw new Error(`同一commitに${file}を含めてください。`);
}

const packageJson = JSON.parse(readStaged("package.json"));
const template = JSON.parse(readStaged("manifest.template.json"));
const generated = JSON.parse(readStaged("dist/extension/manifest.json"));
const versions = [packageJson.version, template.version, generated.version];
if (!versions.every((version) => version === packageJson.version)) {
  throw new Error(`stageしたversionが一致しません: package=${packageJson.version}, template=${template.version}, generated=${generated.version}`);
}
console.log(`staged version ok: ${packageJson.version}`);
