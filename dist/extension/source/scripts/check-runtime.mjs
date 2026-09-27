import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [nodeMajor] = process.versions.node.split(".").map(Number);
if (!Number.isInteger(nodeMajor) || nodeMajor < 22 || nodeMajor >= 27) {
  throw new Error(`Node.js ${process.versions.node} は対応範囲外です（>=22 <27）。`);
}

const { packageManager } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const packageManagerMatch = /^pnpm@(\d+)\.(\d+)\.(\d+)$/.exec(packageManager || "");
if (!packageManagerMatch) throw new Error("packageManagerはpnpmの固定versionで指定してください。");
const expectedPnpmVersion = packageManagerMatch.slice(1).join(".");
const pnpmCommand = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "pnpm";
const pnpmArgs = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm --version"] : ["--version"];

let pnpmVersion;
const invokingUserAgent = process.env.npm_config_user_agent?.match(/(?:^|\s)pnpm\/(\d+\.\d+\.\d+)/)?.[1];
if (invokingUserAgent) {
  pnpmVersion = invokingUserAgent;
} else {
  try {
    pnpmVersion = execFileSync(pnpmCommand, pnpmArgs, {
      encoding: "utf8",
      timeout: 5000,
      killSignal: "SIGTERM",
    }).trim();
  } catch {
    throw new Error("pnpmのversion確認に失敗しました。packageManagerの指定版を有効にしてください。");
  }
}

if (!/^\d+\.\d+\.\d+$/.test(pnpmVersion)) {
  throw new Error(`pnpm versionを解釈できません: ${pnpmVersion}`);
}
if (pnpmVersion !== expectedPnpmVersion) {
  throw new Error(`pnpm ${pnpmVersion} は宣言されたversion ${expectedPnpmVersion} と一致しません。`);
}

console.log(`runtime ok: node ${process.versions.node}, pnpm ${pnpmVersion}`);
