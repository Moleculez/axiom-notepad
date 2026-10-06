import type { TextChange } from "../../markdown/src/types";
import { applyChanges } from "../../editor/src/transactions";
import { projectMindmap } from "./projection";
import type { MindmapEdit, MindmapNode, MindmapProjection } from "./types";

const newline = (source: string) => (source.includes("\r\n") ? "\r\n" : "\n");
const afterLine = (source: string, at: number) =>
  source[at] === "\r" && source[at + 1] === "\n"
    ? at + 2
    : source[at] === "\n"
      ? at + 1
      : at;
const lineStart = (source: string, at: number) =>
  Math.max(
    source.startsWith("\ufeff") ? 1 : 0,
    source.lastIndexOf("\n", Math.max(-1, at - 1)) + 1,
  );
export type MindmapCommand =
  "rename" | "sibling" | "child" | "delete" | "toggleTask";

export function mindmapCommand(
  source: string,
  node: MindmapNode,
  command: MindmapCommand,
  value = "",
): MindmapEdit {
  if (
    (node.kind !== "root" || node.level) &&
    source.slice(node.labelFrom, node.labelTo) !== node.labelSource
  )
    throw new Error("This branch changed. Select it again before editing.");
  const ending = newline(source);
  if (command === "rename") {
    if (
      !["heading", "item", "root"].includes(node.kind) ||
      (node.kind === "root" && !node.level)
    )
      throw new Error(
        "Edit this block in Source; a synthetic root uses the file name.",
      );
    if (/[\r\n]/.test(value))
      throw new Error(
        "Node labels stay on one line. Use Source to edit multiline content.",
      );
    const label = value.replace(/\u0000/g, "");
    const change = { from: node.labelFrom, to: node.labelTo, insert: label };
    const before = projectMindmap(source),
      after = projectMindmap(applyChanges(source, [change]));
    const shape = (projection: MindmapProjection) => {
      const indices = new Map(projection.nodes.map((n, i) => [n.id, i]));
      return JSON.stringify({
        nodes: projection.nodes.map((n) => [
          n.kind,
          n.blockType,
          n.level,
          n.checked,
          n.parentId === null ? null : indices.get(n.parentId),
        ]),
        supporting: projection.supporting.map((n) => n.type),
      });
    };
    if (shape(before) !== shape(after))
      throw new Error(
        "This label would change Markdown block structure. Keep labels inline or edit the structure explicitly in Source.",
      );
    return {
      changes: [change],
      selection: {
        anchor: node.labelFrom + label.length,
        head: node.labelFrom + label.length,
      },
    };
  }
  if (command === "toggleTask") {
    if (!node.item?.task) throw new Error("This node is not a task item.");
    const offset = node.labelFrom - node.item.task.length + 1;
    return {
      changes: [
        { from: offset, to: offset + 1, insert: node.checked ? " " : "x" },
      ],
    };
  }
  if (command === "delete") {
    if (node.kind === "root")
      throw new Error(
        "The root cannot be deleted. Use the file's Trash action.",
      );
    const from = lineStart(source, node.from),
      to = afterLine(source, node.branchTo);
    return {
      changes: [{ from, to, insert: "" }],
      selection: { anchor: from, head: from },
    };
  }
  if (node.scope !== "document")
    throw new Error(
      "Add branches inside quotations or other containers in Source.",
    );
  if (node.kind === "root" && command === "sibling")
    throw new Error("The root has no sibling. Add a child branch instead.");
  let marker = "- ",
    prefix = "",
    at = node.branchTo;
  if (node.kind === "item" && node.item) {
    if (node.item.prefix.includes("\t"))
      throw new Error(
        "Edit tab-indented lists in Source to preserve their structure.",
      );
    prefix =
      node.item.prefix +
      (command === "child" ? " ".repeat(node.item.width) : "");
    marker = node.item.ordered
      ? node.item.marker.replace(/^\d+/, (n) =>
          String(Number(n) + (command === "sibling" ? 1 : 0)),
        )
      : node.item.marker;
    if (command === "child") marker = "- ";
    if (node.checked !== undefined) marker += "[ ] ";
  } else if (node.kind === "root" && command === "child") {
    const projection = projectMindmap(source);
    if (node.level || projection.nodes.some((n) => n.kind === "heading"))
      marker = "#".repeat(node.level ? node.level + 1 : 1) + " ";
  } else if ((node.kind === "heading" || node.level) && command === "sibling")
    marker = "#".repeat(node.level!) + " ";
  else if (node.kind === "heading" && command === "child") {
    if (node.level! >= 6)
      throw new Error(
        "A heading below H6 cannot be added without conversion. Add a list in Source instead.",
      );
    marker = "#".repeat(node.level! + 1) + " ";
  } else if (node.kind !== "root")
    throw new Error(
      "Add heading or list branches from a heading, list item or root.",
    );
  at = afterLine(source, at);
  const preceding = at > 0 && source[at - 1] !== "\n" ? ending : "";
  const boundary =
    node.kind === "item"
      ? ""
      : at && !source.slice(0, at).endsWith(ending + ending)
        ? ending
        : "";
  const insert =
    preceding +
    boundary +
    prefix +
    marker +
    ending +
    (node.kind === "item" ? "" : ending);
  const caret =
    at + preceding.length + boundary.length + prefix.length + marker.length;
  return {
    changes: [{ from: at, to: at, insert }],
    selection: { anchor: caret, head: caret },
  };
}

