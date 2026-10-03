import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import ts from "typescript";
import { dirname, relative, resolve } from "node:path";

export function findModuleSpecifiers(source, fileName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const specifiers = [];

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])) {
      specifiers.push(node.arguments[0].text);
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL"
      && node.arguments?.length === 2 && ts.isStringLiteralLike(node.arguments[0])
      && ts.isPropertyAccessExpression(node.arguments[1]) && node.arguments[1].name.text === "url"
      && ts.isMetaProperty(node.arguments[1].expression)
      && node.arguments[1].expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
      // Worker entry points and local resources are not import declarations.
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

export async function checkRelativeImports(runtimeFiles, outputRoot) {
  for (const importer of runtimeFiles) {
    const source = await readFile(importer, "utf8");
    for (const specifier of findModuleSpecifiers(source, importer)) {
      if (!specifier.startsWith(".")) continue;
      const target = resolve(dirname(importer), specifier);
      const withinOutput = relative(outputRoot, target);
      assert.ok(withinOutput && !withinOutput.startsWith(".."), `${relative(outputRoot, importer)}のimportが配布物の外を参照しています: ${specifier}`);
      await access(target).catch(() => {
        assert.fail(`${relative(outputRoot, importer)}のimport先が配布物にありません: ${specifier}`);
      });
    }
  }
}
