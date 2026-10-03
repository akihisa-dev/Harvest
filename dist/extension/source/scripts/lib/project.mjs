import {readFile, readdir} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export const readJson = async path => JSON.parse(await readFile(path, "utf8"));

export async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}
