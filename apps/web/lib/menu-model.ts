import type { ActionIconName } from "./icons/actions";

/** Legacy callers can keep group labels; presentation is normalized once here. */
export type ContextAction = {
  id?: string;
  label: string;
  icon: ActionIconName;
  action: () => void;
  children?: ContextAction[];
  disabled?: boolean;
  hidden?: boolean;
  primary?: boolean;
  checked?: boolean;
  shortcut?: string;
  group?: string;
  tone?: "danger";
  disabledReason?: string;
};
export type MenuEntry =
  | { kind: "separator"; id: string }
  | (Omit<ContextAction, "children"> & { kind: "action" })
  | (Omit<ContextAction, "children" | "action"> & {
      kind: "submenu";
      children: MenuEntry[];
    });

const categoryNames: Record<string, string> = {
  clipboard: "Copy & paste",
  recovery: "Recovery",
  danger: "Remove",
  display: "View",
  navigate: "Navigate",
  settings: "Settings",
  mask: "Mask",
  attach: "Attach",
  target: "Target",
  create: "Insert",
  threads: "Discussion",
};
const category = (name: string) => categoryNames[name.toLowerCase()] ?? name;

function visible(actions: ContextAction[]): ContextAction[] {
  let group = "Actions";
  return actions.flatMap((action) => {
    if (action.group) group = category(action.group);
    if (action.hidden) return [];
    const children = action.children && visible(action.children);
    if (children && !children.length) return [];
    return [{ ...action, group, ...(children ? { children } : {}) }];
  });
}
/** A submenu is always the final level; nested legacy categories retain labels. */
function leaves(actions: ContextAction[], prefix = ""): ContextAction[] {
  return actions.flatMap((action) =>
    action.children
      ? leaves(action.children, prefix + action.label + " · ").map((leaf) => ({
          ...leaf,
          disabled: action.disabled || leaf.disabled,
          disabledReason: action.disabledReason ?? leaf.disabledReason,
        }))
      : [{ ...action, label: prefix + action.label }],
  );
}
function entries(actions: ContextAction[]): MenuEntry[] {
  let previous = "";
  const result: MenuEntry[] = [];
  for (const action of actions) {
    const group =
      action.tone === "danger" ? "danger" : (action.group ?? "Actions");
    if (previous && group !== previous)
      result.push({ kind: "separator", id: `separator:${result.length}` });
    previous = group;
    if (action.children) {
      const { action: _run, children, ...rest } = action;
      result.push({
        ...rest,
        kind: "submenu",
        children: entries(leaves(children)),
      });
    } else result.push({ ...action, kind: "action" });
  }
  return result;
}

/** At most eight root rows, explicit categories, no headings or lost actions. */
export function compactMenu(actions: ContextAction[]): MenuEntry[] {
  const clean = visible(actions);
  if (clean.length <= 8) return entries(clean);
  const primary: ContextAction[] = [],
    danger: ContextAction[] = [];
  const groups = new Map<string, ContextAction[]>();
  for (const [index, action] of clean.entries()) {
    if (action.tone === "danger") danger.push(action);
    else if ((action.primary || index === 0) && primary.length < 3)
      primary.push(action);
    else {
      const name = action.group ?? "Actions";
      groups.set(name, [...(groups.get(name) ?? []), action]);
    }
  }
  const grouped = [...groups].map(([label, children]): ContextAction =>
    children.length === 1
      ? children[0]
      : {
          id: `category:${label}`,
          label,
          icon: children[0].icon,
          group: "Categories",
          children,
          action: () => {},
        },
  );
  const removal: ContextAction[] =
    danger.length <= 1
      ? danger
      : [
          {
            id: "category:remove",
            label: "Remove",
            icon: "trash",
            tone: "danger",
            children: danger,
            action: () => {},
          },
        ];
  const slots = 8 - primary.length - removal.length;
  const rest =
    grouped.length > slots
      ? [
          ...grouped.slice(0, slots - 1),
          {
            id: "category:other",
            label: "Other actions",
            icon: "settings" as const,
            children: grouped.slice(slots - 1),
            action: () => {},
            group: "Categories",
          },
        ]
      : grouped;
  return entries([...primary, ...rest, ...removal]);
}
