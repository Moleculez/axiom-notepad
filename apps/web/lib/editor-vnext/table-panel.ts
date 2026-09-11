import { commandById, type EditorCommandId } from "@axiom/shared/editor";
import { openEditorPopover } from "../editor-popover";
import type { ContextAction } from "../context-menu";
import { disableIcon, iconButton } from "./chrome";
import { appendActionLabel } from "../icons/actions";

export type TablePanelState = {
  row: number;
  column: number;
  rows: number;
  columns: number;
  cell: boolean;
  readOnly: boolean;
  composing: boolean;
  alignment: string;
};
const groups: Record<string, EditorCommandId[]> = {
  Row: [
    "rowBefore",
    "rowAfter",
    "duplicateRow",
    "rowUp",
    "rowDown",
    "selectRow",
    "deleteRow",
  ],
  Column: [
    "columnBefore",
    "columnAfter",
    "duplicateColumn",
    "columnLeft",
    "columnRight",
    "selectColumn",
    "deleteColumn",
  ],
  Table: ["selectTable", "clearCells", "copyTable", "finishBlock"],
};
const alignments: EditorCommandId[] = [
  "alignDefault",
  "alignLeft",
  "alignCenter",
  "alignRight",
];

export function tableActionReason(id: string, state: TablePanelState | null) {
  if (!state) return "This table changed. Close the panel and select it again.";
  if (state.composing)
    return "Finish composing text before changing table structure.";
  if (state.readOnly && !id.startsWith("copy") && !id.startsWith("select"))
    return "You have read-only access to this note.";
  if (!state.cell && !["copyTable", "selectTable", "finishBlock"].includes(id))
    return "Select a cell in this table first.";
  if (["deleteRow", "rowUp", "rowDown"].includes(id) && state.row === 0)
    return "The Markdown header row is protected.";
  if (id === "rowUp" && state.row <= 1) return "This is the first body row.";
  if (id === "rowDown" && state.row === state.rows - 1)
    return "This is the last row.";
  if (id === "columnLeft" && state.column === 0)
    return "This is the first column.";
  if (id === "columnRight" && state.column === state.columns - 1)
    return "This is the last column.";
  if (id === "deleteColumn" && state.columns <= 1)
    return "Keep at least one column.";
  if (
    ["rowBefore", "rowAfter", "duplicateRow"].includes(id) &&
    state.rows >= 1000
  )
    return "Tables support up to 1,000 rows.";
  if (
    ["columnBefore", "columnAfter", "duplicateColumn"].includes(id) &&
    state.columns >= 100
  )
    return "Tables support up to 100 columns.";
  return undefined;
}

export function tablePanel(options: {
  owner: HTMLElement;
  anchor: () => DOMRect;
  state: () => TablePanelState | null;
  action: (id: EditorCommandId) => void;
  restore: () => void;
  onClose: () => void;
  alignmentOnly?: boolean;
  context?: ContextAction[];
}) {
  const panel = openEditorPopover({
    ...options,
    label: options.alignmentOnly ? "Column alignment" : "Table actions",
  });
  const { element } = panel;
  const title = document.createElement("div");
  title.className = "editor-panel-caption";
  element.append(title);
  let tab = options.state()?.cell ? "Row" : "Table";
  const tabs = document.createElement("div");
  tabs.className = "editor-panel-tabs";
  tabs.role = "tablist";
  tabs.setAttribute("aria-label", "Table action scope");
  const body = document.createElement("div");
  body.className = "editor-panel-body";
  body.id = "table-panel-" + crypto.randomUUID();
  if (!options.alignmentOnly) {
    body.role = "tabpanel";
    element.append(tabs);
  }
  element.append(body);
  const buttons = new Map<EditorCommandId, HTMLButtonElement>();
  const add = (ids: EditorCommandId[], parent: HTMLElement) => {
    const grid = document.createElement("div");
    grid.className = "editor-panel-icons";
    if (ids === alignments) {
      grid.role = "group";
      grid.setAttribute("aria-label", "Column alignment");
    }
    for (const id of ids) {
      const button = iconButton(
        commandById[id].label,
        id === "copyTable" || id.startsWith("duplicate") ? "copy" : id,
        () => {
          if (tableActionReason(id, options.state())) return refresh();
          panel.close(true);
          options.action(id);
        },
      );
      button.dataset.action = id;
      if (id.startsWith("delete") || id === "clearCells")
        button.dataset.tone = "danger";
      buttons.set(id, button);
      grid.append(button);
    }
    parent.append(grid);
  };
  const render = () => {
    buttons.clear();
    body.replaceChildren();
    for (const button of tabs.querySelectorAll<HTMLButtonElement>("button")) {
      const selected = button.textContent === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected) body.setAttribute("aria-labelledby", button.id);
    }
    if (options.alignmentOnly) add(alignments, body);
    else {
      add(groups[tab], body);
      if (tab === "Column") {
        const label = document.createElement("div");
        label.className = "editor-panel-caption";
        label.textContent = "Alignment";
        body.append(label);
        add(alignments, body);
      }
    }
    refresh();
  };
  const refresh = () => {
    const state = options.state();
    title.textContent = !state
      ? "Table changed · reopen to continue"
      : state.cell
        ? `${state.row === 0 ? "Header" : "Row " + state.row} · Column ${state.column + 1}`
        : "Choose a cell for row and column actions";
    for (const [id, button] of buttons) {
      disableIcon(button, tableActionReason(id, state));
      if (id.startsWith("align"))
        button.setAttribute(
          "aria-pressed",
          String(
            id ===
              "align" +
                (state?.alignment
                  ? state.alignment[0].toUpperCase() + state.alignment.slice(1)
                  : "Default"),
          ),
        );
    }
    panel.place();
  };
  for (const name of Object.keys(groups)) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.id = body.id + "-" + name;
    button.textContent = name;
    button.setAttribute("aria-controls", body.id);
    button.addEventListener("click", () => {
      tab = name;
      render();
    });
    tabs.append(button);
  }
  tabs.addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const names = Object.keys(groups);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 2
          : (names.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 2)) % 3;
    tab = names[index];
    render();
    (tabs.children[index] as HTMLButtonElement).focus();
  });
  if (options.context?.length && !options.alignmentOnly) {
    const footer = document.createElement("div");
    footer.className = "editor-panel-footer";
    for (const item of options.context) {
      const button = document.createElement("button");
      button.type = "button";
      appendActionLabel(button, item.icon, item.label);
      button.disabled = !!item.disabled;
      button.addEventListener("click", () => {
        panel.close(true);
        item.action();
      });
      footer.append(button);
    }
    element.append(footer);
  }
  render();
  if (options.alignmentOnly) buttons.values().next().value?.focus();
  else tabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  return { close: panel.close, refresh };
}
