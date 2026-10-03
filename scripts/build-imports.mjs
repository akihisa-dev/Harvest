import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import ts from "typescript";
import {moduleReferences} from "./lib/module-references.mjs";
import { dirname, relative, resolve } from "node:path";

export function findModuleSpecifiers(source, fileName) {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  return moduleReferences(sourceFile)
    .filter(reference => reference.kind !== "type" && reference.specifier !== null)
    .map(reference => reference.specifier);
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
