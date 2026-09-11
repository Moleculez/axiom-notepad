import { describe, expect, it } from "vitest";
import { tabRoute, tabTitle } from "../packages/shared/src/application-tabs";
import {
  folderRoute,
  locationResourceId,
  workspaceLocation,
} from "../packages/shared/src/workspace-location";
import type { ResourceLocation } from "../packages/shared/src/workspace";

const space = "00000000-0000-4000-8000-000000000001",
  parent = "00000000-0000-4000-8000-000000000002",
  child = "00000000-0000-4000-8000-000000000003",
  id = "00000000-0000-4000-8000-000000000004";
const location: ResourceLocation = {
  space: { id: space, kind: "team", name: "Physics lab" },
  ancestors: [
    { id: parent, name: "Research", kind: "folder" },
    { id: child, name: "量子 & optics", kind: "folder" },
  ],
  resource: {
    id,
    space_id: space,
    parent_id: child,
    name: "Derivation",
    kind: "note",
  },
};
describe("workspace breadcrumb routes", () => {
  it.each(["/notes", "/notes/", "/workbench/notes"])(
    "maps legacy %s to the real notes collection",
    (path) => {
      expect(tabRoute(path)).toBe("/explorer?kind=note&view=all");
      expect(tabTitle(path)).toBe("Research notes");
    },
  );
  it("maps the legacy file collection and strips item-only parameters", () => {
    expect(
      tabRoute(`/files?version=old&folder=${parent}&q=matrix&token=secret`),
    ).toBe("/explorer?kind=file&q=matrix&view=all");
    expect(tabTitle("/files")).toBe("Files");
  });
  it.each([
    `/notes/${id}`,
    `/files/${id}?version=old`,
    `/tools/math/${id}`,
    `/tools/image/${id}`,
    `/explorer?folder=${id}`,
  ])("resolves the physical resource from %s", (route) =>
    expect(locationResourceId(route)).toBe(id),
  );
  it.each([
    "/notes",
    "/files/undefined",
    "/tools/math/new",
    "/tools/viewer",
    "/explorer?folder=not-a-uuid",
  ])("does not fetch fabricated resource IDs for %s", (route) =>
    expect(locationResourceId(route)).toBeNull(),
  );
  it("shows every ancestor and uses the physical parent for Up", () => {
    const result = workspaceLocation({ route: `/notes/${id}`, location });
    expect(result.crumbs.map((c) => c.label)).toEqual([
      "Research notes",
      "Physics lab",
      "Research",
      "量子 & optics",
      "Derivation",
    ]);
    expect(result.crumbs.map((c) => c.to)).toEqual([
      "/explorer?kind=note&view=all",
      folderRoute(space),
      folderRoute(space, parent),
      folderRoute(space, child),
      undefined,
    ]);
    expect(result.up).toBe(folderRoute(space, child));
  });
  it("does not invent an ancestor while switching to another tab", () => {
    const result = workspaceLocation({
      route: `/files/${parent}`,
      title: "Another file",
      location,
    });
    expect(result.crumbs.map((c) => c.label)).toEqual([
      "Files",
      "Another file",
    ]);
    expect(result.up).toBe("/explorer?kind=file&view=all");
  });
  it("navigates a root item back to its workspace, without a fake folder", () => {
    expect(
      workspaceLocation({
        route: `/notes/${id}`,
        location: {
          ...location,
          ancestors: [],
          resource: { ...location.resource, parent_id: null },
        },
      }).up,
    ).toBe(folderRoute(space));
  });
  it("represents the current folder only once and uses its parent", () => {
    const result = workspaceLocation({
      route: `/explorer?space=${space}&folder=${id}`,
      location: {
        ...location,
        resource: { ...location.resource, kind: "folder" },
      },
    });
    expect(result.crumbs.at(-1)).toEqual({ label: "Derivation" });
    expect(result.up).toBe(folderRoute(space, child));
  });
  it("keeps workspace roots and special collection views navigable", () => {
    expect(
      workspaceLocation({
        route: `/explorer?space=${space}`,
        space: location.space,
      }).crumbs,
    ).toEqual([
      { label: "Explorer", to: "/explorer?view=all" },
      { label: "Physics lab" },
    ]);
    expect(
      workspaceLocation({ route: "/explorer?view=trash" }).crumbs.at(-1),
    ).toEqual({ label: "Trash" });
    expect(workspaceLocation({ route: "/admin/a/members" }).up).toBe("/groups");
    expect(
      workspaceLocation({ route: "/tools/math/new" }).crumbs.at(-1),
    ).toEqual({ label: "New math project" });
  });
});
