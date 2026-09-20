"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AlertCircle,
  File,
  FileImage,
  FileText,
  Folder,
  LoaderCircle,
  RefreshCw,
  Link2,
  Network,
  Sigma,
  Braces,
} from "lucide-react";
import type { Resource, Space } from "@axiom/shared/workspace";
import type { useAppearance } from "../../lib/appearance";
import type { useEditorPreferences } from "../../lib/editor-preferences";
import { api, ApiError, errorMessage } from "../../lib/client";
import { sharedRequest } from "../../lib/shared-request";

export type Session = {
  user: { id: string; name: string; email: string; image?: string | null };
  emailAvailable: boolean;
  groups: { id: string; name: string; description: string; role: string }[];
};
export type WorkspaceContextValue = {
  session: Session;
  spaces: Space[];
  revision: number;
  appearance: ReturnType<typeof useAppearance>;
  editorSettings: ReturnType<typeof useEditorPreferences>;
  refresh: () => void;
  refreshSession?: () => Promise<void>;
  navigate: (path: string) => void;
  open: (resource: OpenResource, split?: boolean) => void;
  upload: (
    files: File[],
    spaceId: string,
    parentId?: string | null,
    resourceId?: string,
  ) => void;
  notify: (message: string) => void;
};
export type OpenResource = Pick<Resource, "id" | "kind"> & {
  route?: string;
  name?: string;
  mime?: string | null;
  space_id?: string;
  parent_id?: string | null;
  document_type?: Resource["document_type"];
  versionId?: string;
};
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(
  null,
);
export const useWorkspace = () => {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace context missing");
  return value;
};
export const BASE = "/workbench";
const locationEvent = "axiom:navigate";
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener("hashchange", listener);
  window.addEventListener(locationEvent, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener("hashchange", listener);
    window.removeEventListener(locationEvent, listener);
  };
}
export function go(path: string, replace = false, bypassGuard = false) {
  const destination = path.startsWith(BASE)
    ? path
    : BASE + (path.startsWith("/") ? path : "/" + path);
  if (destination === location.pathname + location.search + location.hash)
    return;
  if (
    !bypassGuard &&
    !window.dispatchEvent(
      new CustomEvent("axiom:before-navigate", {
        cancelable: true,
        detail: { destination, proceed: () => go(path, replace, true) },
      }),
    )
  )
    return;
  const previous = location.pathname + location.search + location.hash;
  const state = destination.startsWith(BASE + "/settings")
    ? {
        axiomSettingsReturn: previous.startsWith(BASE + "/settings")
          ? history.state?.axiomSettingsReturn
          : previous,
      }
    : null;
  history[replace ? "replaceState" : "pushState"](state, "", destination);
  window.dispatchEvent(
    new CustomEvent("axiom:route", { detail: { destination, replace } }),
  );
  window.dispatchEvent(new Event(locationEvent));
}
export function useLocation() {
  const path = useSyncExternalStore(
    subscribe,
    () => location.pathname + location.search + location.hash,
    () => BASE,
  );
  const url = new URL(path, "http://workspace.local");
  return {
    path: url.pathname.replace(new RegExp("^" + BASE), "") || "/home",
    parts: url.pathname.slice(BASE.length).split("/").filter(Boolean),
    params: url.searchParams,
    hash: url.hash,
  };
}
export function WorkspaceLink({
  to,
  children,
  className,
  ...props
}: Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
}) {
  return (
    <a
      {...props}
      href={BASE + to}
      className={className}
      onClick={(event) => {
        props.onClick?.(event);
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          go(to);
        }
      }}
    >
      {children}
    </a>
  );
}
export function useData<T = any>(path: string | null, revision = 0) {
  const workspace = useContext(WorkspaceContext);
  const account = workspace?.session.user.id ?? "bootstrap";
  const [state, setState] = useState<{
    data: T | null;
    error: string;
    loading: boolean;
    path: string | null;
    account: string;
  }>({ data: null, error: "", loading: !!path, path, account });
  const [retry, setRetry] = useState(0);
  const reload = useCallback(() => setRetry((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    if (!path) {
      setState({ data: null, error: "", loading: false, path, account });
      return;
    }
    setState((previous) => ({
      data:
        previous.path === path && previous.account === account
          ? previous.data
          : null,
      loading: true,
      error:
        previous.path === path && previous.account === account
          ? previous.error
          : "",
      path,
      account,
    }));
    const request = sharedRequest<T>(account, path, revision, retry);
    void request.promise
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ data, loading: false, error: "", path, account });
      })
      .catch((error) => {
        if (!controller.signal.aborted && error?.name !== "AbortError") {
          // Background outages must not unmount a loaded tree. Retain only this
          // account/path's data; authoritative access/deletion errors clear it.
          const transient =
            error instanceof TypeError ||
            (error instanceof ApiError &&
              (error.status >= 500 || error.status === 429));
          setState((previous) => ({
            data:
              transient &&
              previous.path === path &&
              previous.account === account
                ? previous.data
                : null,
            loading: false,
            error: error.message,
            path,
            account,
          }));
        }
      });
    return () => {
      controller.abort();
      request.release();
    };
  }, [path, revision, retry, account]);
  const current = state.path === path && state.account === account;
  return {
    data: current ? state.data : null,
    error: current ? state.error : "",
    loading: current ? state.loading : !!path,
    path,
    reload,
  };
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      if (alive.current) setError(errorMessage(error));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
export const mutate = <T = any,>(
  path: string,
  input: unknown,
  method = "POST",
) =>
  api<T>(path, {
    method,
    body: JSON.stringify({
      mutationId: crypto.randomUUID(),
      ...(input as object),
    }),
  });
