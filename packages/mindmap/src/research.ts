import { plainText } from "../../markdown/src/parser";
import { documentIndex } from "../../markdown/src/document-index";
import type { MarkdownNode, ParsedDocument } from "../../markdown/src/types";
import type { MindmapNode, MindmapProjection } from "./types";

export const mindmapResearchLenses = [
  { id: "all", label: "All content" },
  { id: "equations", label: "Equations" },
  { id: "figures", label: "Figures & diagrams" },
  { id: "code", label: "Code" },
  { id: "tables", label: "Tables" },
  { id: "references", label: "Linked evidence" },
  { id: "open-tasks", label: "Unfinished tasks" },
] as const;
export type MindmapResearchLens = (typeof mindmapResearchLenses)[number]["id"];
export type MindmapEvidence = {
  kind: "note" | "link" | "citation" | "footnote" | "equation";
  target: string;
  label: string;
  from: number;
  to: number;
  targetFrom?: number;
};
export type MindmapResearchIndex = {
  kinds: Map<string, Set<MindmapResearchLens>>;
  evidence: Map<string, MindmapEvidence[]>;
  searchable: Map<string, string>;
  targets: Map<string, number>;
};

/** A marker toggle is synchronous; stale worker projections must not undo its
 * native checkbox state. Other source changes wait for a current projection.
 */
export function mindmapTaskChecked(node: MindmapNode, source: string) {
  const task = node.item?.task;
  if (task && source.slice(node.labelFrom, node.labelTo) === node.labelSource) {
    const marker = /^\[([ xX])\][ \t]*$/.exec(
      source.slice(node.labelFrom - task.length, node.labelFrom),
    );
    if (marker) return marker[1] !== " ";
  }
  return node.checked;
}

/** Index the owner's AST once. A nested block belongs to its own map node, not
 * every containing heading. Aggregation and mutation still use the full tree. */
export function mindmapResearchIndex(
  projection: MindmapProjection,
  document: ParsedDocument,
): MindmapResearchIndex {
  const byRange = new Map(
    projection.nodes.map((n) => [`${n.blockType}:${n.from}`, n.id]),
  );
  const kinds = new Map<string, Set<MindmapResearchLens>>(),
    evidence = new Map<string, MindmapEvidence[]>(),
    searchable = new Map<string, string>(),
    targets = new Map<string, number>();
  for (const n of projection.nodes) {
    const types = new Set<MindmapResearchLens>();
    if (n.checked === false) types.add("open-tasks");
    kinds.set(n.id, types);
    evidence.set(n.id, []);
    searchable.set(n.id, n.label.toLowerCase());
  }
  for (const heading of document.outline)
    targets.set("#" + heading.id, heading.from);
  // Match the renderer's first-label-wins numbering and whitespace grammar.
  for (const equation of documentIndex(document).equations)
    if (equation.label && !targets.has("#eq-" + equation.label))
      targets.set("#eq-" + equation.label, equation.from);
  for (const [key, nodes] of Object.entries(document.footnotes))
    if (nodes.length) targets.set("#fn-" + key, nodes[0].from);
  const visit = (ast: MarkdownNode, inherited: string) => {
    const owner = byRange.get(`${ast.type}:${ast.from}`) ?? inherited;
    const types = kinds.get(owner)!;
    if (["mathBlock", "mathInline"].includes(ast.type)) types.add("equations");
    if (ast.type === "table") types.add("tables");
    if (ast.type === "image") types.add("figures");
    if (ast.type === "codeBlock") {
      types.add("code");
      if (ast.lang?.toLowerCase() === "mermaid") types.add("figures");
    }
    if (ast.type === "media" && ast.key) targets.set("#" + ast.key, ast.from);
    if (["mathBlock", "mathInline"].includes(ast.type))
      for (const match of (ast.text ?? "").matchAll(/\\eqref\s*\{([^}]+)\}/g)) {
        evidence.get(owner)!.push({
          from: ast.from,
          to: ast.to,
          kind: "equation",
          target: match[1],
          label: `Equation ${match[1]}`,
        });
        types.add("references");
      }
    let item: MindmapEvidence | undefined;
    const base = { from: ast.from, to: ast.to };
    if (ast.type === "wikiLink" || ast.type === "link")
      item = {
        ...base,
        kind: ast.type === "wikiLink" ? "note" : "link",
        target: ast.href ?? "",
        label: plainText(ast) || ast.href || "Link",
      };
    else if (ast.type === "footnoteRef")
      item = {
        ...base,
        kind: "footnote",
        target: ast.key ?? "",
        label: `Footnote ${ast.key ?? ""}`,
      };
    else if (ast.type === "equationRef")
      item = {
        ...base,
        kind: "equation",
        target: ast.key ?? "",
        label: `Equation ${ast.key ?? ""}`,
      };
    else if (ast.type === "citation") {
      for (const key of (ast.key ?? "").split(";").filter(Boolean))
        evidence
          .get(owner)!
          .push({ ...base, kind: "citation", target: key, label: key });
      types.add("references");
    }
    if (item) {
      evidence.get(owner)!.push(item);
      types.add("references");
    }
    // Do not concatenate the text of nested containers repeatedly.
    if (
      ast.text &&
      !["blockquote", "callout", "list", "listItem"].includes(ast.type)
    )
      searchable.set(
        owner,
        searchable.get(owner) + " " + ast.text.toLowerCase(),
      );
    ast.children?.forEach((child) => visit(child, owner));
  };
  visit(document.ast, projection.rootId);
  for (const items of evidence.values())
    for (const item of items) {
      const target =
        item.kind === "footnote"
          ? "#fn-" + item.target
          : item.kind === "equation"
            ? "#eq-" + item.target
            : item.target;
      item.targetFrom = targets.get(target);
    }
  return { kinds, evidence, searchable, targets };
}

