"use client";
import BrandMark from "../BrandMark";
import AssistantHost from "../assistant/AssistantHost";
import { openAssistant } from "../../lib/assistant";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Bell,
  LogOut,
  Menu,
  MessageSquare,
  Palette,
  Search,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type { Resource, Space } from "@axiom/shared/workspace";
import {
  api,
  cacheAvailable,
  finishPendingSignOut,
  SIGN_OUT_PENDING,
} from "../../lib/client";
import { useAppearance } from "../../lib/appearance";
import { useEditorPreferences } from "../../lib/editor-preferences";
import { tabRoute } from "@axiom/shared/application-tabs";
import { fileRoute, isFileView } from "@axiom/shared/file-routes";
import Auth from "../Auth";
import {
  setOfflineAccount,
  replayOffline,
  offlineFilesEvent,
} from "../../lib/offline-files";
import Dialog, { DialogFocusBoundary } from "../Dialog";
import WorkspaceSidebar from "./WorkspaceSidebar";
import WorkspaceSearch from "./WorkspaceSearch";
import WorkspaceProgress from "./WorkspaceProgress";
import { beginWorkspaceActivity } from "../../lib/workspace-activity";
import Avatar from "./Avatar";
import { pendingInvitation } from "../../lib/pending-invitation";
import {
  WorkspaceSessionsContext,
  useWorkspaceSessions,
} from "../../lib/workspace-sessions";
import {
  WorkspaceLocation,
  WorkspaceLauncher,
  WorkspaceStatus,
} from "./WorkspaceToolbar";
import { ManagementProvider } from "./ManagementActions";
import { FileCreationHost } from "./NewFileDialog";
import VisualViewerHost from "../VisualViewerHost";
import Uploads, { useUploads } from "./Uploads";
import dynamic from "next/dynamic";
const Workbench = dynamic(() => import("./Workbench"), {
  loading: () => <Loading label="Opening file…" />,
});
const pageLoading = () => <Loading label="Opening page…" />;
const Explorer = dynamic(() => import("./Explorer"), { loading: pageLoading });
const ResearchCollection = dynamic(() => import("./Research"), {
  loading: pageLoading,
});
const HomePage = dynamic(
  () => import("./Pages").then((module) => module.HomePage),
  { loading: pageLoading },
);
const InboxPage = dynamic(
  () => import("./Pages").then((module) => module.InboxPage),
  { loading: pageLoading },
);
const PeoplePage = dynamic(
  () => import("./Pages").then((module) => module.PeoplePage),
  { loading: pageLoading },
);
const ResearchPage = dynamic(
  () => import("./Pages").then((module) => module.ResearchPage),
  { loading: pageLoading },
);
const ProjectsPage = dynamic(
  () => import("./UnifiedWorkspace").then((m) => m.LegacyProjectRedirect),
  { loading: pageLoading },
);
const SettingsPage = dynamic(() => import("./Settings"), {
  loading: pageLoading,
});
const WorkspacesPage = dynamic(() => import("./UnifiedWorkspace"), {
  loading: pageLoading,
});
const LegacyAdministrationRedirect = dynamic(
  () => import("./GroupAdministration"),
  { loading: pageLoading },
);
const AuditPage = dynamic(() => import("./AuditPage"), {
  loading: pageLoading,
});
const TrashPage = dynamic(() => import("./TrashPage"), {
  loading: pageLoading,
});
const GroupsHub = dynamic(() => import("./GroupsHub"), {
  loading: pageLoading,
});
const GroupPlanning = dynamic(() => import("./GroupPlanning"), {
  loading: pageLoading,
});
import {
  BASE,
  ErrorNotice,
  go,
  Loading,
  type Session,
  type OpenResource,
  useData,
  useLocation,
  WorkspaceContext,
  WorkspaceLink,
} from "./ui";

