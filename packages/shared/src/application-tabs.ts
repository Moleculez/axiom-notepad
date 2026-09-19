import {
  fileViewRoutes,
  isFileView,
  normalizeFileRoute,
  fileRouteId,
} from "./file-routes";
/** Device-local navigation metadata only. Never persist invitation/security tokens. */
export type ApplicationTab = {
  id: string;
  path: string;
  title?: string;
  pinned?: boolean;
  group?: string;
  history: string[];
  index: number;
  view?: Record<string, unknown>;
};
export type ApplicationTabs = {
  version: 2;
  tabs: ApplicationTab[];
  active: string;
  closed: ApplicationTab[];
};
/** Only bounded presentation metadata may leave the in-memory view cache. */
export function safeApplicationView(
  input: unknown,
): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object") return;
  const value = input as Record<string, unknown>,
    view: Record<string, unknown> = {};
  for (const [key, choices] of Object.entries({
    layout: ["list", "grid"],
    sort: ["name", "updated", "size"],
    direction: ["asc", "desc"],
    mode: ["write", "source", "read"],
    panel: [
      "outline",
      "comments",
      "references",
      "equations",
      "bookmarks",
      null,
    ],
  }))
    if (choices.includes(value[key] as string)) view[key] = value[key];
  if (typeof value.scroll === "number" && Number.isFinite(value.scroll))
    view.scroll = Math.max(0, Math.min(100_000_000, value.scroll));
  if (
    typeof value.planningScroll === "number" &&
    Number.isFinite(value.planningScroll)
  )
    view.planningScroll = Math.max(
      0,
      Math.min(100_000_000, value.planningScroll),
    );
  if (Array.isArray(value.selection))
    view.selection = value.selection
      .filter((id) => typeof id === "string" && /^[\da-f-]{36}$/i.test(id))
      .slice(0, 200);
  if (Array.isArray(value.columns))
    view.columns = value.columns.filter((key) =>
      ["updated", "size", "kind"].includes(key),
    );
  return Object.keys(view).length ? view : undefined;
}
const sections = new Set([
  ...fileViewRoutes,
  "home",
  "explorer",
  "projects",
  "research",
  "tools",
  "inbox",
  "people",
  "groups",
  "workspaces",
  "audit",
  "trash",
  "settings",
  "admin",
  "notes",
  "files",
  "new",
]);
const queries = new Set([
  "create",
  "space",
  "folder",
  "view",
  "q",
  "kind",
  "sort",
  "direction",
  "version",
  "file",
  "section",
  "groupId",
  "projectId",
  "status",
  "tag",
  "mime",
  "after",
  "before",
  "minSize",
  "maxSize",
  "operation",
  "actor",
  "action",
  "entity",
  "task",
  "assignee",
  "priority",
  "milestone",
  "zoom",
  "deleted",
]);
export function tabRoute(input: string): string {
  try {
    const url = new URL(input, "http://workspace.local");
    if (url.origin !== "http://workspace.local") return "/home";
    let path = url.pathname.replace(/^\/workbench(?=\/|$)/, "") || "/home";
    if (!sections.has(path.split("/")[1])) return "/home";
    const params = new URLSearchParams();
    for (const [key, value] of url.searchParams)
      if (queries.has(key) && value.length <= 500) params.set(key, value);
    path = normalizeFileRoute(path, params);
    if (/^\/(notes|files)\/?$/.test(path)) {
      params.set("kind", path.startsWith("/notes") ? "note" : "file");
      params.set("view", "all");
      params.delete("folder");
      params.delete("version");
      path = "/explorer";
    }
    if (isFileView(path.split("/")[1]) && !path.split("/")[2])
      path = "/explorer";
    params.sort();
    const anchor =
      fileRouteId(path) && /^#[\w%:.-]{1,200}$/.test(url.hash) ? url.hash : "";
    return path + (params.size ? `?${params}` : "") + anchor;
  } catch {
    return "/home";
  }
}
export function tabTitle(path: string) {
  const route = tabRoute(path),
    section = route.split(/[/?]/)[1];
  if (section === "explorer") {
    const params = new URL(route, "http://workspace.local").searchParams,
      view = params.get("view");
    if (view === "trash") return "Trash";
    if (view === "favorites") return "Favorites";
    if (view === "recent") return "Recent";
    if (view === "all" && params.get("kind") === "note")
      return "Research notes";
    if (view === "all" && params.get("kind") === "file") return "Files";
    return "Explorer";
  }
  if (section === "tools") {
    const [, , kind, id] = route.split(/[/?]/);
    if (kind === "viewer") return "File viewer";
    if (kind === "canvas") return id === "new" ? "New canvas" : "Canvas";
    if (kind === "text") return id === "new" ? "New text file" : "Text editor";
    if (kind === "math")
      return id === "new" ? "New math project" : "Math Studio";
    if (kind === "image")
      return id === "new" ? "New image project" : "Image Studio";
    return "Research tools";
  }
  return (
    (
      {
        home: "Home",
        projects: "Projects",
        research: "Research",
        tools: "Research tools",
        inbox: "Inbox",
        people: "People",
        groups: "Groups",
        workspaces: "Workspaces",
        audit: "Audit",
        trash: "Trash",
        settings: "Settings",
        admin: "Group administration",
        notes: "Research note",
        files: "File",
        canvas: "Canvas",
        math: "Math",
        text: "Text",
        image: "Image",
        audio: "Audio",
        video: "Video",
        pdf: "PDF",
        document: "Document",
        new: "New tab",
      } as Record<string, string>
    )[section] ?? "Home"
  );
}
export function newApplicationTab(path: string, id: string): ApplicationTab {
  path = tabRoute(path);
  return { id, path, history: [path], index: 0 };
}
export function navigateApplicationTab(
  tab: ApplicationTab,
  path: string,
  replace = false,
): ApplicationTab {
  path = tabRoute(path);
  if (path === tab.path) return tab;
  const history = replace
    ? [
        ...tab.history.slice(0, tab.index),
        path,
        ...tab.history.slice(tab.index + 1),
      ]
    : [...tab.history.slice(0, tab.index + 1), path].slice(-50);
  return {
    ...tab,
    path,
    title: undefined,
    view: undefined,
    history,
    index: replace ? tab.index : history.length - 1,
  };
}
export function restoreApplicationTabs(
  raw: unknown,
  legacy: unknown,
  initial: string,
  id: () => string,
): ApplicationTabs {
  const saved = raw as Partial<ApplicationTabs> | null;
  const clean = (input: unknown): ApplicationTab | null => {
    if (!input || typeof input !== "object") return null;
    const t = input as ApplicationTab;
    if (
      typeof t.id !== "string" ||
      t.id.length > 100 ||
      typeof t.path !== "string"
    )
      return null;
    const history = (Array.isArray(t.history) ? t.history : [t.path])
      .filter((p): p is string => typeof p === "string")
      .slice(-50)
      .map(tabRoute);
    if (!history.length) history.push(tabRoute(t.path));
    const index = Math.max(
      0,
      Math.min(
        history.length - 1,
        Number.isInteger(t.index) ? t.index : history.length - 1,
      ),
    );
    // Persist only presentation enums, positions and resource identities, never drafts.
    return {
      id: t.id,
      path: history[index],
      history,
      index,
      pinned: t.pinned === true,
      group: typeof t.group === "string" ? t.group.slice(0, 40) : undefined,
      view: safeApplicationView(t.view),
    };
  };
  let tabs =
    saved?.version === 2 && Array.isArray(saved.tabs)
      ? saved.tabs
          .map(clean)
          .filter((t): t is ApplicationTab => !!t)
          .slice(0, 40)
      : [];
  tabs = tabs.filter(
    (tab, i) =>
      tabs.findIndex((t) => t.id === tab.id) === i &&
      (!tab.path.startsWith("/settings") ||
        tabs.findIndex((t) => t.path.startsWith("/settings")) === i),
  );
  if (!tabs.length && Array.isArray(legacy)) {
    tabs = legacy
      .filter(
        (t) =>
          t &&
          /^[\da-f-]{36}$/i.test(t.id) &&
          ["note", "file"].includes(t.kind),
      )
      .slice(0, 20)
      .map((t) =>
        newApplicationTab(
          `/${t.kind === "note" ? "notes" : "files"}/${t.id}${/^[\da-f-]{36}$/i.test(t.versionId) ? `?version=${t.versionId}` : ""}`,
          id(),
        ),
      );
  }
  const current =
    tabs.find((t) => t.path === tabRoute(initial)) ??
    newApplicationTab(initial, id());
  if (!tabs.includes(current)) tabs.push(current);
  return {
    version: 2,
    tabs,
    active: current.id,
    closed:
      saved?.version === 2 && Array.isArray(saved.closed)
        ? saved.closed
            .map(clean)
            .filter((t): t is ApplicationTab => !!t)
            .slice(-20)
        : [],
  };
}
