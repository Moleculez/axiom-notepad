import { describe, expect, test } from "vitest";
import {
  spaceLifecycleActions,
  type Space,
} from "../packages/shared/src/workspace";
const base = {
  kind: "team",
  status: "active",
  effective_status: "active",
  can_manage: true,
  group_role: "owner",
} as const;
const actions = (change: Partial<Space>) =>
  spaceLifecycleActions({ ...base, ...change });
describe("workspace lifecycle authority", () => {
  test("personal space never exposes lifecycle removal", () =>
    expect(actions({ kind: "personal" })).toEqual([]));
  test("a content editor is not implicitly a workspace manager", () =>
    expect(actions({ can_manage: false, group_role: "member" })).toEqual([]));
  test("team administrators can archive but cannot trash", () =>
    expect(actions({ group_role: "admin" })).toEqual(["archive"]));
  test("project managers can archive and trash, but not purge", () => {
    expect(actions({ kind: "project", group_role: "member" })).toEqual([
      "archive",
      "trash",
    ]);
    expect(
      actions({
        kind: "project",
        group_role: "member",
        status: "trashed",
        effective_status: "trashed",
      }),
    ).toEqual(["restore"]);
  });
  test("an owner can restore or purge only independently trashed workspaces", () => {
    expect(
      actions({
        kind: "project",
        status: "trashed",
        effective_status: "trashed",
      }),
    ).toEqual(["restore", "purge"]);
    expect(actions({ kind: "project", effective_status: "trashed" })).toEqual(
      [],
    );
    expect(actions({ kind: "project", effective_status: "archived" })).toEqual(
      [],
    );
    expect(
      actions({
        kind: "project",
        status: "archived",
        effective_status: "archived",
        parent_status: "archived",
      }),
    ).toEqual([]);
  });
  test("the default group workspace is independently recoverable but protected from permanent removal", () =>
    expect(actions({ status: "trashed", effective_status: "trashed" })).toEqual(
      ["restore"],
    ));
  test("only the owner can cancel pending permanent removal", () => {
    expect(actions({ status: "purging", effective_status: "purging" })).toEqual(
      ["restore"],
    );
    expect(
      actions({
        status: "purging",
        effective_status: "purging",
        group_role: "admin",
      }),
    ).toEqual([]);
  });
});
