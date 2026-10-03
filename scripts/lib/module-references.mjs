import ts from "typescript";

// Keep resources separate: a Worker URL must exist in the distribution, but
// is not an in-process import edge for layer or cycle checks.
export function moduleReferences(sourceFile) {
  const references = [];
  const add = (kind, node) => references.push({kind, specifier: node && ts.isStringLiteralLike(node) ? node.text : null});
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      add("module", node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add("dynamic", node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add("type", node.argument.literal);
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL"
      && node.arguments?.length === 2
      && ts.isPropertyAccessExpression(node.arguments[1]) && node.arguments[1].name.text === "url"
      && ts.isMetaProperty(node.arguments[1].expression)
      && node.arguments[1].expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
      add("resource", node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return references;
}
