import { nodeAt, slashQuery, type RenderContext } from "@axiom/markdown";
import type { ActionIconName } from "../icons/actions";
import { mathSymbols, mathSymbolFields } from "@axiom/editor/math-symbols";
import {
  editorCommands,
  type EditorCommandId,
  type EditorPreferences,
} from "@axiom/shared/editor";

export type NativeCompletion = {
  label: string;
  icon?: ActionIconName;
  mathSymbol?: string;
  from: number;
  to: number;
  value?: string;
  command?: EditorCommandId;
  select?: [number, number];
  fields?: [number, number][];
};
export function nativeCompletions(
  source: string,
  position: number,
  preferences: EditorPreferences,
  context: RenderContext,
  notes: { id: string; title: string }[],
): NativeCompletion[] {
  const slash = preferences.slashCommands && slashQuery(source, position);
  if (slash)
    return editorCommands
      .filter(
        (c) =>
          c.insert &&
          (c.label + " " + c.keywords)
            .toLowerCase()
            .includes(slash.query.toLowerCase()),
      )
      .slice(0, 12)
      .map((c) => ({
        label: c.label,
        command: c.id,
        from: slash.from,
        to: slash.to,
      }));
  if (nodeAt(source, position, ["codeBlock", "code"])) return [];
  const before = source.slice(Math.max(0, position - 160), position);
  const math = nodeAt(source, position, ["mathBlock", "mathInline"]),
    match = /\\([A-Za-z]*)$/.exec(before);
  if (math && match && preferences.mathCompletion)
    return mathSymbols
      .filter((item) => item.id.startsWith(match[1]))
      .slice(0, 12)
      .map((symbol) => {
        const fields = mathSymbolFields(symbol);
        return {
          label: "\\" + symbol.id,
          icon: "math",
          mathSymbol: symbol.id,
          value: symbol.insert,
          from: position - match[0].length,
          to: position,
          ...(fields.length ? { select: fields[0], fields } : {}),
        };
      });
  const wiki = /\[\[([^\]\n]*)$/.exec(before),
    citation = /\[@([\w:./-]*)$/.exec(before),
    reference = /\\eqref\{([^}\n]*)$/.exec(before);
  const query = wiki ?? citation ?? reference;
  if (!query) return [];
  const close = wiki ? "]]" : reference ? "}" : "]";
  const candidates = wiki
    ? notes.map((n) => ({
        label: n.title,
        value: n.id + "|" + n.title.replace(/[\[\]|]/g, ""),
      }))
    : reference
      ? Array.from(source.matchAll(/\\label\{([^}]+)\}/g), (m) => ({
          label: m[1],
          value: m[1],
        }))
      : Object.entries(context.references ?? {}).map(([key, reference]) => ({
          label: key + " · " + reference.title,
          value: key,
        }));
  return candidates
    .filter((item) => item.label.toLowerCase().includes(query[1].toLowerCase()))
    .slice(0, 12)
    .map((item) => ({
      label: item.label,
      icon: wiki ? "note" : citation ? "citation" : "equationRef",
      value: item.value + close,
      from: position - query[1].length,
      to:
        position +
        (source.slice(position, position + close.length) === close
          ? close.length
          : 0),
    }));
}
