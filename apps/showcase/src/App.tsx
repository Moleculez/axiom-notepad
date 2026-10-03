import { Button, IconButton } from "../../web/components/ui/controls";
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BookOpen,
  PenLine,
  Network,
  Palette,
  Github,
  Upload,
  Plus,
  FolderOpen,
  Download,
  X,
  Check,
  FileText,
} from "lucide-react";
import {
  appearanceVariables,
  resolvedDark,
  type Preferences,
} from "@axiom/shared/appearance";
import Dialog, {
  DialogFocusBoundary,
  DialogFooter,
} from "../../web/components/Dialog";
import MathRendering from "../../web/components/MathRendering";
import { runtimeAsset } from "../../web/lib/runtime-assets";
import { downloadBlob } from "../../web/lib/tools/download";
import {
  Demo,
  localRenderContext,
  store,
  useSnapshot,
  type Destination,
} from "./context";
import { canvasId, researchId } from "./samples";
import Tour from "./Tour";
import ShowcaseSettings from "./ShowcaseSettings";

const Editor = lazy(() => import("./Editor"));
const Canvas = lazy(() => import("./Canvas"));
const FileViewer = lazy(() => import("./FileViewer"));
const VisualHost = lazy(() => import("./VisualHost"));
const nav = [
  { id: "tour", label: "Discover", icon: BookOpen },
  { id: "editor", label: "Editor", icon: PenLine },
  { id: "canvas", label: "Canvas", icon: Network },
] as const;
function route() {
  const [destination, ...params] = location.hash.slice(1).split("&");
  return {
    destination: (nav.some((n) => n.id === destination)
      ? destination
      : "tour") as Destination,
    id: new URLSearchParams(params.join("&")).get("note"),
  };
}
class Boundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="demo-failure">
        <h1>This view could not load</h1>
        <p>Your locally saved drafts are intact. Reload to retry.</p>
        <Button variant="primary" onClick={() => location.reload()}>
          Reload showcase
        </Button>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const snapshot = useSnapshot(),
    appearance = snapshot.appearance;
  const [locationState, setLocationState] = useState(route),
    [settings, setSettings] = useState(false),
    [files, setFiles] = useState(false),
    [fileId, setFileId] = useState<string | null>(null),
    [toast, setToast] = useState("");
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const input = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dark = resolvedDark(appearance, systemDark);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5500);
  }, []);
  const navigate = useCallback((destination: Destination, id?: string) => {
    window.dispatchEvent(new Event("axiom:route"));
    location.hash = `${destination}${id ? `&note=${id}` : ""}`;
  }, []);
  const open = useCallback(
    (id: string) => {
      const doc = store.document(id);
      if (doc) {
        store.select(id);
        navigate(doc.kind === "canvas" ? "canvas" : "editor", id);
      } else if (store.getSnapshot().assets.some((a) => a.id === id))
        setFileId(id);
      else
        notify(
          "This note is not in the local demo. Import it or create a new note.",
        );
    },
    [navigate, notify],
  );
  const changeAppearance = useCallback(
    (change: Partial<Preferences>) =>
      store.appearance({ ...store.getSnapshot().appearance, ...change }),
    [],
  );
  const renderContext = useCallback(() => localRenderContext(dark), [dark]);
  const host = useMemo(
    () => ({ dark, notify, navigate, open, changeAppearance, renderContext }),
    [dark, notify, navigate, open, changeAppearance, renderContext],
  );
  useEffect(() => {
    void store.load();
    const handle = () => setLocationState(route());
    window.addEventListener("hashchange", handle);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    const save = () => {
      void store.flush();
    };
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (!store.hasUnsavedContent()) return;
      void store.flush();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", save);
    window.addEventListener("beforeunload", warnUnsaved);
    document.addEventListener("visibilitychange", save);
    return () => {
      window.removeEventListener("hashchange", handle);
      media.removeEventListener("change", update);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", warnUnsaved);
      document.removeEventListener("visibilitychange", save);
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(
      appearanceVariables(appearance, dark),
    ))
      root.style.setProperty(key, value);
    Object.assign(root.dataset, {
      theme: dark ? "dark" : "light",
      themePack: appearance.themePack,
      interfaceStyle: appearance.interfaceStyle,
      motion: appearance.motion,
      density: appearance.density,
      focus: String(appearance.focusMode),
      documentDecorations: appearance.documentDecorations,
    });
  }, [appearance, dark]);
  const selected =
    snapshot.documents.find(
      (d) =>
        d.id === locationState.id &&
        (locationState.destination === "canvas"
          ? d.kind === "canvas"
          : d.kind !== "canvas"),
    ) ??
    snapshot.documents.find(
      (d) =>
        d.id ===
          (locationState.destination === "canvas"
            ? canvasId
            : snapshot.active) &&
        (locationState.destination === "canvas"
          ? d.kind === "canvas"
          : d.kind !== "canvas"),
    ) ??
    snapshot.documents.find((d) => d.id === researchId);
  const importFiles = async (files: File[]) => {
    try {
      const result = await store.importFiles(files);
      if (result[0]) {
        setFiles(false);
        setSettings(false);
        open(result[0].id);
      }
      notify(
        `${result.length} local file${result.length === 1 ? "" : "s"} imported.`,
      );
    } catch (error) {
      notify((error as Error).message);
    }
  };
  return (
    <Demo.Provider value={host}>
      <DialogFocusBoundary className="showcase-app">
        <Boundary>
          <a
            className="skip-link"
            href="#showcase-content"
            onClick={(event) => {
              event.preventDefault();
              document.getElementById("showcase-content")?.focus();
            }}
          >
            Skip to content
          </a>
          <header className="demo-header">
            <a className="demo-brand" href="#tour" aria-label="Axiom home">
              <img
                src={runtimeAsset("brand/mark-mineral.svg")}
                alt=""
                width="30"
                height="30"
              />
              <strong>Axiom</strong>
              <span>live showcase</span>
            </a>
            <nav aria-label="Showcase pages">
              {nav.map(({ id, label, icon: Icon }) => (
                <a
                  key={id}
                  href={`#${id}${id === "editor" ? `&note=${snapshot.active}` : ""}`}
                  aria-current={
                    locationState.destination === id ? "page" : undefined
                  }
                >
                  <Icon size={15} />
                  {label}
                </a>
              ))}
            </nav>
            <div className="demo-header-actions">
              <span className="demo-local-badge">
                <span />
                Local-first demo
              </span>
              <IconButton
                className="icon-button"
                title="Local files"
                aria-label="Local files"
                onClick={() => setFiles(true)}
              >
                <FolderOpen size={17} />
              </IconButton>
              <IconButton
                className="icon-button"
                title="Appearance"
                aria-label="Appearance"
                onClick={() => setSettings(true)}
              >
                <Palette size={17} />
              </IconButton>
              <a
                className="icon-button"
                href="https://github.com/Moleculez/axiom-notepad"
                target="_blank"
                rel="noopener noreferrer"
                title="Source on GitHub"
                aria-label="Source on GitHub"
              >
                <Github size={17} />
              </a>
            </div>
          </header>
          {snapshot.error && (
            <div className="demo-storage-warning" role="alert">
              {snapshot.error}
            </div>
          )}
          <div
            id="showcase-content"
            tabIndex={-1}
            className={`demo-content ${locationState.destination === "tour" ? "is-tour" : ""}`}
          >
            {!snapshot.ready ? (
              <Loading />
            ) : locationState.destination === "tour" ? (
              <Tour />
            ) : (
              <Suspense fallback={<Loading />}>
                {selected &&
                  (locationState.destination === "canvas" ? (
                    <Canvas key={selected.id} document={selected} />
                  ) : (
                    <Editor key={selected.id} document={selected} />
                  ))}
              </Suspense>
            )}
          </div>
          <MathRendering />
          <Suspense fallback={null}>
            {(locationState.destination !== "tour" || fileId) && <VisualHost />}
            {fileId && (
              <FileViewer id={fileId} onClose={() => setFileId(null)} />
            )}
          </Suspense>
          {toast && (
            <div className="demo-toast" role="status">
              <Check size={16} />
              <span>{toast}</span>
              <IconButton
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setToast("")}
              >
                <X size={14} />
              </IconButton>
            </div>
          )}
          <input
            hidden
            ref={input}
            type="file"
            multiple
            accept=".md,.markdown,.txt,.tex,.canvas,.zip,image/*,application/pdf,audio/*,video/*"
            onChange={(event) => {
              void importFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          {files && (
            <Dialog
              title="Files on this device"
              subtitle="Private demo drafts and uploads, stored only in this browser. Browser storage is not a backup."
              onClose={() => setFiles(false)}
              size="wide"
            >
              <div className="demo-file-actions">
                <Button
                  className="button secondary"
                  onClick={() => input.current?.click()}
                >
                  <Upload size={15} />
                  Import files
                </Button>
                <Button
                  className="button secondary"
                  onClick={() => {
                    const doc = store.create();
                    setFiles(false);
                    open(doc.id);
                  }}
                >
                  <Plus size={15} />
                  New note
                </Button>
                <Button
                  className="button secondary"
                  onClick={() => {
                    const doc = store.create(
                      "Untitled canvas",
                      "canvas",
                      '{"nodes":[],"edges":[]}',
                    );
                    setFiles(false);
                    open(doc.id);
                  }}
                >
                  <Network size={15} />
                  New canvas
                </Button>
              </div>
              <div className="demo-file-list">
                {snapshot.documents.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => {
                      setFiles(false);
                      open(doc.id);
                    }}
                  >
                    <span className="demo-file-symbol">
                      {doc.kind === "canvas" ? (
                        <Network size={18} />
                      ) : (
                        <FileText size={18} />
                      )}
                    </span>
                    <span>
                      <strong>{doc.title}</strong>
                      <small>
                        {doc.kind} ·{" "}
                        {new Date(doc.modified).toLocaleDateString()}
                      </small>
                    </span>
                    <span className="demo-file-open">Open →</span>
                  </button>
                ))}
                {snapshot.assets.map((asset) => (
                  <div key={asset.id}>
                    <button
                      onClick={() => {
                        setFiles(false);
                        open(asset.id);
                      }}
                    >
                      <FolderOpen size={18} />
                      <span>
                        <strong>{asset.name}</strong>
                        <small>
                          {asset.mime} · {(asset.blob.size / 1024).toFixed(1)}{" "}
                          KB
                        </small>
                      </span>
                    </button>
                    <IconButton
                      className="icon-button"
                      aria-label={`Download ${asset.name}`}
                      onClick={() => downloadBlob(asset.blob, asset.name)}
                    >
                      <Download size={16} />
                    </IconButton>
                  </div>
                ))}
              </div>
              <p className="demo-fineprint">
                Up to 100 MB per upload; notes and Canvas files up to 5 MB.
                Local file cards preview images, PDFs, audio and video. Remote
                images remain placeholders until you import them.
              </p>
              <DialogFooter>
                <Button
                  className="button secondary"
                  onClick={async () => {
                    try {
                      const { portableBundle } = await import("./exports");
                      downloadBlob(
                        await portableBundle(),
                        "axiom-showcase-backup.zip",
                      );
                      notify("Local backup downloaded.");
                    } catch (error) {
                      notify((error as Error).message);
                    }
                  }}
                >
                  Back up all local files
                </Button>
                <Button variant="primary" onClick={() => setFiles(false)}>
                  Done
                </Button>
              </DialogFooter>
            </Dialog>
          )}
          {settings && (
            <ShowcaseSettings
              onClose={() => setSettings(false)}
              onImport={() => input.current?.click()}
            />
          )}
        </Boundary>
      </DialogFocusBoundary>
    </Demo.Provider>
  );
}
export function Loading() {
  return (
    <div className="demo-loading" role="status">
      <span className="demo-loading-dot" />
      Opening your thinking space…
    </div>
  );
}
