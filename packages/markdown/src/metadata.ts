import type { MarkdownNode } from "./types";

export type MetadataProperty = {
  key: string;
  value: string;
  keyFrom: number;
  keyTo: number;
  valueFrom: number;
  valueTo: number;
  from: number;
  to: number;
  complex: boolean;
};

/** Passive, lossless top-level property ranges. This is deliberately not a
 * YAML evaluator. Nested YAML, comments and unknown constructs stay verbatim. */
export function metadataModel(source: string, node: MarkdownNode) {
  if (node.type !== "frontmatter") return null;
  const lines = Array.from(
    source.slice(node.from, node.to).matchAll(/([^\r\n]*)(\r?\n|$)/g),
  )
    .filter((match) => match[0].length)
    .map((match) => ({
      text: match[1],
      from: node.from + match.index!,
      to: node.from + match.index! + match[1].length,
      end: node.from + match.index! + match[0].length,
    }));
  let closing = -1;
  for (let i = 1; i < lines.length; i++)
    if (/^(?:---|\.\.\.)\s*$/.test(lines[i].text)) closing = i;
  if (closing < 0) return null;
  const properties: MetadataProperty[] = [];
  for (let i = 1; i < closing; i++) {
    const line = lines[i],
      match = /^([\w.-]+)([ \t]*:[ \t]*)(.*)$/.exec(line.text);
    if (!match) continue;
    let last = i;
    while (last + 1 < closing && /^[ \t]+\S/.test(lines[last + 1].text)) last++;
    const valueFrom = line.from + match[1].length + match[2].length;
    properties.push({
      key: match[1],
      value: source.slice(valueFrom, lines[last].to),
      keyFrom: line.from,
      keyTo: line.from + match[1].length,
      valueFrom,
      valueTo: lines[last].to,
      from: line.from,
      to: lines[last].end,
      complex: last > i || /^[|>][+\d-]*\s*(?:#.*)?$/.test(match[3]),
    });
    i = last;
  }
  return {
    properties,
    closing: lines[closing].from,
    ending: source.includes("\r\n") ? "\r\n" : "\n",
  };
}
