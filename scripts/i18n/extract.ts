/** Explicit AST migration, not a runtime DOM translator. Review its diff. */
import ts from "typescript";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import english from "../../packages/i18n/src/messages/en.json";
import { decodeHTML } from "entities";
const write = process.argv.includes("--write");
const messages: Record<string, string> = { ...english };
const occurrences = new Map<string, Set<string>>();
const props = new Set([
  "aria-label",
  "title",
  "subtitle",
  "label",
  "placeholder",
  "hint",
  "description",
  "confirmLabel",
  "cancelLabel",
  "clearLabel",
  "emptyLabel",
  "loadingLabel",
]);
const excluded =
  /(?:ReadingView|MathRendering|LocaleProvider|LanguageField|LanguageSettings|\/samples|\/Tour|\/fixture|\/laboratory)/;
const prose = (value: string) =>
  /[A-Za-z]{2}/.test(value) &&
  !/^(?:https?:|\\|`|\/|#|@|var\(|[a-z]+\/|[A-Za-z]+\.[a-z]+$)/.test(value) &&
  !/[\n\r]/.test(value) &&
  value.length < 700;
function jsxText(value: string) {
  // React's JSX whitespace rules: trim line indentation, not intentional spaces.
  const lines = value.replace(/\r/g, "").split("\n");
  return lines
    .map((line, i) => {
      let normalized = line.replace(/\t/g, " ");
      if (i) normalized = normalized.replace(/^ +/, "");
      if (i < lines.length - 1) normalized = normalized.replace(/ +$/, "");
      return normalized;
    })
    .filter(Boolean)
    .join(" ");
}
async function walk(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(file);
      continue;
    }
    if (!file.endsWith(".tsx") || excluded.test(file)) continue;
    const source = await readFile(file, "utf8");
    const document = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const edits: { start: number; end: number; value: string }[] = [];
    let usesMessages = false,
      usesLabels = false;
    const subscriptions: number[] = [];
    const add = (value: string) => {
      messages[value] = value;
      const seen = occurrences.get(value) ?? new Set<string>();
      seen.add(file);
      occurrences.set(value, seen);
    };
    function visit(node: ts.Node) {
      if (
        ts.isJsxElement(node) &&
        /^(?:code|pre)$/.test(node.openingElement.tagName.getText(document))
      )
        return;
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node)
      ) {
        const name =
          (!ts.isArrowFunction(node)
            ? node.name?.getText(document)
            : undefined) ??
          (ts.isVariableDeclaration(node.parent)
            ? node.parent.name.getText(document)
            : "");
        if (
          /^[A-Z][\w]*$/.test(name) &&
          node.body &&
          ts.isBlock(node.body) &&
          !/useInterfaceLocale\(\)/.test(
            source.slice(
              node.body.getStart(document),
              node.body.getStart(document) + 80,
            ),
          )
        )
          subscriptions.push(node.body.getStart(document) + 1);
      }
      if (ts.isJsxText(node)) {
        const value = decodeHTML(jsxText(node.text));
        if (prose(value.trim())) {
          const id = value.trim();
          add(id);
          usesMessages = true;
          edits.push({
            start: node.getStart(document),
            end: node.end,
            value: `${value.startsWith(" ") ? '{" "}' : ""}<I18nText id=${JSON.stringify(id)} />${value.endsWith(" ") ? '{" "}' : ""}`,
          });
        }
      } else if (
        ts.isJsxAttribute(node) &&
        props.has(node.name.getText(document)) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        prose(node.initializer.text)
      ) {
        const value = node.initializer.text;
        add(value);
        usesLabels = true;
        edits.push({
          start: node.initializer.getStart(document),
          end: node.initializer.end,
          value: `{uiText(${JSON.stringify(value)})}`,
        });
      } else if (ts.isJsxExpression(node) && node.expression) {
        // Only literals used as displayed content/attributes, never state/IDs.
        const expression = node.expression;
        const attr = ts.isJsxAttribute(node.parent)
          ? node.parent.name.getText(document)
          : null;
        if (attr && !props.has(attr)) return;
        const branch = (candidate: ts.Expression) => {
          if (ts.isStringLiteral(candidate) && prose(candidate.text)) {
            add(candidate.text);
            usesLabels = true;
            edits.push({
              start: candidate.getStart(document),
              end: candidate.end,
              value: `uiText(${JSON.stringify(candidate.text)})`,
            });
          }
        };
        if (ts.isConditionalExpression(expression)) {
          branch(expression.whenTrue);
          branch(expression.whenFalse);
        } else branch(expression);
        if (ts.isStringLiteral(expression)) return;
      }
      ts.forEachChild(node, visit);
    }
    visit(document);
    if (write && edits.length) {
      if (usesLabels)
        for (const start of subscriptions)
          edits.push({ start, end: start, value: "\n  useInterfaceLocale();" });
      let output = source;
      for (const edit of edits.sort((a, b) => b.start - a.start))
        output =
          output.slice(0, edit.start) + edit.value + output.slice(edit.end);
      // Message subscribes itself; attributes subscribe through a zero-DOM boundary
      // installed in each functional component separately in the next migration.
      const existing =
        source
          .match(/import \{ ([^\n]*) \} from "@axiom\/i18n\/react";/)?.[1]
          .split(", ") ?? [];
      const imports = [
        usesMessages && !existing.includes("I18nText") && "I18nText",
        usesLabels && !existing.includes("uiText") && "uiText",
        usesLabels &&
          subscriptions.length &&
          !existing.includes("useInterfaceLocale") &&
          "useInterfaceLocale",
      ]
        .filter(Boolean)
        .join(", ");
      const offset = source.startsWith('"use client";')
        ? '"use client";'.length
        : 0;
      if (imports)
        output =
          output.slice(0, offset) +
          `\nimport { ${imports} } from "@axiom/i18n/react";\n` +
          output.slice(offset);
      await writeFile(file, output);
    }
  }
}
await walk("apps/web/components");
await walk("apps/showcase/src");
const ids = Object.keys(messages).sort();
await mkdir("data/i18n", { recursive: true });
await writeFile(
  "data/i18n/inventory.json",
  JSON.stringify(
    Object.fromEntries(ids.map((id) => [id, [...(occurrences.get(id) ?? [])]])),
    null,
    2,
  ) + "\n",
);
if (write)
  await writeFile(
    "packages/i18n/src/messages/en.json",
    JSON.stringify(
      Object.fromEntries(ids.map((id) => [id, messages[id]])),
      null,
      2,
    ) + "\n",
  );
console.log(
  `${ids.length} whole UI messages, ${occurrences.size} displayed literals. ${write ? "Migrated" : "Inventory only"}; report: data/i18n/inventory.json`,
);
