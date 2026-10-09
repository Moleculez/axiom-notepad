import ts from "typescript";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import english from "../../packages/i18n/src/messages/en.json";
const messages: Record<string, string> = { ...english };
const attributes = new Set([
  "aria-label",
  "aria-description",
  "title",
  "placeholder",
  "data-tooltip",
]);
const display = new Set([
  "label",
  "hint",
  "description",
  "help",
  "confirmLabel",
  "cancelLabel",
  "placeholder",
]);
const ui = (text: string) =>
  /[A-Za-z]{2}/.test(text) &&
  text.length < 700 &&
  !/^(?:https?:|\/|@|var\(|[a-z]+\/)/.test(text);
async function walk(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(file);
      continue;
    }
    if (
      !/\.tsx?$/.test(file) ||
      /(?:samples|fixtures|documentation|i18n)/i.test(file)
    )
      continue;
    const source = await readFile(file, "utf8"),
      document = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
    const edits: { start: number; end: number; value: string }[] = [];
    const imports = new Set<string>();
    const imperative =
      /(?:editor-vnext|native-editor|\/context-menu\.ts|\/icons\/actions\.ts|\/editor-links\.ts|\/footnote-tooltips\.ts)/.test(
        file,
      );
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        display.has(node.name.getText(document).replace(/^"|"$/g, "")) &&
        ts.isStringLiteral(node.initializer) &&
        ui(node.initializer.text)
      )
        messages[node.initializer.text] = node.initializer.text;
      if (
        imperative &&
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        ts.isStringLiteral(node.right) &&
        ui(node.right.text)
      ) {
        const property = node.left.name.text;
        if (["textContent", "title", "placeholder"].includes(property)) {
          messages[node.right.text] = node.right.text;
          const helper =
            property === "textContent" ? "bindText" : "bindAttribute";
          imports.add(helper);
          edits.push({
            start: node.getStart(document),
            end: node.end,
            value: `${helper}(${node.left.expression.getText(document)}, ${property === "textContent" ? "" : JSON.stringify(property) + ", "}${JSON.stringify(node.right.text)})`,
          });
        }
      } else if (
        imperative &&
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "setAttribute" &&
        node.arguments.length === 2 &&
        ts.isStringLiteral(node.arguments[0]) &&
        attributes.has(node.arguments[0].text) &&
        ts.isStringLiteral(node.arguments[1]) &&
        ui(node.arguments[1].text)
      ) {
        const value = node.arguments[1].text;
        messages[value] = value;
        imports.add("bindAttribute");
        edits.push({
          start: node.getStart(document),
          end: node.end,
          value: `bindAttribute(${node.expression.expression.getText(document)}, ${JSON.stringify(node.arguments[0].text)}, ${JSON.stringify(value)})`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(document);
    if (edits.length) {
      let output = source;
      for (const edit of edits.sort((a, b) => b.start - a.start))
        output =
          output.slice(0, edit.start) + edit.value + output.slice(edit.end);
      await writeFile(
        file,
        `import { ${[...imports].join(", ")} } from "@axiom/i18n/dom";\n${output}`,
      );
    }
  }
}
await walk("apps/web/components");
await walk("apps/web/lib/editor-vnext");
await walk("apps/web/lib/native-editor");
await walk("apps/showcase/src");
for (const file of [
  "apps/web/lib/settings-registry.ts",
  "packages/shared/src/editor.ts",
  "packages/shared/src/appearance.ts",
  "packages/shared/src/interface-styles.ts",
  "apps/web/lib/context-menu.ts",
  "apps/web/lib/icons/actions.ts",
]) {
  try {
    const source = await readFile(file, "utf8"),
      document = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAssignment(node) &&
        display.has(node.name.getText(document)) &&
        ts.isStringLiteral(node.initializer) &&
        ui(node.initializer.text)
      )
        messages[node.initializer.text] = node.initializer.text;
      ts.forEachChild(node, visit);
    };
    visit(document);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
await writeFile(
  "packages/i18n/src/messages/en.json",
  JSON.stringify(
    Object.fromEntries(
      Object.entries(messages).sort(([a], [b]) => a.localeCompare(b)),
    ),
    null,
    2,
  ) + "\n",
);
console.log(
  `${Object.keys(messages).length} UI messages including registries and explicit imperative controls.`,
);
