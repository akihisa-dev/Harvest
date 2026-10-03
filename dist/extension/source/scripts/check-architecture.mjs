import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const allowedLayers = {
  contracts: new Set(["core", "contracts"]),
  media: new Set(["core", "media", "contracts", "browser"]),
  browser: new Set(["core", "browser", "contracts", "content"]),
  workers: new Set(["core", "workers", "contracts"]),
  panel: new Set(["core", "panel", "media", "browser", "contracts", "content"]),
  content: new Set(["core", "content", "contracts"]),
};

function layer(path) {
  if (path.startsWith("src/core/")) return "core";
  return /^src\/extension\/([^/]+)\//.exec(path)?.[1];
}

// Source references include type-only dependencies for layer checks.
function moduleReferences(sourceFile) {
  const references = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      references.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      references.push(node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : null);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      references.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return references;
}

export function checkArchitecture(root = process.cwd()) {
  root = resolve(root);
  const configFile = resolve(root, "tsconfig.json");
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length) throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  const name = (file) => relative(root, file).split(sep).join("/");
  const files = parsed.fileNames.filter((file) => !file.endsWith(".d.ts"));
  const known = new Set(files);
  const graph = new Map(files.map((file) => [file, []]));
  const errors = [];
  for (const file of files) {
    const source = ts.sys.readFile(file);
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    // Use the emitted imports: under verbatimModuleSyntax, `import { type X }`
    // retains an empty side-effect import, whereas `import type` disappears.
    const emitted = ts.transpileModule(source, { compilerOptions: parsed.options, fileName: file }).outputText;
    const runtimeReferences = new Set(moduleReferences(ts.createSourceFile(file + ".js", emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)));
    for (const reference of moduleReferences(sourceFile)) {
      if (reference === null) {
        errors.push(`${name(file)}: 動的importの参照先は文字列リテラルで指定し、依存検査で解決できるようにしてください。`);
        continue;
      }
      const target = ts.resolveModuleName(reference, file, parsed.options, ts.sys).resolvedModule?.resolvedFileName;
      if (name(file).startsWith("src/core/") && (!target || !name(target).startsWith("src/core/"))) {
        errors.push(`${name(file)}: coreの依存はcore内に限定します: ${reference}`);
      }
      const sourceLayer = layer(name(file));
      const targetLayer = target ? layer(name(target)) : undefined;
      if (sourceLayer && allowedLayers[sourceLayer]
        && ((target && name(target).startsWith("src/")) || sourceLayer === "contracts")
        && !allowedLayers[sourceLayer].has(targetLayer)) {
        errors.push(`${name(file)}: ${sourceLayer}から${targetLayer ?? reference}への依存は禁止されています: ${reference}`);
      }
      if (name(file).startsWith("src/extension/content/") && runtimeReferences.has(reference)) {
        errors.push(`${name(file)}: ページへ渡す関数は実行時importを持てません: ${reference}`);
      }
      if (target && known.has(target) && runtimeReferences.has(reference)) graph.get(file).push(target);
    }
  }

  const active = new Set(), complete = new Set(), stack = [];
  function visit(file) {
    if (active.has(file)) {
      errors.push(`実行時importが循環しています: ${[...stack.slice(stack.indexOf(file)), file].map(name).join(" -> ")}`);
      return;
    }
    if (complete.has(file)) return;
    active.add(file); stack.push(file);
    for (const target of graph.get(file)) visit(target);
    stack.pop(); active.delete(file); complete.add(file);
  }
  for (const file of files) visit(file);

  const workerEntries = files.filter((file) => /^src\/extension\/workers\/[^/]+-worker\.ts$/.test(name(file)));
  const seen = new Set();
  function visitWorker(file) {
    if (seen.has(file)) return;
    seen.add(file);
    if (/^src\/extension\/(?:panel|browser|content)\//.test(name(file))) {
      errors.push(`${name(file)}: Workerから画面・Chrome操作・ページ内処理へ依存できません。`);
    }
    for (const target of graph.get(file) ?? []) visitWorker(target);
  }
  for (const file of workerEntries) visitWorker(file);

  // A separate compilation environment catches indirect DOM dependencies and
  // property access (globalThis.document included), without banning Blob/URL/etc.
  const isolatedOptions = {
    ...parsed.options,
    lib: ["lib.es2022.d.ts", "lib.webworker.d.ts", "lib.webworker.iterable.d.ts"],
    types: [], noEmit: true, skipLibCheck: true,
  };
  const coreFiles = files.filter((file) => name(file).startsWith("src/core/"));
  const vendorDeclarations = parsed.fileNames.filter((file) => name(file) === "src/extension/vendor-modules.d.ts");
  for (const [label, roots] of [["core", coreFiles], ["Worker", workerEntries.length ? [...workerEntries, ...vendorDeclarations] : []]]) {
    if (!roots.length) continue;
    const program = ts.createProgram(roots, isolatedOptions);
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
      const location = diagnostic.file && diagnostic.start !== undefined
        ? `${name(diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}` : label;
      errors.push(`${location}: ${label}の画面非依存検査 TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    }
  }
  return [...new Set(errors)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkArchitecture();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("architecture ok: core/Workerの画面非依存、ページ関数のimport、依存方向、実行時循環");
  }
}
