import assert from "node:assert/strict";
import {readFile, access, mkdtemp, cp, symlink, rm} from "node:fs/promises";
import {join, resolve, relative} from "node:path";
import {tmpdir} from "node:os";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import test from "node:test";
import ts from "typescript";
import {filesUnder} from "../scripts/lib/project.mjs";
import {verifyJxlPackage} from "../scripts/jxl-build.mjs";

test("配布Mediabunnyは製品が使うAPIだけを公開し、全機能版より小さい", async () => {
  const used = new Set();
  for (const path of await filesUnder("src/extension")) {
    if (!path.endsWith(".ts") || path.endsWith(".d.ts")) continue;
    const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || node.moduleSpecifier.text !== "harvest-vendor-mediabunny") continue;
      assert.ok(ts.isNamedImports(node.importClause.namedBindings));
      for (const item of node.importClause.namedBindings.elements) used.add((item.propertyName ?? item.name).text);
    }
  }
  const bundled = await import("../dist/extension/app/vendor/mediabunny/index.js");
  assert.deepEqual(Object.keys(bundled).sort(), [...used].sort(), "テスト専用や未使用の公開APIを製品に含めない");
  const [reduced, upstream] = await Promise.all([
    readFile("dist/extension/app/vendor/mediabunny/index.js"),
    readFile("node_modules/mediabunny/dist/bundles/mediabunny.min.mjs"),
  ]);
  assert.ok(reduced.length < upstream.length * .7, "全機能版に戻って配布容量が増えないこと");
  await assert.rejects(access("dist/extension/app/vendor/wasm-feature-detect"), {code: "ENOENT"});
});

test("改変MPLソースと内部コーデックの表示を配布し、利用者の案内から辿れる", async () => {
  const root = resolve("dist/extension");
  const html = await readFile(join(root, "app/legal.html"), "utf8");
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    assert.ok(!/^https?:/.test(href), "案内先とライセンスは配布物から読めること");
    await access(resolve(root, "app", href.split("#")[0]));
  }
  const modified = await readFile(join(root, "source/vendor/mediabunny/conversion.ts"), "utf8");
  assert.match(modified, /Mozilla Public/);
  assert.match(modified, /Modified by Harvest/);
  assert.match(modified, /for await \(using sample of harvestVideoSamples/);
  assert.match(modified, /new AudioSampleSink\(track\)/);
  assert.deepEqual(await readFile(join(root, "source/vendor/mediabunny/LICENSE")),
    await readFile("node_modules/mediabunny/LICENSE"));
  const instructions = await readFile(join(root, "SOURCE.md"), "utf8");
  assert.match(instructions, /0f91fe768e7ee42703f15e2b8845551b0f1028b3/);
  assert.match(instructions, /source\/vendor\/mediabunny\/conversion.ts/);
  await verifyJxlPackage(resolve("."), resolve("node_modules/@jsquash/jxl"));
  const notices = await readFile(join(root, "app/vendor/jxl/THIRD-PARTY-NOTICES.txt"), "utf8");
  for (const component of ["libjxl", "Brotli", "Highway", "skcms", "Emscripten"]) {
    assert.ok(notices.includes(`===== ${component} |`));
  }
});

test("Git管理外の同梱ソースと固定依存からZIPを再作成し、全内容を維持する", async t => {
  const root = await mkdtemp(join(tmpdir(), "harvest-source-rebuild-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const expected = resolve("dist/extension");
  await cp(join(expected, "source"), root, {recursive: true});
  // Reuse the installed, lockfile-pinned dependencies; no network in this test.
  await symlink(resolve("node_modules"), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const run = promisify(execFile);
  if (process.platform === 'win32') await run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm package:extension'], {cwd: root});
  else await run('pnpm', ['package:extension'], {cwd: root});
  const {version} = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const archive = join(root, 'dist', `Harvest-extension-${version}.zip`);
  const unpacked = join(root, 'unpacked');
  if (process.platform === 'win32') {
    await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath $env.HARVEST_TEST_ARCHIVE -DestinationPath $env.HARVEST_TEST_UNPACKED'],
      {cwd: root, env: {...process.env, HARVEST_TEST_ARCHIVE: archive, HARVEST_TEST_UNPACKED: unpacked}});
  } else await run('unzip', ['-q', archive, '-d', unpacked], {cwd: root});
  assert.equal(JSON.parse(await readFile(join(unpacked, 'manifest.json'), 'utf8')).version, version);
  const actual = join(root, "dist/extension");
  const files = (await filesUnder(expected)).map(path => relative(expected, path));
  assert.deepEqual((await filesUnder(actual)).map(path => relative(actual, path)), files);
  assert.deepEqual((await filesUnder(unpacked)).map(path => relative(unpacked, path)), files);
  for (const file of files) {
    assert.deepEqual(await readFile(join(actual, file)), await readFile(join(expected, file)), file);
    assert.deepEqual(await readFile(join(unpacked, file)), await readFile(join(expected, file)), file);
  }
});