export function mindmapBranchIds(
  projection: MindmapProjection,
  rootId = projection.rootId,
) {
  const byId = new Map(projection.nodes.map((n) => [n.id, n]));
  const ids = new Set<string>(),
    pending = [rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (ids.has(id) || !byId.has(id)) continue;
    ids.add(id);
    pending.push(...byId.get(id)!.children);
  }
  return ids;
}

export function mindmapResearchMatches(
  projection: MindmapProjection,
  index: MindmapResearchIndex,
  lens: MindmapResearchLens,
  query = "",
  rootId = projection.rootId,
) {
  const scope = mindmapBranchIds(projection, rootId),
    needle = query.trim().toLowerCase();
  return projection.nodes.filter(
    (node) =>
      scope.has(node.id) &&
      !node.presentationOnly &&
      (lens === "all" || index.kinds.get(node.id)?.has(lens)) &&
      (!needle || index.searchable.get(node.id)?.includes(needle)),
  );
}

export function mindmapAncestorIds(
  projection: MindmapProjection,
  ids: Iterable<string>,
) {
  const byId = new Map(projection.nodes.map((n) => [n.id, n])),
    found = new Set<string>();
  for (const id of ids) {
    let node = byId.get(id);
    while (node && !found.has(node.id)) {
      found.add(node.id);
      node = byId.get(node.parentId ?? "");
    }
  }
  return found;
}

/** A read-only topology. Never pass it to a source command or move validator. */
export function mindmapResearchTopology(
  projection: MindmapProjection,
  matches: Iterable<string>,
  rootId = projection.rootId,
): MindmapProjection {
  const scope = mindmapBranchIds(projection, rootId),
    included = mindmapAncestorIds(projection, matches);
  included.add(rootId);
  return {
    ...projection,
    rootId,
    nodes: projection.nodes
      .filter((n) => included.has(n.id) && scope.has(n.id))
      .map((n) => ({
        ...n,
        children: n.children.filter((id) => included.has(id) && scope.has(id)),
        parentId: n.id === rootId ? null : n.parentId,
      })),
  };
}

/** Derive current view intent from the complete canonical tree. Layout workers
 * may lag a focus/filter change; keyboard navigation must not use their old
 * children. This read-only projection is never a source-command topology.
 */
export function mindmapViewProjection(
  projection: MindmapProjection,
  focus?: { position: number; type: string },
  matches?: Iterable<string>,
): MindmapProjection {
  const rootId = focus
    ? (projection.nodes.find(
        (node) =>
          node.from === focus.position &&
          node.blockType === focus.type &&
          !node.presentationOnly,
      )?.id ?? projection.rootId)
    : projection.rootId;
  if (matches !== undefined)
    return mindmapResearchTopology(projection, matches, rootId);
  return rootId === projection.rootId ? projection : { ...projection, rootId };
}

export function mindmapBranchEvidence(
  projection: MindmapProjection,
  index: MindmapResearchIndex,
  node: MindmapNode,
) {
  const ids = mindmapBranchIds(projection, node.id),
    unique = new Map<string, MindmapEvidence>();
  for (const n of projection.nodes)
    if (ids.has(n.id))
      for (const item of index.evidence.get(n.id) ?? [])
        if (!unique.has(`${item.kind}:${item.target}`))
          unique.set(`${item.kind}:${item.target}`, item);
  return [...unique.values()];
}
