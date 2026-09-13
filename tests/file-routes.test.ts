import { describe, expect, it } from "vitest";
import {
  fileRoute,
  fileRouteId,
  fileViewKind,
} from "@axiom/shared/file-routes";
import {
  restoreApplicationTabs,
  tabRoute,
} from "@axiom/shared/application-tabs";
import { workspaceLocation } from "@axiom/shared/workspace-location";
const id = "01234567-1234-1234-1234-123456789abc";
describe("file-first routes", () => {
  it.each([
    ["image/png", "image"],
    ["video/mp4", "video"],
    ["audio/mpeg", "audio"],
    ["application/pdf", "pdf"],
    ["text/plain", "text"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "document",
    ],
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "document",
    ],
    ["application/vnd.axiom.image+zip", "image"],
    ["application/octet-stream", "files"],
  ])("classifies %s as %s", (mime, type) => {
    expect(fileRoute({ id, kind: "file", mime }, "pinned")).toBe(
      `/${type}/${id}?version=pinned`,
    );
  });
  it.each(["markdown", "canvas", "math", "image", "text"] as const)(
    "resolves %s by document metadata",
    (type) => {
      expect(
        fileViewKind({
          id,
          kind: "note",
          document_type: type,
          mime: "video/mp4",
        }),
      ).toBe(type === "markdown" ? "notes" : type);
    },
  );
  it("does not turn an uploaded Markdown file into an editable document", () => {
    const resource = {
      id,
      kind: "file" as const,
      name: "paper.md",
      mime: "text/markdown",
    };
    expect(fileRoute(resource)).toBe(`/notes/${id}`);
    expect(resource.kind).toBe("file");
  });
  it("migrates old tools links and strips credentials, preserving versions and anchors", () => {
    expect(tabRoute(`/workbench/tools/canvas/${id}?token=secret#node-1`)).toBe(
      `/canvas/${id}#node-1`,
    );
    expect(tabRoute("/tools/image/new?file=f&version=v&space=s")).toBe(
      "/explorer?create=image&file=f&space=s&version=v",
    );
    expect(tabRoute("/tools/viewer")).toBe("/explorer");
    expect(fileRouteId(`/workbench/video/${id}?version=v`)).toBe(id);
    expect(fileRouteId("/canvas/new")).toBeNull();
  });
  it("preserves restored tab identity and view state during pure route migration", () => {
    const raw = {
      version: 2,
      active: "a",
      closed: [],
      tabs: [
        {
          id: "a",
          path: `/tools/math/${id}`,
          history: [`/tools/math/${id}`],
          index: 0,
          pinned: true,
          group: "Research",
          view: { mode: "source" },
        },
      ],
    };
    const restored = restoreApplicationTabs(
      raw,
      null,
      `/math/${id}`,
      () => "new",
    );
    expect(restored.tabs).toHaveLength(1);
    expect(restored.tabs[0]).toMatchObject({
      id: "a",
      path: `/math/${id}`,
      pinned: true,
      group: "Research",
      view: { mode: "source" },
    });
  });
  it.each(["canvas", "math", "image", "video", "pdf", "text"])(
    "uses real hierarchy for %s",
    (kind) => {
      const result = workspaceLocation({
        route: `/${kind}/${id}`,
        location: {
          resource: {
            id,
            name: "Experiment",
            kind: "file",
            space_id: "s",
            parent_id: "folder",
          },
          space: { id: "s", name: "Lab", kind: "team" },
          ancestors: [{ id: "folder", name: "Results", kind: "folder" }],
        },
      });
      expect(result.crumbs.map((crumb) => crumb.label)).toEqual([
        "Explorer",
        "Lab",
        "Results",
        "Experiment",
      ]);
      expect(result.up).toBe("/explorer?space=s&folder=folder");
    },
  );
});
