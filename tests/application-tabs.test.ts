import { describe, expect, it } from "vitest";
import {
  navigateApplicationTab,
  newApplicationTab,
  restoreApplicationTabs,
  tabRoute,
  safeApplicationView,
} from "@axiom/shared/application-tabs";
describe("application tabs", () => {
  it("replaces a completed creation page without keeping a stale form in tab history", () => {
    const tab = newApplicationTab("/tools/math/new?space=s", "creation");
    const project = navigateApplicationTab(
      tab,
      "/tools/math/created?file=f&version=v",
      true,
    );
    expect(project.id).toBe(tab.id);
    expect(project.history).toEqual(["/tools/math/created?file=f&version=v"]);
    expect(project.path).not.toContain("/new");
    expect(project.index).toBe(0);
  });
  it("persists only bounded presentation state without draft text or credentials", () => {
    expect(
      safeApplicationView({
        mode: "source",
        scroll: -10,
        token: "secret",
        source: "private research",
        selection: ["bad", "01234567-1234-1234-1234-123456789abc"],
      }),
    ).toEqual({
      mode: "source",
      scroll: 0,
      selection: ["01234567-1234-1234-1234-123456789abc"],
    });
    expect(
      safeApplicationView({ scroll: Infinity, panel: "sensitive text" }),
    ).toBeUndefined();
  });
  it("never retains account or invitation credentials", () => {
    expect(
      tabRoute("/workbench/groups?invite=private&token=secret&reset=1"),
    ).toBe("/groups");
    expect(tabRoute("https://untrusted.example/notes/a")).toBe("/home");
    expect(tabRoute("/settings/groups")).toBe("/groups");
    expect(tabRoute("/files/a?version=v&token=secret")).toBe(
      "/files/a?version=v",
    );
  });
  it("keeps independent histories and file versions", () => {
    const a = newApplicationTab("/files/a?version=1", "a"),
      b = newApplicationTab("/files/a?version=2", "b");
    expect(a.path).not.toBe(b.path);
    const next = navigateApplicationTab(a, "/explorer?space=s");
    expect(next.history).toEqual(["/files/a?version=1", "/explorer?space=s"]);
    expect(a.history).toHaveLength(1);
    expect(
      navigateApplicationTab({ ...next, index: 0 }, "/home").history,
    ).toEqual(["/files/a?version=1", "/home"]);
  });
  it("migrates old document tabs and bounds corrupted navigation", () => {
    let n = 0;
    const state = restoreApplicationTabs(
      null,
      [{ id: "01234567-1234-1234-1234-123456789abc", kind: "note" }],
      "/groups?invite=secret",
      () => String(++n),
    );
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[1].path).toBe("/groups");
    const restored = restoreApplicationTabs(
      {
        ...state,
        tabs: [
          ...state.tabs,
          {
            ...state.tabs[1],
            path: "/settings/theme",
            history: ["/settings/theme"],
            id: "s1",
          },
          {
            id: "s2",
            path: "/settings/code",
            history: ["/settings/code"],
            index: 99,
            view: { token: "secret" },
          },
        ],
      },
      null,
      "/groups",
      () => String(++n),
    );
    expect(
      restored.tabs.filter((t) => t.path.startsWith("/settings")),
    ).toHaveLength(1);
    expect(JSON.stringify(restored)).not.toContain("secret");
  });
});
