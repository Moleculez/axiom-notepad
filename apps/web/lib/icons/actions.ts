import lucide from "./action-data.json";

// First-party table glyphs retain the editor's established structural language.
const structural = {
  bookmark: "M6 3h12v18l-6-4-6 4z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2",
  unlock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.8-1.2M12 15v2",
  rowBefore: "M4 12h16v8H4zM8 6h8M12 2v8",
  rowAfter: "M4 4h16v8H4zM8 18h8M12 14v8",
  columnBefore: "M12 4h8v16h-8zM2 12h8M6 8v8",
  columnAfter: "M4 4h8v16H4zM14 12h8M18 8v8",
  deleteRow: "M4 3h16v18H4zM4 9h16M4 15h16M9 12h6",
  deleteColumn: "M3 4h18v16H3zM9 4v16M15 4v16M12 9v6",
  selectRow: "M3 3h18v18H3zM3 9h18M3 15h18M7 12h10",
  selectColumn: "M3 3h18v18H3zM9 3v18M15 3v18M12 7v10",
  selectTable: "M3 3h18v18H3zM3 9h18M9 3v18",
  finishBlock: "M18 3v10H5m5-5-5 5 5 5M5 22h14",
  paragraphBefore: "M18 21V11H5m5-5-5 5 5 5M5 2h14",
  alignDefault: "M4 5h16M4 10h10M4 15h16M4 20h10",
  closeAll: "M4 8H2V2h16v2M6 6h16v16H6zM11 11l6 6m0-6-6 6",
  file: "M5 2h9l5 5v15H5zM14 2v6h5",
  canvas: "M2 3h8v6H2zM14 15h8v6h-8zM6 9v9h8M15 3h7v6h-7z",
  source: "M8 5l-6 7 6 7M16 5l6 7-6 7M14 2l-4 20",
  chevronRight: "m9 5 7 7-7 7",
  link: "M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l2-2",
  folder: "M2 6h8l2 2h10v13H2zM2 6V3h7l3 3",
} as const;
export type ActionIconName = keyof typeof lucide | keyof typeof structural;
export type IconNode = readonly [string, Record<string, string | number>];
export const actionIconNames: readonly ActionIconName[] = [
  ...new Set([...Object.keys(lucide), ...Object.keys(structural)]),
] as ActionIconName[];

/** Trusted, bundled geometry only; never parse labels or user-provided SVG. */
export function actionIconNodes(name: ActionIconName): readonly IconNode[] {
  if (Object.hasOwn(structural, name))
    return [["path", { d: structural[name as keyof typeof structural] }]];
  return lucide[name as keyof typeof lucide] as unknown as readonly IconNode[];
}

export function actionIcon(name: ActionIconName) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.75",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
    class: "action-icon",
    "data-icon": name,
  }))
    svg.setAttribute(key, value);
  for (const [tag, attributes] of actionIconNodes(name)) {
    const child = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attributes))
      child.setAttribute(key, String(value));
    svg.append(child);
  }
  return svg;
}

export function appendActionLabel(
  element: HTMLElement,
  icon: ActionIconName,
  label: string,
) {
  const text = document.createElement("span");
  text.className = "action-label";
  text.textContent = label;
  element.append(actionIcon(icon), text);
}
