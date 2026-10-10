import ts from "typescript";
import { englishMessages } from "../../packages/i18n/src/index";

export type I18nUiDiagnostic = { file: string; line: number; message: string };

/** A narrow registry gate, not proof that every UI surface is translated.
 * Inspect actual imports so an unrelated `label` function is never mistaken
 * for the compatibility adapter. Dynamic registries need typed contracts. */
export function validateI18nUiSource(file: string, source: string) {
  const document = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const calls = new Map<string, number>();
  const elements = new Set<string>();
  const errors: I18nUiDiagnostic[] = [];
  for (const node of document.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      !["@axiom/i18n/react", "@axiom/i18n/client", "@axiom/i18n/dom"].includes(
        node.moduleSpecifier.text,
      )
    )
      continue;
    const imports = node.importClause?.namedBindings;
    if (!imports || !ts.isNamedImports(imports)) continue;
    for (const entry of imports.elements) {
      const original = entry.propertyName?.text ?? entry.name.text;
      if (["uiText", "label", "t"].includes(original))
        calls.set(entry.name.text, 0);
      if (original === "bindText") calls.set(entry.name.text, 1);
      if (original === "bindAttribute") calls.set(entry.name.text, 2);
      if (["Message", "I18nText"].includes(original))
        elements.add(entry.name.text);
    }
  }
  const check = (expression: ts.Expression) => {
    if (ts.isConditionalExpression(expression)) {
      check(expression.whenTrue);
      check(expression.whenFalse);
    } else if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression)
    ) {
      check(expression.expression);
    } else if (
      ts.isStringLiteralLike(expression) &&
      /\p{L}/u.test(expression.text) &&
      !Object.hasOwn(englishMessages, expression.text)
    )
      errors.push({
        file,
        line:
          document.getLineAndCharacterOfPosition(expression.getStart()).line +
          1,
        message: `Unregistered interface message: ${expression.text}`,
      });
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const index = calls.get(node.expression.text);
      if (index !== undefined && node.arguments[index])
        check(node.arguments[index]);
    }
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      elements.has(node.tagName.getText())
    )
      for (const prop of node.attributes.properties)
        if (
          ts.isJsxAttribute(prop) &&
          prop.name.getText() === "id" &&
          prop.initializer
        ) {
          if (ts.isStringLiteral(prop.initializer)) check(prop.initializer);
          else if (
            ts.isJsxExpression(prop.initializer) &&
            prop.initializer.expression
          )
            check(prop.initializer.expression);
        }
    ts.forEachChild(node, visit);
  };
  visit(document);
  return errors;
}
