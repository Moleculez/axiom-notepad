import ts from "typescript";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

export type UiDiagnostic = { file: string; line: number; message: string };
/** This implementation necessarily owns native controls, not a page exception. */
export const nativeControlOwner = "apps/web/components/ui/controls.tsx";
const controlStylesOwner = "apps/web/app/ui-controls.css";
const interfaceStylesOwner = "apps/web/app/interface-styles.css";

/** Narrow cascade guard, not a complete visual audit. Page layout may place
 * controls; their common drawing, typography and size have one native owner. */
export function validateUiStyles(file: string, source: string): UiDiagnostic[] {
  if ([controlStylesOwner, interfaceStylesOwner].includes(file)) return [];
  const errors: UiDiagnostic[] = [];
  const common = new Set([
    "button",
    "icon-button",
    "ui-button",
    "ui-icon-button",
  ]);
  const shells = new Set(["ws-app", "dialog", "showcase-app"]);
  const drawing =
    /^(?:display|align-items|justify-content|gap|(?:min-|max-)?(?:height|block-size)|padding(?:-.+)?|font(?:-.+)?|line-height|letter-spacing|white-space|overflow-wrap|border(?:-.+)?|background(?:-.+)?|box-shadow)$/;
  try {
    postcss.parse(source).walkRules((rule) => {
      // The explicitly layered legacy foundation predates shared controls and
      // loses to the canonical unlayered owner. Do not grant page exemptions.
      let ancestor: postcss.Node | undefined = rule.parent;
      let forcedColors = false;
      while (ancestor) {
        if (ancestor.type === "atrule") {
          const atRule = ancestor as postcss.AtRule;
          if (atRule.name === "layer" && atRule.params === "legacy") return;
          if (
            atRule.name === "media" &&
            /forced-colors\s*:/.test(atRule.params)
          )
            forcedColors = true;
        }
        ancestor = ancestor.parent;
      }
      selectorParser((selectors) =>
        selectors.each((selector) => {
          let lastCombinator = -1;
          selector.nodes.forEach((node, index) => {
            if (node.type === "combinator") lastCombinator = index;
          });
          const targetNodes = selector.nodes.slice(lastCombinator + 1);
          if (
            targetNodes.some(
              (node) => node.type === "pseudo" && node.value.startsWith("::"),
            )
          )
            return;
          const target = selectorParser().astSync(
            targetNodes.map((node) => node.toString()).join(""),
          );
          let action = false;
          let sharedAction = false;
          const excluded = (node: selectorParser.Node) => {
            let parent = node.parent;
            while (parent) {
              if (parent.type === "pseudo" && parent.value === ":not")
                return true;
              parent = parent.parent;
            }
            return false;
          };
          const scopes = new Set<string>();
          const variants = new Set([
            "primary",
            "secondary",
            "ghost",
            "danger",
            "small",
            "active",
            "selected",
            "is-selected",
          ]);
          target.walkClasses((node) => {
            if (excluded(node)) return;
            if (common.has(node.value)) action = sharedAction = true;
            else if (!variants.has(node.value)) scopes.add(node.value);
          });
          // Generic raw button resets also affect specialized application controls.
          target.walkTags((node) => {
            if (node.value === "button" && !excluded(node)) action = true;
          });
          if (!action) return;
          for (const node of selector.nodes.slice(0, lastCombinator)) {
            const scope = selectorParser().astSync(node.toString());
            scope.walkClasses((entry) => {
              if (!shells.has(entry.value)) scopes.add(entry.value);
            });
          }
          const broad =
            scopes.size === 0 ||
            selector.nodes.slice(0, lastCombinator).some((node) => {
              if (
                node.type !== "pseudo" ||
                ![":is", ":where"].includes(node.value)
              )
                return false;
              const alternatives = new Set<string>();
              node.walkClasses((entry) => {
                alternatives.add(entry.value);
              });
              return alternatives.size > 1;
            });
          const functionalFocus = /:focus(?:-visible|-within)?/.test(
            selector.toString(),
          );
          rule.walkDecls((declaration) => {
            if (!drawing.test(declaration.prop)) return;
            if (
              (functionalFocus || forcedColors) &&
              /^(?:border|background|box-shadow)/.test(declaration.prop)
            )
              return;
            const fixedText =
              sharedAction &&
              /^(?:font|font-size)$/.test(declaration.prop) &&
              /\b\d+(?:\.\d+)?px\b/.test(declaration.value);
            if (!broad && !fixedText) return;
            errors.push({
              file,
              line: declaration.source?.start?.line ?? 1,
              message: `Shared action ${declaration.prop} must use ui-controls.css and semantic control tokens, not a general/page-fixed reset (${selector.toString()}).`,
            });
          });
        }),
      ).processSync(rule.selector);
    });
  } catch (error) {
    errors.push({
      file,
      line: 1,
      message: `Cannot inspect UI stylesheet: ${(error as Error).message}`,
    });
  }
  return errors;
}

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
