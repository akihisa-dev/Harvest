import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkArchitecture } from "../scripts/check-architecture.mjs";

function check(t, files) {
  const root = mkdtempSync(join(tmpdir(), "harvest-architecture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
      lib: ["ES2022", "DOM"], strict: true, types: [], noEmit: true,
      verbatimModuleSyntax: true,
    },
    include: ["src/**/*.ts"],
  }));
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  return checkArchitecture(root);
}

test("coreはBlob等の標準APIと型のみの相互参照を利用できる", (t) => {
  assert.deepEqual(check(t, {
    "src/core/a.ts": 'import type { B } from "./b.js"; export interface A { b?: B } export const data = new Blob([new TextEncoder().encode("x")]); export const url = new URL("https://example.test"); export const signal = new AbortController().signal;',
    "src/core/b.ts": 'import type { A } from "./a.js"; export interface B { a?: A }',
  }), []);
});

test("coreから画面やChromeへの依存は型参照・別名アクセスも拒否する", (t) => {
  const errors = check(t, {
    "src/core/a.ts": 'import type { View } from "../extension/view.js"; export type State = View; export const root = globalThis.document; export const tabs = chrome.tabs;',
    "src/extension/view.ts": 'export interface View { element: HTMLElement }',
    "src/extension/chrome.d.ts": 'declare const chrome: { tabs: unknown };',
  });
  assert.ok(errors.some((error) => error.includes("coreの依存")));
  assert.ok(errors.some((error) => error.includes("TS7017")));
  assert.ok(errors.some((error) => error.includes("HTMLElement")));
  assert.ok(errors.some((error) => error.includes("chrome")));
});

test("再exportと動的importを経由する実行時循環を検出する", (t) => {
  const errors = check(t, {
    "src/extension/a.ts": 'export { value } from "./b.js";',
    "src/extension/b.ts": 'export const value = 1; export const load = () => import("./c.js");',
    "src/extension/c.ts": 'import "./a.js";',
  });
  assert.ok(errors.some((error) => error.includes("実行時importが循環") && error.includes("a.ts") && error.includes("c.ts")));
});

test("Worker入口から間接参照する画面処理を検出する", (t) => {
  const errors = check(t, {
    "src/extension/workers/example-worker.ts": 'import { run } from "./helper.js"; run();',
    "src/extension/workers/helper.ts": 'export { run } from "../panel/view.js";',
    "src/extension/panel/view.ts": 'export function run() { document.body.textContent = "x"; }',
  });
  assert.ok(errors.some((error) => error.includes("Workerから画面")));
  assert.ok(errors.some((error) => error.includes("Workerの画面非依存") && error.includes("document")));
});

test("ページへ渡す関数は型importを許可し実行時importを拒否する", (t) => {
  const errors = check(t, {
    "src/extension/content/scan.ts": 'import type { Item } from "../../core/item.js"; import { value } from "../../core/item.js"; export function scan(): Item { return { value }; }',
    "src/core/item.ts": 'export interface Item { value: number } export const value = 1;',
  });
  assert.equal(errors.filter((error) => error.includes("実行時importを持てません")).length, 1);
});

test("名前がdocumentの局所変数や説明文字列を誤検出しない", (t) => {
  assert.deepEqual(check(t, {
    "src/core/a.ts": 'export function describe(document: string) { return document + " window chrome HTMLElement"; }',
    "src/extension/workers/example-worker.ts": 'import { describe } from "../../core/a.js"; self.postMessage(describe("x"));',
  }), []);
});


test("inlineのtype指定が残す副作用importも循環の対象とする", (t) => {
  const errors = check(t, {
    "src/extension/a.ts": 'import { type B } from "./b.js"; export interface A { b?: B }',
    "src/extension/b.ts": 'import { type A } from "./a.js"; export interface B { a?: A }',
  });
  assert.ok(errors.some((error) => error.includes("実行時importが循環")));
});


test("型のみでもcontracts/media/browserから画面へ逆向きに依存できない", (t) => {
  const errors = check(t, {
    "src/extension/contracts/a.ts": 'export type { View } from "../panel/view.js";',
    "src/extension/media/b.ts": 'export type State = import("../panel/view.js").View;',
    "src/extension/browser/c.ts": 'import type { View } from "../panel/view.js"; export type State = View;',
    "src/extension/panel/view.ts": 'export interface View { label: string }',
  });
  for (const area of ["contracts", "media", "browser"]) {
    assert.ok(errors.some((error) => error.includes(`${area}からpanelへの依存は禁止`)));
  }
});

test("mediaはWorkerのURLを作れるがWorkerの処理をimportできない", (t) => {
  const errors = check(t, {
    "src/extension/media/client.ts": 'export const address = new URL("../workers/example-worker.js", import.meta.url); import { run } from "../workers/example-worker.js"; export const launch = run;',
    "src/extension/workers/example-worker.ts": 'export function run() {}',
  });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes("mediaからworkersへの依存は禁止"));
});

test("変数を使う動的importも依存検査をすり抜けられない", t => {
  for (const layer of ["content", "media"]) {
    const errors = check(t, {
      [`src/extension/${layer}/entry.ts`]: 'export const load = (path: string) => import(path);',
    });
    assert.ok(errors.some(error => error.includes("動的importの参照先")), layer);
  }
});
