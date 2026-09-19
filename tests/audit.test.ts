import { describe, expect, it } from "vitest";
import {
  auditChanges,
  auditLabel,
  auditVersionDiff,
} from "../packages/shared/src/audit";
import { trashSelectionSchema } from "../packages/shared/src/trash";
import { tabRoute, tabTitle } from "../packages/shared/src/application-tabs";
import { workspaceLocation } from "../packages/shared/src/workspace-location";
import { randomUUID } from "node:crypto";

describe("management console contracts", () => {
  it("compares only changed metadata without inventing legacy values", () => {
    expect(
      auditChanges({
        before_values: { name: "A", tags: ["proof"] },
        after_values: { name: "B", tags: ["proof"] },
      }),
    ).toEqual([{ key: "name", before: "A", after: "B" }]);
    expect(auditChanges({ before_values: null, after_values: null })).toEqual(
      [],
    );
    expect(auditLabel("named-version")).toBe("named version");
  });
  it("shows context and additions/removals for retained versions", () => {
    expect(auditVersionDiff("# Proof\nold\nend", "# Proof\nnew\nend")).toEqual([
      { kind: "context", text: "# Proof" },
      { kind: "removed", text: "old" },
      { kind: "added", text: "new" },
      { kind: "context", text: "end" },
    ]);
    expect(auditVersionDiff("unchanged", "unchanged")).toEqual([
      { kind: "context", text: "unchanged" },
    ]);
    const large = "x\n".repeat(10000);
    expect(
      auditVersionDiff(large, large + "done").filter(
        (line) => line.kind === "added",
      ),
    ).toEqual([{ kind: "added", text: "done" }]);
  });
  it("retains management locations in tabs without credentials", () => {
    expect(
      tabRoute(
        "/workbench/audit?view=operations&operation=job&kind=trash&token=secret",
      ),
    ).toBe("/audit?kind=trash&operation=job&view=operations");
    expect(tabTitle("/workspaces/a/general")).toBe("Workspaces");
    expect(tabTitle("/trash?view=workspaces")).toBe("Trash");
    expect(
      workspaceLocation({
        route: "/workspaces/a/general",
        title: "Lab · General",
        space: { id: "a", name: "Lab" },
      }),
    ).toEqual({
      crumbs: [
        { label: "Workspaces", to: "/workspaces" },
        { label: "Lab", to: "/workspaces/a" },
        { label: "General" },
      ],
      up: "/workspaces/a",
    });
  });
  it("separates workspace and file cleanup while validating restore choices", () => {
    const base = {
      mutationId: randomUUID(),
      action: "restore",
      spaceIds: [randomUUID()],
      ids: [randomUUID()],
    };
    expect(trashSelectionSchema.parse(base).target).toBe("files");
    expect(
      trashSelectionSchema.parse({ ...base, target: "workspaces" }).target,
    ).toBe("workspaces");
    expect(
      trashSelectionSchema.safeParse({ ...base, conflictPolicy: "overwrite" })
        .success,
    ).toBe(false);
    expect(
      trashSelectionSchema.safeParse({ ...base, after: "not-a-date" }).success,
    ).toBe(false);
    expect(
      trashSelectionSchema.parse({
        ...base,
        destinationId: randomUUID(),
        conflictPolicy: "skip",
      }).conflictPolicy,
    ).toBe("skip");
  });
});
