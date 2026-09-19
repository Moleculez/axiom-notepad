import { describe, expect, it } from "vitest";
import {
  emptyWorkspaceSessions,
  restoreWorkspaceSessions,
  serializeWorkspaceSessions,
  visitWorkspace,
} from "@axiom/shared/workspace-sessions";

describe("workspace navigation sessions", () => {
  let sequence = 0;
  const id = () => `visit-${++sequence}`;
  it("has global history, retains per-location views and truncates forward history on a new visit", () => {
    let state = visitWorkspace(emptyWorkspaceSessions(), "/home", id);
    state = visitWorkspace(state, "/explorer?folder=a", id);
    const explorer = state.active;
    state.sessions[1].view = { scroll: 321, layout: "grid" };
    state = visitWorkspace(state, "/inbox", id);
    state = visitWorkspace(state, "/explorer?folder=a", id, 1);
    expect(state.active).toBe(explorer);
    expect(state.sessions.at(-1)?.view).toEqual({
      scroll: 321,
      layout: "grid",
    });
    expect(state.index).toBe(1);
    expect(state.history).toEqual(["/home", "/explorer?folder=a", "/inbox"]);
    state = visitWorkspace(state, "/research", id);
    expect(state.history).toEqual(["/home", "/explorer?folder=a", "/research"]);
  });
  it("replaces redirects without losing the session being left", () => {
    let state = visitWorkspace(emptyWorkspaceSessions(), "/new", id);
    state = visitWorkspace(state, "/notes/abc", id, "replace");
    expect(state.history).toEqual(["/notes/abc"]);
    expect(state.sessions).toHaveLength(2);
  });
  it("keeps the mounted session stable while filters or a planning selection change", () => {
    let state = visitWorkspace(
      emptyWorkspaceSessions(),
      "/explorer?space=a&folder=b",
      id,
    );
    const explorer = state.active;
    state = visitWorkspace(
      state,
      "/explorer?space=a&folder=b&q=quantum&kind=note",
      id,
      "replace",
    );
    expect(state.active).toBe(explorer);
    state = visitWorkspace(state, "/workspaces/a/planning", id);
    const planning = state.active;
    state = visitWorkspace(
      state,
      "/workspaces/a/planning?view=gantt&task=new&q=test",
      id,
      "replace",
    );
    expect(state.active).toBe(planning);
    expect(state.sessions).toHaveLength(2);
  });
  it("retains one Settings session across categories and one document view across anchors", () => {
    let state = visitWorkspace(
      emptyWorkspaceSessions(),
      "/settings/profile",
      id,
    );
    const settings = state.active;
    state = visitWorkspace(state, "/settings/appearance", id);
    expect(state.active).toBe(settings);
    state = visitWorkspace(state, "/notes/abc#one", id);
    const note = state.active;
    state = visitWorkspace(state, "/notes/abc#two", id);
    expect(state.active).toBe(note);
    expect(state.sessions).toHaveLength(2);
  });
  it("migrates pinned tabs and safe views, but never titles, draft bodies or credentials", () => {
    const state = restoreWorkspaceSessions(
      null,
      {
        version: 2,
        tabs: [
          {
            id: "old",
            path: "/explorer?invite=secret&folder=abc",
            pinned: true,
            title: "private name",
            view: { scroll: 70, body: "draft", password: "secret" },
          },
        ],
      },
      null,
      "/home",
      id,
    );
    expect(state.sessions[0]).toMatchObject({
      id: "old",
      path: "/explorer?folder=abc",
      pinned: true,
      view: { scroll: 70 },
    });
    const persisted = serializeWorkspaceSessions(state);
    expect(persisted).not.toMatch(/secret|draft|private name|history|password/);
    expect(
      restoreWorkspaceSessions(
        JSON.parse(persisted),
        null,
        null,
        "/explorer?folder=abc",
        id,
      ).active,
    ).toBe("old");
  });
  it("bounds recent metadata and history while retaining pins", () => {
    let state = visitWorkspace(emptyWorkspaceSessions(), "/home", id);
    state.sessions[0].pinned = true;
    for (let n = 0; n < 180; n++)
      state = visitWorkspace(state, `/notes/${n}`, id);
    expect(state.sessions).toHaveLength(100);
    expect(state.history).toHaveLength(100);
    expect(state.sessions[0].path).toBe("/home");
  });
  it("ignores corrupt data and deduplicates saved sessions", () => {
    const state = restoreWorkspaceSessions(
      {
        version: 1,
        sessions: [
          null,
          {},
          { id: "a", path: "/home" },
          { id: "b", path: "/home" },
          { id: "a", path: "/inbox" },
        ],
      },
      null,
      null,
      "/home",
      id,
    );
    expect(state.sessions).toHaveLength(1);
    expect(state.active).toBe("a");
  });
});
