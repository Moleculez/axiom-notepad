"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { tabRoute } from "@axiom/shared/application-tabs";
import { fileRouteId } from "@axiom/shared/file-routes";
import {
  emptyWorkspaceSessions,
  restoreWorkspaceSessions,
  serializeWorkspaceSessions,
  visitWorkspace,
  type WorkspaceSession,
  type WorkspaceSessions,
} from "@axiom/shared/workspace-sessions";
import { go } from "../components/workspace/ui";

export function useWorkspaceSessions(
  account: string | undefined,
  notify: (text: string) => void,
) {
  const [state, setState] = useState(emptyWorkspaceSessions);
  const ref = useRef(state),
    ready = useRef(""),
    hydrated = useRef(""),
    traversal = useRef<number | null>(null);
  const commit = useCallback(
    (next: WorkspaceSessions) => {
      ref.current = next;
      setState(next);
      if (ready.current) {
        try {
          localStorage.setItem(
            `axiom:workspace-sessions:${ready.current}`,
            serializeWorkspaceSessions(next),
          );
        } catch {
          notify(
            "Recent work could not be saved on this device. Documents are unaffected.",
          );
        }
      }
    },
    [notify],
  );
  useEffect(() => {
    ready.current = account ?? "";
    if (!account) {
      hydrated.current = "";
      commit(emptyWorkspaceSessions());
      return;
    }
    if (hydrated.current !== account) {
      const read = (key: string) => {
        try {
          return JSON.parse(localStorage.getItem(key) ?? "null");
        } catch {
          return null;
        }
      };
      commit(
        restoreWorkspaceSessions(
          read(`axiom:workspace-sessions:${account}`),
          read(`axiom:application-tabs:${account}`),
          read(`axiom:tabs:${account}`),
          location.pathname + location.search + location.hash,
          () => crypto.randomUUID(),
        ),
      );
      hydrated.current = account;
    }
    const route = (event: Event) => {
      const { destination, replace } = (
        event as CustomEvent<{ destination: string; replace: boolean }>
      ).detail;
      const mode = traversal.current ?? (replace ? "replace" : "push");
      traversal.current = null;
      commit(
        visitWorkspace(
          ref.current,
          destination,
          () => crypto.randomUUID(),
          mode,
        ),
      );
    };
    const pop = () => {
      const path = tabRoute(
          location.pathname + location.search + location.hash,
        ),
        current = ref.current;
      const matches = current.history
        .map((entry, index) => (entry === path ? index : -1))
        .filter((index) => index >= 0 && index !== current.index);
      const nearest = matches.sort(
        (a, b) => Math.abs(a - current.index) - Math.abs(b - current.index),
      )[0];
      commit(
        visitWorkspace(
          current,
          path,
          () => crypto.randomUUID(),
          nearest ?? "push",
        ),
      );
    };
    const title = (event: Event) => {
      const { path, title } = (
        event as CustomEvent<{ path: string; title: string }>
      ).detail;
      if (
        !ref.current.sessions.some(
          (item) => item.path === path && item.title !== title,
        )
      )
        return;
      commit({
        ...ref.current,
        sessions: ref.current.sessions.map((item) =>
          item.path === path ? { ...item, title } : item,
        ),
      });
    };
    const canonical = (event: Event) => {
      const { from, to } = (event as CustomEvent<{ from: string; to: string }>)
        .detail;
      if (!fileRouteId(from) || fileRouteId(from) !== fileRouteId(to)) return;
      const current = ref.current;
      commit({
        ...current,
        sessions: current.sessions.map((item) =>
          item.id === current.active && item.path === tabRoute(from)
            ? { ...item, path: tabRoute(to) }
            : item,
        ),
        history: current.history.map((path) =>
          path === tabRoute(from) ? tabRoute(to) : path,
        ),
      });
    };
    window.addEventListener("axiom:route", route);
    window.addEventListener("popstate", pop);
    window.addEventListener("axiom:tab-title", title);
    window.addEventListener("axiom:canonical-file", canonical);
    return () => {
      ready.current = "";
      window.removeEventListener("axiom:route", route);
      window.removeEventListener("popstate", pop);
      window.removeEventListener("axiom:tab-title", title);
      window.removeEventListener("axiom:canonical-file", canonical);
    };
  }, [account, commit]);
  const select = (id: string) => {
    const item = ref.current.sessions.find((item) => item.id === id);
    if (item) go(item.path);
  };
  const update = (
    id: string,
    patch: Partial<Pick<WorkspaceSession, "title" | "pinned" | "view">>,
  ) => {
    const current = ref.current,
      item = current.sessions.find((item) => item.id === id);
    if (
      patch.pinned &&
      !item?.pinned &&
      current.sessions.filter((entry) => entry.pinned).length >= 20
    ) {
      notify(
        "Keep up to 20 pinned destinations. Unpin one before adding another.",
      );
      return;
    }
    if (
      !item ||
      Object.entries(patch).every(
        ([key, value]) => item[key as keyof WorkspaceSession] === value,
      )
    )
      return;
    commit({
      ...current,
      sessions: current.sessions.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  };
  const back = (direction: -1 | 1) => {
    const current = ref.current,
      index = current.index + direction,
      path = current.history[index];
    if (!path) return;
    const proceed = () => {
      if (ready.current !== account) return;
      if (
        location.pathname + location.search + location.hash ===
        `/workbench${path}`
      ) {
        commit(
          visitWorkspace(ref.current, path, () => crypto.randomUUID(), index),
        );
        traversal.current = null;
        return;
      }
      traversal.current = index;
      go(path, true, true);
    };
    if (
      window.dispatchEvent(
        new CustomEvent("axiom:before-navigate", {
          cancelable: true,
          detail: { destination: `/workbench${path}`, proceed },
        }),
      )
    )
      proceed();
  };
  return {
    state,
    active: state.sessions.find((item) => item.id === state.active),
    select,
    update,
    back,
  };
}
export const WorkspaceSessionsContext = createContext<ReturnType<
  typeof useWorkspaceSessions
> | null>(null);
export const useWorkSessions = () => useContext(WorkspaceSessionsContext);
export function publishSessionTitle(path: string, title: string) {
  window.dispatchEvent(
    new CustomEvent("axiom:tab-title", {
      detail: { path: tabRoute(path), title },
    }),
  );
}
