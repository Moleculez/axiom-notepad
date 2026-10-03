import ts from "typescript";

export type UiDiagnostic = { file: string; line: number; message: string };
/** This implementation necessarily owns native controls, not a page exception. */
export const nativeControlOwner = "apps/web/components/ui/controls.tsx";

function strings(node: ts.Node | undefined): string[] {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  const values: string[] = [];
  ts.forEachChild(node, (child) => {
    values.push(...strings(child));
  });
  return values;
}
function attribute(node: ts.JsxOpeningLikeElement, name: string) {
  return node.attributes.properties.find(
    (value): value is ts.JsxAttribute =>
      ts.isJsxAttribute(value) && value.name.getText() === name,
  );
}
const hasClass = (node: ts.JsxOpeningLikeElement, name: string) =>
  strings(attribute(node, "className")?.initializer).some((value) =>
    value.split(/\s+/).includes(name),
  );

/** AST checks avoid comments, quoted examples and accidental substring matches.
 * Document-engine DOM is intentionally outside the application JSX boundary. */
export function validateUiSource(file: string, source: string): UiDiagnostic[] {
  if (file === nativeControlOwner) return [];
  const tree = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
    diagnostics: UiDiagnostic[] = [],
    icons = new Set<string>();
  for (const statement of tree.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "lucide-react" &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    )
      for (const specifier of statement.importClause.namedBindings.elements)
        icons.add(specifier.name.text);
  }
  const report = (node: ts.Node, message: string) =>
    diagnostics.push({
      file,
      line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
      message,
    });
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(tree) !== "InputGroup"
    ) {
      const children = node.children
        .filter(
          (child) =>
            ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
        )
        .map((child) =>
          ts.isJsxElement(child) ? child.openingElement : child,
        );
      if (
        children.some((child) => icons.has(child.tagName.getText(tree))) &&
        children.some(
          (child) =>
            ["TextInput", "SearchField"].includes(
              child.tagName.getText(tree),
            ) && !attribute(child, "data-editor-field"),
        )
      )
        report(
          node.openingElement,
          "Use SearchField or InputGroup for field icons; use Field.icon for label icons. Do not draw an adjacent icon/input box.",
        );
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree);
      const editorField = attribute(node, "data-editor-field");
      const nativeType = strings(attribute(node, "type")?.initializer);
      if (
        !editorField &&
        (tag === "textarea" ||
          tag === "select" ||
          (tag === "input" &&
            !nativeType.some((type) =>
              [
                "checkbox",
                "range",
                "radio",
                "file",
                "color",
                "hidden",
              ].includes(type),
            )))
      )
        report(
          node,
          "Use TextInput, TextArea, NativeSelect, SearchField or Picker from components/ui/controls; document fields must explicitly opt out.",
        );
      if (
        tag === "input" &&
        strings(attribute(node, "type")?.initializer).some((value) =>
          ["checkbox", "range"].includes(value),
        )
      )
        report(
          node,
          "Use Checkbox/Switch or Slider from components/ui/controls; preserve native handlers and labels.",
        );
      if (hasClass(node, "ws-note"))
        report(
          node,
          "Use HelpText for routine guidance or Notice for a consequential message; do not add padded hint cards.",
        );
      if (tag === "div" && hasClass(node, "ws-actions"))
        report(node, "Use ActionRow for application action groups.");
      if (
        tag === "button" &&
        ["button", "icon-button", "ui-button", "ui-icon-button"].some((name) =>
          hasClass(node, name),
        )
      )
        report(
          node,
          "Use Button/IconButton for application actions; specialized tabs and menus keep their semantic controls.",
        );
      if (
        tag === "Checkbox" &&
        strings(attribute(node, "role")?.initializer).includes("switch")
      )
        report(
          node,
          "Use Switch for a persistent binary preference; use Checkbox for selection or consent.",
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return diagnostics;
}