export default function WorkspaceApp() {
  const [session, setSession] = useState<Session | null>(null),
    [booting, setBooting] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [sidebar, setSidebar] = useState(true),
    [searchOpen, setSearchOpen] = useState(false),
    [signout, setSignout] = useState(false),
    [offline, setOffline] = useState(false);
  const alive = useRef(true),
    bootSequence = useRef(0),
    accountMenu = useRef<HTMLDetailsElement>(null),
    appearance = useAppearance(session?.user.id),
    editorSettings = useEditorPreferences(session?.user.id),
    { parts, params } = useLocation(),
    page = parts[0] || "home",
    sessionRef = useRef(session);
  sessionRef.current = session;
  const workSessions = useWorkspaceSessions(session?.user.id, setNotice);
  const [settingsVisit, setSettingsVisit] = useState<string | null>(null);
  useEffect(() => {
    if (page === "settings" && session) setSettingsVisit(session.user.id);
    else if (!session) setSettingsVisit(null);
  }, [page, session]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []),
    data = useData<Space[]>(session ? "spaces" : null, revision),
    [cachedSpaces, setCachedSpaces] = useState<Space[]>([]),
    [cachedSpacesAccount, setCachedSpacesAccount] = useState("");
  // Retain the account's last successful list during background refreshes.
  // Dropping it temporarily made contextual creation menus permanently disabled
  // if they were opened while the current permissions request was in flight.
  const spaces =
      data.data ??
      (cachedSpacesAccount === session?.user.id ? cachedSpaces : []),
    transfers = useUploads(session?.user.id, refresh),
    [splitTarget, setSplitTarget] = useState<OpenResource | null>(null);
  const closeAccountMenu = useCallback((restoreFocus = false) => {
    const menu = accountMenu.current;
    if (!menu?.open) return;
    menu.open = false;
    if (restoreFocus)
      menu.querySelector("summary")?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !accountMenu.current?.contains(event.target)
      )
        closeAccountMenu();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && accountMenu.current?.open) {
        event.preventDefault();
        event.stopPropagation();
        closeAccountMenu(true);
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [closeAccountMenu]);
  const loadSession = useCallback(async () => {
    const sequence = ++bootSequence.current;
    try {
      if (
        localStorage.getItem(SIGN_OUT_PENDING) &&
        !(await finishPendingSignOut())
      ) {
        setSession(null);
        return;
      }
      const value = await api<Session>("me");
      if (
        !alive.current ||
        sequence !== bootSequence.current ||
        localStorage.getItem(SIGN_OUT_PENDING)
      )
        return;
      setSession(value);
      setOfflineAccount(value.user.id);
      setOffline(false);
      setError("");
      try {
        localStorage.setItem("axiom:session", JSON.stringify(value));
      } catch {
        setError(
          "Browser storage is unavailable. Keep this window open until changes sync.",
        );
      }
    } catch (error) {
      if (!alive.current || sequence !== bootSequence.current) return;
      if (cacheAvailable(error) && !localStorage.getItem(SIGN_OUT_PENDING)) {
        try {
          const cached = JSON.parse(
            localStorage.getItem("axiom:session") ?? "null",
          );
          if (cached?.user?.id) {
            setOfflineAccount(
              cached.user.id,
              JSON.parse(
                localStorage.getItem(`axiom:spaces:${cached.user.id}`) ?? "[]",
              ),
            );
            setSession(cached);
            setOffline(true);
          } else setError("Reconnect to sign in to your workspace.");
        } catch {
          setError("Reconnect to sign in to your workspace.");
        }
      } else {
        setOfflineAccount(null);
        setSession(null);
        setCachedSpaces([]);
      }
    } finally {
      if (alive.current) setBooting(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production")
      void navigator.serviceWorker
        .register("/workspace-sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() =>
          setError(
            "The offline shell could not be installed. Online work is available; reconnect and reload to retry offline setup.",
          ),
        );
    void loadSession();
    const online = () => {
        void loadSession();
        refresh();
      },
      off = () => setOffline(true),
      focus = () => {
        if (navigator.onLine) {
          void loadSession();
          refresh();
        }
      };
    const signOutOtherTab = (event: StorageEvent) => {
      if (event.key === SIGN_OUT_PENDING && event.newValue) {
        bootSequence.current++;
        setOfflineAccount(null);
        setSession(null);
        setCachedSpaces([]);
        setSplitTarget(null);
        setSearchOpen(false);
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", off);
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", focus);
    window.addEventListener("axiom:session", online);
    window.addEventListener("storage", signOutOtherTab);
    const recovery = setInterval(() => {
      if (document.visibilityState === "visible") focus();
    }, 15000);
    const media = matchMedia("(max-width: 1050px)"),
      narrow = () => {
        if (media.matches) setSidebar(false);
      };
    narrow();
    media.addEventListener("change", narrow);
    return () => {
      alive.current = false;
      clearInterval(recovery);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", off);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", focus);
      window.removeEventListener("axiom:session", online);
      window.removeEventListener("storage", signOutOtherTab);
      media.removeEventListener("change", narrow);
    };
  }, [loadSession, refresh]);
  const invitation = params.get("invite");
  useEffect(() => {
    if (!session || !invitation) return;
    pendingInvitation(invitation);
    go("/groups", true);
  }, [session?.user.id, invitation]);
  useEffect(() => {
    // Keep old bookmarks and restored tabs out of /notes/undefined and /files/undefined.
    if (["notes", "files"].includes(page) && !parts[1])
      go(tabRoute(`/${page}`), true);
  }, [page, parts[1]]);
  useEffect(() => {
    if (!session?.user.id || typeof EventSource === "undefined") return;
    const events = new EventSource("/api/v1/events");
    events.onopen = () => {
      void loadSession();
      refresh();
      window.dispatchEvent(new Event("axiom:connection-restored"));
    };
    events.onmessage = (event) => {
      refresh();
      window.dispatchEvent(new Event("axiom:workspace-invalidated"));
      try {
        if (JSON.parse(event.data).access) void loadSession();
      } catch {
        /* Ignore unknown event versions. */
      }
    };
    return () => events.close();
  }, [session?.user.id, loadSession, refresh]);
  useEffect(() => {
    if (!session?.user.id) {
      setCachedSpaces([]);
      setCachedSpacesAccount("");
      return;
    }
    try {
      setCachedSpacesAccount(session.user.id);
      setCachedSpaces(
        JSON.parse(
          localStorage.getItem(`axiom:spaces:${session.user.id}`) ?? "[]",
        ),
      );
    } catch {
      setCachedSpaces([]);
    }
  }, [session?.user.id]);
  useEffect(() => {
    if (data.data && session) {
      setOfflineAccount(session.user.id, data.data);
      setCachedSpacesAccount(session.user.id);
      setCachedSpaces(data.data);
      try {
        localStorage.setItem(
          `axiom:spaces:${session.user.id}`,
          JSON.stringify(data.data),
        );
      } catch {
        /* Online metadata remains usable. */
      }
    }
  }, [data.data, session?.user.id]);
  useEffect(() => {
    if (!session) return;
    const update = () => refresh(),
      replay = () => {
        if (navigator.onLine)
          void replayOffline(session.user.id).catch((e) => setError(e.message));
      };
    const accountQuery = (event: MessageEvent) => {
      if (event.data?.type === "axiom:offline-account-query")
        event.ports[0]?.postMessage(
          localStorage.getItem(SIGN_OUT_PENDING)
            ? null
            : (sessionRef.current?.user.id ?? null),
        );
    };
    window.addEventListener(offlineFilesEvent, update);
    window.addEventListener("axiom:workspace-refresh", update);
    window.addEventListener("online", replay);
    navigator.serviceWorker?.addEventListener("message", accountQuery);
    const timer = setInterval(replay, 15000);
    replay();
    return () => {
      window.removeEventListener(offlineFilesEvent, update);
      window.removeEventListener("axiom:workspace-refresh", update);
      window.removeEventListener("online", replay);
      navigator.serviceWorker?.removeEventListener("message", accountQuery);
      clearInterval(timer);
    };
  }, [session?.user.id]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector("dialog[open]")
      )
        return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !(event.target as HTMLElement)?.closest(".cm-editor")
      ) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", listener);
    const search = () => setSearchOpen(true);
    window.addEventListener("axiom:search", search);
    return () => {
      window.removeEventListener("keydown", listener);
      window.removeEventListener("axiom:search", search);
    };
  }, []);
  useEffect(() => {
    closeAccountMenu();
  }, [parts.join("/"), params.toString(), closeAccountMenu]);
  const navigate = useCallback((path: string) => {
    go(path);
  }, []);
  const opening = useRef(0);
  const open = useCallback((resource: OpenResource, split = false) => {
    const sequence = ++opening.current;
    const origin = location.href;
    const account = sessionRef.current?.user.id;
    const show = (item: OpenResource) => {
      if (
        sequence !== opening.current ||
        location.href !== origin ||
        sessionRef.current?.user.id !== account
      )
        return;
      if (
        split &&
        item.kind !== "folder" &&
        isFileView(location.pathname.slice(BASE.length).split("/")[1])
      )
        setSplitTarget(item);
      else go(fileRoute(item, resource.versionId));
    };
    if (
      resource.kind === "shortcut" ||
      (resource.kind === "folder" && !resource.space_id)
    ) {
      const finish = beginWorkspaceActivity();
      void api<Resource>(
        `resources/${resource.id}${resource.kind === "shortcut" ? "/resolve" : ""}`,
      )
        .then(show)
        .catch((error) => {
          if (sequence === opening.current && location.href === origin)
            setError(error.message);
        })
        .finally(finish);
    } else show(resource);
  }, []);
  useEffect(() => {
    if (page === "tools")
      go(tabRoute(location.pathname + location.search), true);
  }, [page]);
  const finishSignout = async () => {
    if (!session) return;
    const userId = session.user.id;
    localStorage.setItem(SIGN_OUT_PENDING, crypto.randomUUID());
    setOfflineAccount(null);
    bootSequence.current++;
    setSession(null);
    setCachedSpaces([]);
    setSignout(false);
    pendingInvitation("");
    setSplitTarget(null);
    setSearchOpen(false);
    window.dispatchEvent(
      new CustomEvent("axiom:close-documents", { detail: userId }),
    );
    for (const key of Object.keys(localStorage))
      if (
        key === "axiom:session" ||
        key === "axiom:appearance" ||
        (key.startsWith("axiom:") && key.includes(userId))
      )
        localStorage.removeItem(key);
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const database of await indexedDB.databases())
      if (database.name?.startsWith(`axiom:${userId}:`))
        indexedDB.deleteDatabase(database.name);
    go("/home", true);
    if (!(await finishPendingSignOut()))
      setError(
        "Signed out locally. Reconnect to finish server-session revocation.",
      );
  };
  if (booting)
    return (
      <div className="ws-boot">
        <BrandMark />
        <Loading label="Opening your research workspace…" />
      </div>
    );
  if (
    !session ||
    params.has("reset") ||
    (params.has("reset-flow") && params.has("token"))
  )
    return (
      <>
        <ErrorNotice message={error} retry={() => void loadSession()} />
        <Auth
          onSignedIn={() => void loadSession()}
          onPasswordReset={() => {
            bootSequence.current++;
            setSession(null);
            setCachedSpaces([]);
          }}
        />
      </>
    );
  const workbench = isFileView(page) && !!parts[1];
  return (
    <WorkspaceContext.Provider
      value={{
        session,
        spaces,
        revision,
        refresh,
        refreshSession: loadSession,
        navigate,
        open,
        upload: transfers.add,
        appearance,
        editorSettings,
        notify: setNotice,
      }}
    >
      <WorkspaceSessionsContext.Provider value={workSessions}>
        <DialogFocusBoundary
          className={`ws-app ${sidebar ? "sidebar-open" : ""}`}
        >
          <ManagementProvider>
            <VisualViewerHost />
            <FileCreationHost />
            <a className="ws-skip-link" href="#workspace-content">
              Skip to workspace content
            </a>
            <header className="ws-appbar">
              <WorkspaceProgress />
              <div className="ws-brand-area">
                <button
                  className="icon-button"
                  aria-label="Toggle workspace sidebar"
                  aria-expanded={sidebar}
                  onClick={() => setSidebar(!sidebar)}
                >
                  <Menu size={19} />
                </button>
                <WorkspaceLink
                  to="/home"
                  className="brand"
                  aria-label="Axiom home"
                >
                  <BrandMark />
                  <span>
                    Axiom<span className="brand-dot">.</span>
                  </span>
                </WorkspaceLink>
              </div>
              <WorkspaceLocation />
              <button
                className="workspace-command-trigger"
                aria-label="Search workspace"
                title="Search & commands · ⌘/Ctrl K"
                onClick={() => setSearchOpen(true)}
              >
                <Search size={16} />
                <span>Search & commands</span>
                <kbd>⌘/Ctrl K</kbd>
              </button>
              <div className="ws-app-tools">
                <button
                  className="icon-button"
                  aria-label="Open research assistant"
                  title="Research assistant"
                  onClick={() => openAssistant()}
                >
                  <MessageSquare size={18} />
                </button>
                <WorkspaceStatus offline={offline} />
                <WorkspaceLink
                  className="icon-button"
                  to="/inbox"
                  aria-label="Open inbox"
                  title="Inbox · Mentions and reviews"
                >
                  <Bell size={18} />
                </WorkspaceLink>
                <button
                  className="icon-button"
                  aria-label="File transfers"
                  onClick={() => transfers.setShown(!transfers.shown)}
                >
                  <Upload size={18} />
                  {transfers.transfers.some((item) =>
                    ["uploading", "queued", "verifying"].includes(item.status),
                  ) && <span className="ws-notification-dot" />}
                </button>
                <details
                  ref={accountMenu}
                  className="ws-menu ws-account-menu"
                  name="workspace-toolbar-popover"
                >
                  <summary aria-label="Account menu">
                    <Avatar
                      person={session.user}
                      className="ws-account-avatar"
                    />
                    <ChevronDown size={12} />
                  </summary>
                  <div
                    onClick={(event) => {
                      // The shell stays mounted across navigation, including
                      // selecting the current page. Dismiss on activation too.
                      if (
                        event.target instanceof Element &&
                        event.target.closest("a, button")
                      )
                        closeAccountMenu(true);
                    }}
                  >
                    <p>
                      <strong>{session.user.name}</strong>
                      <small>{session.user.email}</small>
                    </p>
                    <WorkspaceLink to="/settings/profile">
                      <UserRound size={16} />
                      Account settings
                    </WorkspaceLink>
                    <WorkspaceLink to="/settings/appearance">
                      <Palette size={16} />
                      Appearance & editor
                    </WorkspaceLink>
                    {session.groups.some((group) =>
                      ["owner", "admin"].includes(group.role),
                    ) && (
                      <WorkspaceLink to="/workspaces">
                        <Users size={16} />
                        Manage workspaces
                      </WorkspaceLink>
                    )}
                    <div className="action-menu-separator" role="separator" />
                    <button type="button" onClick={() => setSignout(true)}>
                      <LogOut size={16} />
                      Sign out
                    </button>
                  </div>
                </details>
              </div>
            </header>
            {offline && (
              <div className="ws-offline" role="status">
                Offline · Open cached notes remain available. File management
                and planning changes need a connection.
              </div>
            )}
            <div className="ws-body">
              {sidebar && (
                <>
                  <button
                    className="ws-sidebar-scrim"
                    tabIndex={-1}
                    aria-label="Close navigation"
                    onClick={() => setSidebar(false)}
                  />
                  <aside
                    className="ws-sidebar"
                    aria-label="Workspace navigation"
                  >
                    <div className="ws-sidebar-heading">
                      <span>Workspace</span>
                      <button
                        className="icon-button"
                        aria-label="Collapse sidebar"
                        onClick={() => setSidebar(false)}
                      >
                        <Menu size={16} />
                      </button>
                    </div>
                    <div className="ws-sidebar-scroll">
                      <WorkspaceSidebar key={session.user.id} />
                    </div>
                  </aside>
                </>
              )}
              <div id="workspace-content" className="ws-content" tabIndex={-1}>
                <ErrorNotice
                  message={error || data.error}
                  retry={
                    data.error
                      ? data.reload
                      : error
                        ? () => setError("")
                        : undefined
                  }
                />
                {(page === "settings" || settingsVisit === session.user.id) && (
                  <SettingsPage
                    active={page === "settings"}
                    section={
                      page === "settings"
                        ? parts[1]
                        : workSessions.state.sessions
                            .find((tab) => tab.path.startsWith("/settings"))
                            ?.path.split(/[/?]/)[2]
                    }
                  />
                )}
                {page === "settings" ? null : page === "new" ? (
                  <WorkspaceLauncher />
                ) : workbench ? (
                  <Workbench
                    key={session.user.id}
                    resource={{
                      kind: page === "notes" ? "note" : "file",
                      id: parts[1],
                      viewId: workSessions.state.active,
                      versionId: params.get("version") ?? undefined,
                      route:
                        location.pathname.slice(BASE.length) +
                        location.search +
                        location.hash,
                    }}
                    splitTarget={splitTarget}
                    onSplitHandled={() => setSplitTarget(null)}
                  />
                ) : page === "tools" ? (
                  <Loading label="Opening Explorer…" />
                ) : page === "home" ? (
                  <HomePage />
                ) : page === "explorer" ? (
                  <Explorer />
                ) : page === "projects" ? (
                  <ProjectsPage id={parts[1]} section={parts[2]} />
                ) : page === "research" ? (
                  parts[1] === "references" || parts[1] === "graph" ? (
                    <ResearchCollection view={parts[1]} />
                  ) : (
                    <ResearchPage />
                  )
                ) : page === "inbox" ? (
                  <InboxPage />
                ) : page === "people" ? (
                  <PeoplePage />
                ) : page === "groups" ? (
                  parts[1] && parts[2] === "planning" ? (
                    <GroupPlanning id={parts[1]} />
                  ) : (
                    <GroupsHub />
                  )
                ) : page === "workspaces" ? (
                  <WorkspacesPage
                    id={parts[1]}
                    section={parts[2]}
                    setting={parts[3]}
                  />
                ) : page === "audit" ? (
                  <AuditPage />
                ) : page === "trash" ? (
                  <TrashPage />
                ) : page === "admin" ? (
                  <LegacyAdministrationRedirect
                    groupId={parts[1]}
                    section={parts[2]}
                  />
                ) : (
                  <HomePage />
                )}
              </div>
              <AssistantHost />
            </div>
            {notice && (
              <div className="ws-notice" role="status">
                <span>{notice}</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss notification"
                  onClick={() => setNotice("")}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <Uploads controller={transfers} />
            {searchOpen && (
              <WorkspaceSearch onClose={() => setSearchOpen(false)} />
            )}
            {signout && (
              <Dialog
                title="Sign out of this device?"
                subtitle="Account caches and offline copies will be removed from this browser."
                onClose={() => setSignout(false)}
              >
                <p>
                  Make sure your notes show “Saved” first. If you have
                  unsynchronized work, cancel and export it before signing out.
                  Other devices’ offline copies are not affected.
                </p>
                <div className="dialog-footer">
                  <button
                    className="button secondary"
                    onClick={() => setSignout(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="button primary"
                    onClick={() =>
                      void finishSignout().catch((error) =>
                        setError(error.message),
                      )
                    }
                  >
                    Sign out and clear caches
                  </button>
                </div>
              </Dialog>
            )}
          </ManagementProvider>
        </DialogFocusBoundary>
      </WorkspaceSessionsContext.Provider>
    </WorkspaceContext.Provider>
  );
}
