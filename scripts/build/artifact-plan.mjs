import {join, relative} from "node:path";
import {filesUnder} from "../lib/project.mjs";

const appFiles = ["index.html", "style.css", "viewer-motion.css", "legal.html"];
const icons = [16, 32, 48, 128].map(size => `icon-${size}.png`);
const locales = ["ja", "en"].map(locale => `_locales/${locale}/messages.json`);

// These mappings own both build inputs and the corresponding-source audit.
export function applicationAssets() {
  return [
    ...appFiles.map(file => [`app/${file}`, `app/${file}`]),
    ["assets/brand/harvest-geometric-logo.svg", "brand/harvest-geometric-logo.svg"],
    ...icons.map(file => [`assets/icons/${file}`, `icons/${file}`]),
    ...[...locales, "LICENSE", "SOURCE.md"].map(file => [file, file]),
  ];
}

export async function correspondingSource(root) {
  const fixed = [
    ["LICENSE", "LICENSE"], ["SOURCE.md", "README.md"],
    ...["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "manifest.template.json",
      ...appFiles.map(file => `app/${file}`), ...locales,
      "assets/brand/harvest-logo-master.png", "assets/brand/harvest-geometric-logo.svg",
      ...icons.map(file => `assets/icons/${file}`)].map(file => [file, file]),
  ];
  for (const directory of ["src", "scripts", "tests"]) {
    for (const file of await filesUnder(join(root, directory))) {
      if (directory === "src" ? file.endsWith(".DS_Store") : !/\.(?:mjs|ps1)$/.test(file)) continue;
      const path = relative(root, file);
      fixed.push([path, path]);
    }
  }
  return fixed.map(([source, destination]) => [source, join("source", destination)]);
}