export function moveMindmapBranch(
  source: string,
  projection: MindmapProjection,
  id: string,
  targetId: string,
  placement: "before" | "after" | "child",
): MindmapEdit {
  const byId = new Map(projection.nodes.map((n) => [n.id, n])),
    node = byId.get(id),
    target = byId.get(targetId);
  if (!node || !target || node.kind === "root" || node === target)
    throw new Error("Choose another branch as the move target.");
  if (target.from >= node.from && target.from < node.branchTo)
    throw new Error("A branch cannot move into its own descendants.");
  if (node.scope !== "document" || target.scope !== "document")
    throw new Error("Container boundaries must be edited in Source.");
  const isHeading = node.kind === "heading";
  if (
    isHeading
      ? target.kind !== "heading" &&
        !(placement === "child" && target.kind === "root")
      : node.kind !== "item" ||
        !node.item ||
        target.kind !== "item" ||
        !target.item ||
        node.item.ordered !== target.item.ordered
  )
    throw new Error(
      "This move would convert heading/list structure. Edit it explicitly in Source instead.",
    );
  const from = lineStart(source, node.from),
    to = afterLine(source, node.branchTo);
  let fragment = source.slice(from, to);
  if (isHeading) {
    const level =
        target.kind === "root"
          ? 2
          : target.level! + (placement === "child" ? 1 : 0),
      delta = level - node.level!;
    const changes: TextChange[] = [];
    for (const descendant of projection.nodes.filter(
      (n) =>
        n.from >= node.from &&
        n.from < node.branchTo &&
        n.kind === "heading" &&
        n.scope === node.scope,
    )) {
      const shifted = descendant.level! + delta;
      if (shifted < 1 || shifted > 6)
        throw new Error(
          "This move exceeds H1–H6 and would require conversion.",
        );
      const line = source.slice(descendant.from, descendant.to),
        match = /^(\s*)(#{1,6})(?=\s|$)/.exec(line);
      if (!match)
        throw new Error(
          "Setext headings must be moved in Source to preserve their syntax.",
        );
      changes.push({
        from: descendant.from - from + match[1].length,
        to: descendant.from - from + match[1].length + match[2].length,
        insert: "#".repeat(shifted),
      });
    }
    fragment = applyChanges(fragment, changes);
  } else {
    const before = node.item!.prefix,
      after =
        target.item!.prefix +
        (placement === "child" ? " ".repeat(target.item!.width) : "");
    if (before.includes("\t") || after.includes("\t"))
      throw new Error("Tab-indented branches must be moved in Source.");
    fragment = fragment
      .split(/(?<=\n)/)
      .map((line) => {
        if (!line.trim()) return line;
        if (!line.startsWith(before))
          throw new Error(
            "This list has lazy continuation lines. Move it in Source instead.",
          );
        return after + line.slice(before.length);
      })
      .join("");
  }
  let at =
    placement === "before"
      ? lineStart(source, target.from)
      : afterLine(source, target.branchTo);
  if (at > from && at < to)
    throw new Error("Choose a target outside this branch.");
  const ending = newline(source);
  if (at && source[at - 1] !== "\n") fragment = ending + fragment;
  if (isHeading && at && !source.slice(0, at).endsWith(ending + ending))
    fragment = ending + fragment;
  if (!fragment.endsWith(ending)) fragment += ending;
  if (isHeading && !fragment.endsWith(ending + ending)) fragment += ending;
  const changes =
    at === from || at === to
      ? [{ from, to, insert: fragment }]
      : [
          { from, to, insert: "" },
          { from: at, to: at, insert: fragment },
        ].sort((a, b) => a.from - b.from);
  const result = applyChanges(source, changes),
    moved = projectMindmap(result);
  const beforeLabels = projection.nodes
    .filter((n) => n.kind !== "root")
    .map((n) => `${n.blockType}:${n.fingerprint}`)
    .sort();
  const afterLabels = moved.nodes
    .filter((n) => n.kind !== "root")
    .map((n) => `${n.blockType}:${n.fingerprint}`)
    .sort();
  if (JSON.stringify(beforeLabels) !== JSON.stringify(afterLabels))
    throw new Error(
      "This move would change another block's interpretation. Nothing was changed; use Source instead.",
    );
  at -= at > from ? to - from : 0;
  return { changes, selection: { anchor: at, head: at } };
}
