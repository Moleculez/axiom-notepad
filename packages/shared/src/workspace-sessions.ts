import {
  restoreApplicationTabs,
  safeApplicationView,
  tabRoute,
} from "./application-tabs";
import { fileRouteId } from "./file-routes";

/** Navigation metadata only. Document drafts and undo live in document sessions. */
export type WorkspaceSession = {
  id: string;
  path: string;
  title?: string;
  pinned?: boolean;
  view?: Record<string, unknown>;
};
export type WorkspaceSessions = {
  version: 1;
  sessions: WorkspaceSession[]; // oldest to most recently visited
  active: string;
  history: string[];
  index: number;
};
export const emptyWorkspaceSessions = (): WorkspaceSessions => ({
  version: 1,
  sessions: [],
  active: "",
  history: [],
  index: -1,
});
const sessionKey = (path: string) => {
  const url = new URL(path, "http://workspace.local");
  if (/^\/settings(?:\/|$)/.test(url.pathname)) return "/settings";
  // Filters and task/section anchors change the view, not the mounted session.
  // In particular, a debounced search must never remount its focused input.
  const identity = new URLSearchParams();
  const keys = fileRouteId(path)
    ? ["version"]
    : ["space", "folder", ...(url.pathname === "/explorer" ? ["view"] : [])];
  for (const key of keys)
    if (url.searchParams.has(key))
      identity.set(key, url.searchParams.get(key)!);
  return url.pathname + (identity.size ? `?${identity}` : "");
};

export function visitWorkspace(
  state: WorkspaceSessions,
  destination: string,
  id: () => string,
  mode: "push" | "replace" | number = "push",
): WorkspaceSessions {
  const path = tabRoute(destination);
  const existing = state.sessions.find(
    (item) => sessionKey(item.path) === sessionKey(path),
  );
  const session: WorkspaceSession = existing
    ? { ...existing, path }
    : { id: id(), path };
  let history = [...state.history],
    index = state.index;
  if (typeof mode === "number" && history[mode] === path) index = mode;
  else if (mode === "replace" && index >= 0) history[index] = path;
  else if (history[index] !== path) {
    history = [...history.slice(0, index + 1), path].slice(-100);
    index = history.length - 1;
  }
  const sessions = [
    ...state.sessions.filter((item) => item.id !== session.id),
    session,
  ];
  // Bound metadata, not documents: eviction must never discard local drafts or undo.
  while (sessions.length > 100) {
    const oldest = sessions.findIndex(
      (item) => !item.pinned && item.id !== session.id,
    );
    sessions.splice(oldest < 0 ? 0 : oldest, 1);
  }
  return { version: 1, sessions, active: session.id, history, index };
}

export function restoreWorkspaceSessions(
  input: unknown,
  oldTabs: unknown,
  legacy: unknown,
  initial: string,
  id: () => string,
): WorkspaceSessions {
  const raw = input as Partial<WorkspaceSessions> | null;
  let sessions: WorkspaceSession[] = [];
  if (raw?.version === 1 && Array.isArray(raw.sessions)) {
    for (const item of raw.sessions.slice(-100)) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !item.id ||
        item.id.length > 100 ||
        typeof item.path !== "string"
      )
        continue;
      const path = tabRoute(item.path);
      if (
        sessions.some(
          (entry) =>
            entry.id === item.id || sessionKey(entry.path) === sessionKey(path),
        )
      )
        continue;
      sessions.push({
        id: item.id,
        path,
        pinned: item.pinned === true,
        view: safeApplicationView(item.view),
      });
    }
  } else {
    sessions = restoreApplicationTabs(oldTabs, legacy, initial, id).tabs.map(
      ({ id, path, pinned, view }) => ({ id, path, pinned, view }),
    );
    sessions = sessions.filter(
      (item, index) =>
        sessions.findIndex(
          (other) => sessionKey(item.path) === sessionKey(other.path),
        ) === index,
    );
  }
  // Browser history belongs to this browsing lifetime, not another window/device.
  return visitWorkspace({ ...emptyWorkspaceSessions(), sessions }, initial, id);
}

export function serializeWorkspaceSessions(state: WorkspaceSessions) {
  return JSON.stringify({
    version: 1,
    sessions: state.sessions.map(({ id, path, pinned, view }) => ({
      id,
      path: tabRoute(path),
      pinned: pinned === true,
      view: safeApplicationView(view),
    })),
  });
}
