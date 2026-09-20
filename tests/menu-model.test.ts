import { describe, expect, it } from "vitest";
import {
  compactMenu,
  type ContextAction,
  type MenuEntry,
} from "../apps/web/lib/menu-model";
const action = (id: string, group?: string): ContextAction => ({
  id,
  label: id,
  group,
  icon: "file",
  action: () => {},
});
const flat = (items: MenuEntry[]): MenuEntry[] =>
  items.flatMap((item) =>
    item.kind === "submenu"
      ? flat(item.children)
      : item.kind === "separator"
        ? []
        : [item],
  );
describe("compact context menus", () => {
  it("caps root rows without losing any operation", () => {
    const input = Array.from({ length: 60 }, (_, i) =>
      action(`action-${i}`, `Group ${i % 12}`),
    );
    const menu = compactMenu(input);
    expect(
      menu.filter((item) => item.kind !== "separator").length,
    ).toBeLessThanOrEqual(8);
    expect(
      flat(menu)
        .map((item) => item.id)
        .sort(),
    ).toEqual(input.map((item) => item.id).sort());
    for (const item of menu)
      if (item.kind === "submenu")
        expect(item.children.every((child) => child.kind !== "submenu")).toBe(
          true,
        );
  });
  it("omits unavailable operations and empty categories, not temporary disabled actions", () => {
    const menu = compactMenu([
      { ...action("hidden"), hidden: true },
      {
        ...action("empty"),
        children: [{ ...action("no-access"), hidden: true }],
      },
      {
        ...action("paste"),
        disabled: true,
        disabledReason: "Copy a file first",
      },
    ]);
    expect(flat(menu).map((item) => item.id)).toEqual(["paste"]);
    expect(menu[0]).toMatchObject({
      disabled: true,
      disabledReason: "Copy a file first",
    });
  });
  it("keeps destructive operations separated at the end of a long menu", () => {
    const menu = compactMenu([
      ...Array.from({ length: 12 }, (_, i) => action(String(i), "View")),
      { ...action("delete"), tone: "danger" },
    ]);
    expect(menu.at(-1)).toMatchObject({ id: "delete", tone: "danger" });
    expect(menu.at(-2)?.kind).toBe("separator");
  });
  it("flattens nested menus with meaningful paths and inherited disabled state", () => {
    const menu = compactMenu([
      {
        ...action("new"),
        children: [
          { ...action("office"), disabled: true, children: [action("word")] },
        ],
      },
    ]);
    expect(flat(menu)[0]).toMatchObject({
      label: "office · word",
      disabled: true,
    });
  });
  it("retains callbacks and avoids orphan or duplicate dividers", () => {
    const run = () => {};
    const menu = compactMenu([
      { ...action("open", "Open"), action: run },
      action("copy", "Copy"),
      action("link"),
      action("delete", "Remove"),
    ]);
    expect(menu[0]).toMatchObject({ kind: "action", action: run });
    expect(menu[0].kind).not.toBe("separator");
    expect(menu.at(-1)?.kind).not.toBe("separator");
    expect(
      menu.some(
        (item, i) =>
          item.kind === "separator" && menu[i + 1]?.kind === "separator",
      ),
    ).toBe(false);
  });
});
