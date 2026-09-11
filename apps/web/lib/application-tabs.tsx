"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  newApplicationTab,
  navigateApplicationTab,
  restoreApplicationTabs,
  safeApplicationView,
  tabRoute,
  type ApplicationTab,
  type ApplicationTabs,
} from "@axiom/shared/application-tabs";
import { closeDocument } from "./document-sessions";
import { go, BASE } from "../components/workspace/ui";

export function useApplicationTabs(
  account: string | undefined,
  notify: (text: string) => void,
) {
  const [state, setState] = useState<ApplicationTabs>({
    version: 2,
    tabs: [],
    active: "",
    closed: [],
  });
  const ref = useRef(state),
    ready = useRef("");
  const commit = useCallback(
    (next: ApplicationTabs) => {
      ref.current = next;
      setState(next);
      if (ready.current)
        try {
          localStorage.setItem(
            `axiom:application-tabs:${ready.current}`,
            JSON.stringify({
              ...next,
              tabs: next.tabs.map(({ view, title: _title, ...tab }) => ({
                ...tab,
                view: safeApplicationView(view),
              })),
              closed: next.closed.map(({ view, title: _title, ...tab }) => ({
                ...tab,
                view: safeApplicationView(view),
              })),
            }),
          );
        } catch {
          notify(
            "Your tabs could not be saved on this device. Documents are unaffected.",
          );
        }
    },
    [notify],
  );
  useEffect(() => {
    ready.current = account ?? "";
    if (!account) {
      commit({ version: 2, tabs: [], active: "", closed: [] });
      return;
    }
    let raw: unknown, legacy: unknown;
    try {
      raw = JSON.parse(
        localStorage.getItem(`axiom:application-tabs:${account}`) ?? "null",
      );
      legacy = JSON.parse(
        localStorage.getItem(`axiom:tabs:${account}`) ?? "null",
      );
    } catch {
      /* Corrupt navigation metadata cannot affect work. */
    }
    commit(
      restoreApplicationTabs(
        raw,
        legacy,
        location.pathname + location.search,
        () => crypto.randomUUID(),
      ),
    );
    const route = (event: Event) => {
      const detail = (
        event as CustomEvent<{ destination: string; replace: boolean }>
      ).detail;
      const current = ref.current;
      const path = tabRoute(detail.destination);
      const active = current.tabs.find((t) => t.id === current.active);
      const exact =
        current.tabs.find((t) => t.id === current.active && t.path === path) ??
        current.tabs.find((t) => t.path === path);
      const section = path.split(/[/?]/)[1];
      const existing =
        exact ??
        (section === "settings"
          ? current.tabs.find((t) => t.path.startsWith("/settings"))
          : undefined);
      const within =
        active &&
        (detail.replace ||
          active.path === "/new" ||
          ([
            "explorer",
            "projects",
            "research",
            "admin",
            "settings",
            "workspaces",
            "audit",
            "trash",
          ].includes(section) &&
            active.path.split(/[/?]/)[1] === section));
      const target =
        detail.replace && active
          ? active
          : (existing ?? (within ? active : undefined));
      if (target)
        commit({
          ...current,
          active: target.id,
          tabs: current.tabs.map((t) =>
            t.id === target.id
              ? navigateApplicationTab(t, path, detail.replace)
              : t,
          ),
        });
      else if (current.tabs.length < 40) {
        const next = newApplicationTab(path, crypto.randomUUID());
        commit({ ...current, tabs: [...current.tabs, next], active: next.id });
      } else if (active) {
        commit({
          ...current,
          tabs: current.tabs.map((t) =>
            t.id === active.id ? navigateApplicationTab(t, path) : t,
          ),
        });
        notify(
          "40 tabs are open. This location was opened in the current tab.",
        );
      }
    };
    const pop = () =>
      route(
        new CustomEvent("route", {
          detail: {
            destination: location.pathname + location.search,
            replace: false,
          },
        }),
      );
    window.addEventListener("axiom:route", route);
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("axiom:route", route);
      window.removeEventListener("popstate", pop);
      ready.current = "";
    };
  }, [account, commit, notify]);
  const guard = (path: string, proceed: () => void) =>
    window.dispatchEvent(
      new CustomEvent("axiom:before-navigate", {
        cancelable: true,
        detail: { destination: BASE + tabRoute(path), proceed },
      }),
    );
  const select = (id: string, bypass = false) => {
    const tab = ref.current.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (
      !bypass &&
      id !== ref.current.active &&
      !guard(tab.path, () => select(id, true))
    )
      return;
    commit({ ...ref.current, active: id });
    go(tab.path, false, true);
  };
  const update = (
    id: string,
    patch: Partial<Pick<ApplicationTab, "title" | "pinned" | "group" | "view">>,
  ) => {
    const tab = ref.current.tabs.find((t) => t.id === id);
    if (
      !tab ||
      Object.entries(patch).every(
        ([key, value]) => tab[key as keyof ApplicationTab] === value,
      )
    )
      return;
    commit({
      ...ref.current,
      tabs: ref.current.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  };
  const create = (path = "/new", duplicate = false, bypass = false) => {
    if (path.startsWith("/settings")) {
      go(path);
      return;
    }
    if (!bypass && !guard(path, () => create(path, duplicate, true))) return;
    if (ref.current.tabs.length >= 40) {
      notify(
        "Close a tab before opening another. Up to 40 app tabs can be kept.",
      );
      return;
    }
    const tab = newApplicationTab(path, crypto.randomUUID());
    if (!duplicate) {
      const existing = ref.current.tabs.find((t) => t.path === path);
      if (existing) {
        select(existing.id);
        return;
      }
    }
    commit({
      ...ref.current,
      tabs: [...ref.current.tabs, tab],
      active: tab.id,
    });
    go(path, false, true);
  };
  const close = (id: string, bypass = false) => {
    const current = ref.current,
      tab = current.tabs.find((t) => t.id === id);
    if (!tab) return;
    if (
      !bypass &&
      id === current.active &&
      !tab.path.startsWith("/settings") &&
      !guard(current.tabs.find((t) => t.id !== id)?.path ?? "/new", () =>
        close(id, true),
      )
    )
      return;
    if (
      !bypass &&
      tab.path.startsWith("/settings") &&
      !window.dispatchEvent(
        new CustomEvent("axiom:close-settings", {
          cancelable: true,
          detail: { proceed: () => close(id, true) },
        }),
      )
    )
      return;
    const note = /^\/notes\/([\da-f-]{36})(?:\?|$)/i.exec(tab.path)?.[1];
    if (
      note &&
      !current.tabs.some(
        (t) => t.id !== id && t.path.startsWith(`/notes/${note}`),
      ) &&
      account &&
      !closeDocument(account, note)
    ) {
      notify(
        "This note has edits that are not saved on this device. Export or synchronize them before closing.",
      );
      return;
    }
    let tabs = current.tabs.filter((t) => t.id !== id);
    if (!tabs.length) tabs = [newApplicationTab("/new", crypto.randomUUID())];
    const active =
      id === current.active
        ? tabs[Math.min(current.tabs.indexOf(tab), tabs.length - 1)].id
        : current.active;
    commit({
      ...current,
      tabs,
      active,
      closed: [...current.closed, tab].slice(-20),
    });
    if (id === current.active)
      go(tabs.find((t) => t.id === active)!.path, false, true);
  };
  const closeAll = () => {
    const owner = ready.current,
      targets = new Set(ref.current.tabs.map((tab) => tab.id)),
      previousActive = ref.current.active;
    if (!owner || !targets.size) return;
    const finish = () => {
      if (ready.current !== owner) return;
      const current = ref.current,
        noteId = (tab: ApplicationTab) =>
          /^\/notes\/([\da-f-]{36})(?:\?|$)/i.exec(tab.path)?.[1],
        retained = current.tabs.filter((tab) => !targets.has(tab.id)),
        notes = new Set(
          current.tabs.filter((tab) => targets.has(tab.id)).map(noteId),
        ),
        blocked = new Set<string>();
      // Close each document session only once, and keep every tab for a note
      // whose edits have not reached durable local storage.
      for (const note of notes)
        if (
          note &&
          !retained.some((tab) => noteId(tab) === note) &&
          !closeDocument(owner, note)
        )
          blocked.add(note);
      if (blocked.size)
        notify(
          "Some notes have edits that are not saved on this device. Their tabs stayed open; export or synchronize them before closing.",
        );
      const closed = current.tabs.filter(
        (tab) => targets.has(tab.id) && !blocked.has(noteId(tab) ?? ""),
      );
      if (!closed.length) return;
      const closedIds = new Set(closed.map((tab) => tab.id));
      let tabs = current.tabs.filter((tab) => !closedIds.has(tab.id));
      if (!tabs.length) tabs = [newApplicationTab("/new", crypto.randomUUID())];
      const active = tabs.find((tab) => tab.id === current.active) ?? tabs[0];
      commit({
        ...current,
        tabs,
        active: active.id,
        // Reopen the previously active page first, including its pin/group.
        closed: [
          ...current.closed,
          ...closed.filter((tab) => tab.id !== previousActive),
          ...closed.filter((tab) => tab.id === previousActive),
        ].slice(-20),
      });
      if (active.id !== current.active) go(active.path, false, true);
    };
    const confirmSettings = () => {
      if (ready.current !== owner) return;
      if (
        ref.current.tabs.some(
          (tab) => targets.has(tab.id) && tab.path.startsWith("/settings"),
        ) &&
        !window.dispatchEvent(
          new CustomEvent("axiom:close-settings", {
            cancelable: true,
            detail: { proceed: finish },
          }),
        )
      )
        return;
      finish();
    };
    // Resolve navigation and retained Settings drafts before removing any tabs.
    // A pending confirmation must never close tabs opened later or another account's tabs.
    if (guard("/new", confirmSettings)) confirmSettings();
  };
  const reopen = () => {
    const tab = ref.current.closed.at(-1);
    if (!tab || ref.current.tabs.length >= 40) return;
    if (
      tab.path.startsWith("/settings") &&
      ref.current.tabs.some((t) => t.path.startsWith("/settings"))
    ) {
      go(tab.path);
      return;
    }
    commit({
      ...ref.current,
      tabs: [...ref.current.tabs, { ...tab, id: crypto.randomUUID() }],
      closed: ref.current.closed.slice(0, -1),
    });
    select(ref.current.tabs.at(-1)!.id);
  };
  const back = (direction: -1 | 1, bypass = false) => {
    const tab = ref.current.tabs.find((t) => t.id === ref.current.active);
    if (!tab || !tab.history[tab.index + direction]) return;
    if (
      !bypass &&
      !guard(tab.history[tab.index + direction], () => back(direction, true))
    )
      return;
    const next = {
      ...tab,
      index: tab.index + direction,
      path: tab.history[tab.index + direction],
      title: undefined,
      view: undefined,
    };
    commit({
      ...ref.current,
      tabs: ref.current.tabs.map((t) => (t.id === tab.id ? next : t)),
    });
    go(next.path, false, true);
  };
  const reorder = (id: string, before: string) => {
    const tabs = [...ref.current.tabs],
      item = tabs.find((t) => t.id === id);
    if (!item || id === before) return;
    tabs.splice(tabs.indexOf(item), 1);
    tabs.splice(
      Math.max(
        0,
        tabs.findIndex((t) => t.id === before),
      ),
      0,
      item,
    );
    commit({ ...ref.current, tabs });
  };
  const replace = (id: string, path: string, expectedPath?: string) => {
    // Async creation belongs to its originating tab. If the user switched or
    // closed it while waiting, never overwrite whichever page is active now.
    if (ready.current !== account) return false;
    const current = ref.current,
      target = current.tabs.find((t) => t.id === id);
    if (!target || (expectedPath && target.path !== tabRoute(expectedPath)))
      return false;
    const next = navigateApplicationTab(target, path, true);
    commit({
      ...current,
      tabs: current.tabs.map((t) => (t.id === id ? next : t)),
    });
    if (current.active === id) go(next.path, true, true);
    return true;
  };
  return {
    state,
    active: state.tabs.find((t) => t.id === state.active),
    select,
    update,
    create,
    close,
    closeAll,
    reopen,
    back,
    reorder,
    replace,
  };
}
type TabsController = ReturnType<typeof useApplicationTabs>;
export const ApplicationTabsContext = createContext<TabsController | null>(
  null,
);
export const useAppTabs = () => useContext(ApplicationTabsContext);
export function publishTabTitle(path: string, title: string) {
  window.dispatchEvent(
    new CustomEvent("axiom:tab-title", {
      detail: { path: tabRoute(path), title },
    }),
  );
}
export { BASE };
