import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replaceArchiveAfterValidation } from "./archive-transaction.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "dist");
const extensionDirectory = join(dist, "extension");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (typeof packageJson.version !== "string" || !versionPattern.test(packageJson.version)) {
  throw new Error(`package.jsonのversionがSemVer形式ではありません: ${packageJson.version}`);
}

function run(command, args, { cwd, captureOutput = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";

    if (captureOutput) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      const detail = stderr.trim();
      const status = signal ? `signal ${signal}` : `exit code ${code}`;
      rejectPromise(new Error(`${command} failed (${status})${detail ? `: ${detail}` : ""}`));
    });
  });
}

async function rejectSymbolicLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    const details = await lstat(entryPath);
    if (details.isSymbolicLink()) {
      throw new Error(`拡張機能の出力にシンボリックリンクがあります: ${entryPath}`);
    }
    if (details.isDirectory()) await rejectSymbolicLinks(entryPath);
    else if (!details.isFile()) throw new Error(`ZIPに含められないファイルがあります: ${entryPath}`);
  }
}

function normalizeArchiveEntry(entry) {
  let normalized = entry.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "").replace(/\/+$/, "");
  if (!normalized) return "";
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`ZIP内に絶対パスがあります: ${entry}`);
  }
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`ZIP内に不正なパスがあります: ${entry}`);
  }
  return normalized;
}

async function createUnixArchive(archivePath) {
  const excluded = [
    ".DS_Store", "*/.DS_Store",
    "Thumbs.db", "*/Thumbs.db",
    "desktop.ini", "*/desktop.ini"
  ];
  await run("zip", ["-q", "-r", archivePath, ".", "-x", ...excluded], { cwd: extensionDirectory });
}

async function createWindowsArchive(archivePath) {
  const script = join(root, "scripts", "windows-zip.ps1");
  await run("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", script,
    "-SourceDirectory", extensionDirectory,
    "-ArchivePath", archivePath
  ], { cwd: root });
}

async function validateUnixArchive(archivePath) {
  await run("unzip", ["-tq", archivePath], { cwd: root, captureOutput: true });
  const listing = await run("unzip", ["-Z1", archivePath], { cwd: root, captureOutput: true });
  const entries = listing.split(/\r?\n/).filter(Boolean).map(normalizeArchiveEntry).filter(Boolean);

  for (const entry of entries) {
    if ([".ds_store", "thumbs.db", "desktop.ini"].includes(basename(entry).toLowerCase())) {
      throw new Error(`ZIPにOSの管理ファイルが含まれています: ${entry}`);
    }
  }
  if (!entries.includes("manifest.json")) {
    throw new Error("ZIPの最上位にmanifest.jsonがありません。");
  }
}

await run(process.execPath, [join(root, "scripts", "check-runtime.mjs")], { cwd: root });
await run(process.execPath, [join(root, "scripts", "build.mjs")], { cwd: root });

const generatedManifest = JSON.parse(await readFile(join(extensionDirectory, "manifest.json"), "utf8"));
if (generatedManifest.version !== packageJson.version) {
  throw new Error(`生成manifestのversionがpackage.jsonと一致しません: ${generatedManifest.version} != ${packageJson.version}`);
}
await rejectSymbolicLinks(extensionDirectory);
await mkdir(dist, { recursive: true });

const archivePath = resolve(dist, `Harvest-extension-${packageJson.version}.zip`);
await replaceArchiveAfterValidation(archivePath, {
  createArchive: process.platform === "win32" ? createWindowsArchive : createUnixArchive,
  validateArchive: process.platform === "win32" ? async () => {} : validateUnixArchive
});
console.log(`Packaged ${archivePath}`);