export function ErrorNotice({
  message,
  retry,
}: {
  message?: string;
  retry?: () => void;
}) {
  if (!message) return null;
  return (
    <div className="ws-error" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
      {retry && (
        <button className="button secondary" onClick={retry}>
          <RefreshCw size={15} />
          Retry
        </button>
      )}
    </div>
  );
}
export function Loading({ label = "Loading workspace…" }: { label?: string }) {
  return (
    <div className="ws-loading" role="status">
      <LoaderCircle className="spin" size={20} />
      <span>{label}</span>
    </div>
  );
}
export function Empty({
  icon: Icon = Folder,
  title,
  children,
  action,
}: {
  icon?: typeof Folder;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="ws-empty">
      <span className="ws-empty-icon">
        <Icon size={27} strokeWidth={1.35} />
      </span>
      <h3>{title}</h3>
      <div className="ws-empty-description">{children}</div>
      {action}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="ws-page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 tabIndex={-1}>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="ws-actions">{actions}</div>}
    </header>
  );
}
export function ResourceIcon({
  resource,
  size = 20,
}: {
  resource: Pick<Resource, "kind" | "mime" | "document_type">;
  size?: number;
}) {
  const Icon =
    resource.document_type === "canvas"
      ? Network
      : resource.document_type === "math"
        ? Sigma
        : resource.document_type === "text"
          ? Braces
          : resource.document_type === "image"
            ? FileImage
            : resource.kind === "shortcut"
              ? Link2
              : resource.kind === "folder"
                ? Folder
                : resource.kind === "note"
                  ? FileText
                  : resource.mime?.startsWith("image/")
                    ? FileImage
                    : File;
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" />;
}
export function bytes(value?: number | string | null) {
  const n = Number(value ?? 0);
  if (n < 1000) return n + " B";
  const order = Math.min(3, Math.floor(Math.log10(n) / 3));
  return (
    (n / 1000 ** order).toLocaleString(undefined, {
      maximumFractionDigits: 1,
    }) +
    " " +
    ["B", "KB", "MB", "GB"][order]
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span className="ws-badge" data-tone={tone}>
      {children}
    </span>
  );
}
