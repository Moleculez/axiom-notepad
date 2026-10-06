import {
  Button,
  IconButton,
  NativeSelect,
  TextInput,
  SearchField,
} from "../../web/components/ui/controls";
import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
const MindmapSurface = lazy(
  () => import("../../web/components/mindmap/MindmapSurface"),
);
import * as Y from "yjs";
import { NativeBinding } from "@axiom/editor/binding";
import { documentStatistics, parseMarkdown } from "@axiom/markdown";
import { editorAppearanceKey } from "@axiom/shared/minimap";
import { AxiomEditorView } from "../../web/lib/editor-vnext/view";
import { useDocumentNavigation } from "../../web/lib/document-navigation";
import { sectionAtPosition, type OutlineHeading } from "../../web/lib/outline";
import { installMarkdownVisuals } from "../../web/lib/visual-surface";
import DocumentMinimap from "../../web/components/DocumentMinimap";
import ReadingView from "../../web/components/ReadingView";
import TableOfContents from "../../web/components/TableOfContents";
import ResizablePanel from "../../web/components/ResizablePanel";
import Dialog, { DialogFooter } from "../../web/components/Dialog";
import { confirmAction } from "../../web/lib/app-prompt";
import { downloadText } from "../../web/lib/tools/download";
import {
  Copy,
  Download,
  List,
  Map,
  RotateCcw,
  Plus,
  Upload,
  Image,
  Paperclip,
  FileCode2,
  Printer,
  FileText,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import { store, useDemo, useSnapshot } from "./context";
import { safeName, markdownPath, type LocalDocument } from "./store";
import { renderedHtml } from "./exports";

type Mode = "write" | "source" | "read";
type Bookmark = ReturnType<NativeBinding["relative"]>;
export default function Editor({
  document: initial,
  defaultMap = false,
}: {
  document: LocalDocument;
  defaultMap?: boolean;
}) {
  const snapshot = useSnapshot(),
    { dark, notify, open, navigate, renderContext, changeAppearance } =
      useDemo(),
    appearance = snapshot.appearance;
  const doc = snapshot.documents.find((d) => d.id === initial.id) ?? initial;
  const [source, setSource] = useState(doc.source),
    [mapBinding, setMapBinding] = useState<NativeBinding | null>(null),
    [map, setMap] = useState(defaultMap),
    [mode, setMode] = useState<Mode>(doc.kind === "text" ? "source" : "write"),
    [outline, setOutline] = useState(true),
    [section, setSection] = useState<string | null>(null),
    [collapsed, setCollapsed] = useState<string[]>([]),
    [assetDialog, setAssetDialog] = useState(false),
    [assetQuery, setAssetQuery] = useState(""),
    [tableDialog, setTableDialog] = useState(false),
    [rows, setRows] = useState(3),
    [columns, setColumns] = useState(3),
    [exporting, setExporting] = useState(false),
    [exportBusy, setExportBusy] = useState(false);
  const mount = useRef<HTMLDivElement>(null),
    view = useRef<AxiomEditorView | null>(null),
    bindingRef = useRef<NativeBinding | null>(null),
    prepared = useRef<Bookmark | null>(null),
    uploadInput = useRef<HTMLInputElement>(null),
    exportStage = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => parseMarkdown(source), [source]),
    statistics = useMemo(
      () => documentStatistics(parsed, source),
      [parsed, source],
    );
  const current = useRef({
    appearance,
    mode,
    renderContext,
    notify,
    preferences: snapshot.editor,
    headings: parsed.outline,
  });
  current.current = {
    appearance,
    mode,
    renderContext,
    notify,
    preferences: snapshot.editor,
    headings: parsed.outline,
  };
  const adapter = useMemo(
    () => ({
      geometry: () => view.current?.navigationGeometry() ?? [],
      snapshot: () => view.current?.navigationSnapshot() ?? null,
      position: (at: number) => view.current?.navigationPosition(at) ?? null,
      focus: (at?: number) => {
        view.current?.focus(at);
      },
    }),
    [],
  );
  const navigation = useDocumentNavigation(
    mount,
    adapter,
    doc.id,
    source,
    mode,
    !map && (appearance.minimap.enabled || outline),
  );
  useEffect(() => setMap(defaultMap), [defaultMap]);
  useEffect(() => {
    if (!mount.current) return;
    const ydoc = new Y.Doc(),
      text = ydoc.getText("markdown");
    text.insert(0, store.document(initial.id)?.source ?? "");
    const undo = new Y.UndoManager(text),
      binding = new NativeBinding(ydoc, undo, null);
    bindingRef.current = binding;
    setMapBinding(binding);
    const editor = new AxiomEditorView(mount.current, binding, {
      mode: () => current.current.mode,
      preferences: () => current.current.preferences,
      appearance: () => current.current.appearance,
      context: () => current.current.renderContext(),
      readOnly: () => current.current.mode === "read",
      workspace: (command) => {
        if (command === "source")
          setMode((old) => (old === "source" ? "write" : "source"));
        else if (command === "outline") setOutline((old) => !old);
        else if (command === "minimap") {
          const p = store.getSnapshot().appearance;
          store.appearance({
            ...p,
            minimap: { ...p.minimap, enabled: !p.minimap.enabled },
          });
        } else if (command === "table") setTableDialog(true);
        else if (
          ["image", "attachment", "pdf", "audio", "video"].includes(command)
        )
          setAssetDialog(true);
        else
          current.current.notify(
            "This action needs the full workbench. Editing, local files and exports work here without an account.",
          );
      },
      message: (message) => current.current.notify(message),
      recover: () =>
        current.current.notify(
          "Download your Markdown or reset the example. Your local draft is retained.",
        ),
      prepare: (range) => {
        prepared.current = binding.relative(
          range ? { anchor: range.from, head: range.to } : editor.selection,
        );
      },
      navigate: (position) =>
        setSection(sectionAtPosition(current.current.headings, position)),
      link: (target) => {
        const local = store
          .getSnapshot()
          .documents.find(
            (d) =>
              d.id === target || d.title.toLowerCase() === target.toLowerCase(),
          );
        let path = target;
        try {
          path = decodeURIComponent(target);
        } catch {
          /* Keep malformed links inert. */
        }
        const asset = store.getSnapshot().assets.find((a) => a.path === path);
        if (local || asset) open((local ?? asset)!.id);
        else if (/^https?:\/\//i.test(target))
          window.open(target, "_blank", "noopener,noreferrer");
        else if (target.startsWith("#"))
          mount.current
            ?.querySelector(`[id="${CSS.escape(target.slice(1))}"]`)
            ?.scrollIntoView({ block: "center" });
        else
          current.current.notify(
            "Import the linked note or attachment to open it in this local demo.",
          );
      },
      changed: (value) => {
        setSource(value);
        store.update(initial.id, value);
      },
      notes: () =>
        store
          .getSnapshot()
          .documents.filter((d) => d.kind === "markdown")
          .map((d) => ({ id: d.id, title: d.title })),
      files: (files, range) => {
        prepared.current = binding.relative(
          range ? { anchor: range.from, head: range.to } : editor.selection,
        );
        void insertFiles(files);
      },
    });
    editor.setLabel("Research Markdown editor", "showcase-editor");
    view.current = editor;
    const changed = binding.subscribe((value) => {
      setSource(value);
      store.update(initial.id, value);
    });
    const closeVisuals = installMarkdownVisuals(editor.dom, {
      parsed: () => editor.parsed,
      source: () => editor.source,
      binding,
      selection: () => editor.selection,
      captureRestore: () => {
        const bookmark = binding.relative(editor.selection);
        return () => {
          const at = binding.absolute(bookmark);
          if (at && editor.dom.isConnected) editor.focus(at.anchor, at.head);
        };
      },
      editorMenu: (x, y, at) =>
        editor.openBlockMenu(x, y, { anchor: at, head: at }),
    });
    return () => {
      changed();
      setMapBinding(null);
      closeVisuals();
      view.current = null;
      bindingRef.current = null;
      editor.destroy();
      undo.destroy();
      ydoc.destroy();
    };
  }, [initial.id]);
  useEffect(() => {
    view.current?.configure();
  }, [
    mode,
    editorAppearanceKey(appearance),
    dark,
    snapshot.assets.length,
    snapshot.editor,
  ]);
  useEffect(() => {
    setSection(
      sectionAtPosition(parsed.outline, view.current?.selection.head ?? 0),
    );
  }, [parsed]);
  const navigateSection = (heading: OutlineHeading) => {
    setSection(heading.id);
    const root = mount.current;
    if (!root) return;
    if (mode !== "read") adapter.focus(heading.from);
    // Focus may put the caret at the bottom; scrollIntoView can instead stack
    // document scroll-margin and pane scroll-padding (differently in Firefox).
    // Use the actual mapped heading and one inset in all three projections.
    const point =
      mode === "read"
        ? root
            .querySelector(
              `.axiom-editor-content [id="${CSS.escape(heading.id)}"]`,
            )
            ?.getBoundingClientRect()
        : view.current?.navigationPosition(heading.from);
    if (point)
      root.scrollTo({
        top: root.scrollTop + point.top - root.getBoundingClientRect().top - 32,
        behavior: "instant",
      });
  };
  const followScroll = () => {
    const root = mount.current;
    if (!root || mode === "read") return;
    const top = root.getBoundingClientRect().top + 50;
    const position = view.current?.visiblePosition(top);
    if (position != null)
      setSection(sectionAtPosition(parsed.outline, position));
  };
  useEffect(() => {
    if (mode === "read" && navigation.blocks.length)
      setSection(
        sectionAtPosition(
          parsed.outline,
          navigation.index.sourceAt(navigation.scroll + 50),
        ),
      );
    // The shared geometry subscription settles after rendering, fonts and theme
    // changes, including scroll anchoring that precedes the ordinary scroll event.
    // Reuse its index rather than scanning heading DOM for every reading scroll.
  }, [mode, parsed.outline, navigation.index, navigation.scroll]);
  const prepare = () => {
    const binding = bindingRef.current;
    if (binding && view.current)
      prepared.current = binding.relative(view.current.selection);
  };
  const insert = (value: string) => {
    const binding = bindingRef.current,
      editor = view.current;
    if (!binding || !editor) return;
    const at = prepared.current
      ? binding.absolute(prepared.current)
      : editor.selection;
    prepared.current = null;
    if (!at) {
      notify(
        "The insertion point changed. Choose a new location and try again.",
      );
      return;
    }
    const from = Math.min(at.anchor, at.head),
      to = Math.max(at.anchor, at.head);
    binding.transact({
      changes: [{ from, to, insert: value }],
      selection: { anchor: from + value.length, head: from + value.length },
      kind: "command",
    });
    setAssetDialog(false);
    editor.focus(from + value.length);
  };
  const insertFiles = async (files: File[]) => {
    try {
      const resources = await store.importFiles(files);
      insert(
        resources
          .map((r) => {
            const asset = store.getSnapshot().assets.find((a) => a.id === r.id);
            const path = markdownPath(store.filePath(r));
            const name = r.name.replace(/[\[\]\\]/g, "_");
            return asset?.mime.startsWith("image/")
              ? `![${name}](${path})`
              : `[${name}](${path})`;
          })
          .join("\n\n"),
      );
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const fileAssets = snapshot.assets.filter((a) =>
    a.name.toLowerCase().includes(assetQuery.toLowerCase()),
  );
  const reset = async () => {
    if (
      !(await confirmAction(
        "Replace this local draft with the original example? Download it first to keep a copy.",
        { title: "Reset this example", confirmLabel: "Reset example" },
      ))
    )
      return;
    store.reset(doc.id);
    const value = store.document(doc.id)!.source;
    bindingRef.current?.transact({
      changes: [
        { from: 0, to: bindingRef.current.source.length, insert: value },
      ],
      selection: { anchor: 0, head: 0 },
      kind: "command",
    });
    setSource(value);
  };
  const htmlExport = async (print: boolean) => {
    if (!exportStage.current || exportBusy) return;
    const printWindow = print ? window.open("", "_blank") : null;
    if (print && !printWindow) {
      notify("Allow pop-ups to print this document.");
      return;
    }
    setExportBusy(true);
    try {
      const html = await renderedHtml(exportStage.current, doc.title);
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        await printWindow.document.fonts.ready;
        await Promise.all(
          [...printWindow.document.images].map((img) =>
            img.decode().catch(() => {}),
          ),
        );
        printWindow.focus();
        printWindow.print();
      } else
        downloadText(
          html,
          `${safeName(doc.title)}.html`,
          "text/html;charset=utf-8",
        );
    } catch (error) {
      printWindow?.close();
      notify((error as Error).message);
    } finally {
      setExportBusy(false);
    }
  };
  return (
    <main className="demo-editor-shell">
      <header className="demo-document-toolbar">
        <NativeSelect
          className="demo-document-select"
          aria-label="Choose a notebook"
          value={doc.id}
          onChange={(e) => open(e.target.value)}
        >
          {snapshot.documents
            .filter((d) => d.kind !== "canvas")
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
        </NativeSelect>
        <IconButton
          className="icon-button"
          aria-label="New note"
          title="New note"
          onClick={() => open(store.create().id)}
        >
          <Plus size={16} />
        </IconButton>
        <span className="tool-spacer" />
        <Button
          variant="ghost"
          aria-pressed={map}
          onClick={() => navigate(map ? "editor" : "mindmap", doc.id)}
        >
          {map ? "Document" : "Mind map"}
        </Button>
        <div
          className="scratchpad-modes"
          role="group"
          aria-label="Editor mode"
          hidden={map}
        >
          {(["write", "source", "read"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value === "write"
                ? "Write"
                : value === "source"
                  ? "Source"
                  : "Read"}
            </button>
          ))}
        </div>
        <span className="demo-toolbar-divider" />
        <IconButton
          className="icon-button"
          aria-label="Undo"
          title="Undo · ⌘Z / Ctrl Z"
          disabled={mode === "read"}
          onClick={() => view.current?.execute("undo")}
        >
          <Undo2 size={16} />
        </IconButton>
        <IconButton
          className="icon-button"
          aria-label="Redo"
          title="Redo · ⇧⌘Z / Ctrl Shift Z"
          disabled={mode === "read"}
          onClick={() => view.current?.execute("redo")}
        >
          <Redo2 size={16} />
        </IconButton>
        <IconButton
          className="icon-button"
          aria-label="Insert local image or attachment"
          title="Insert local image or attachment"
          disabled={mode === "read"}
          onClick={() => {
            prepare();
            setAssetDialog(true);
          }}
        >
          <Paperclip size={16} />
        </IconButton>
        <IconButton
          className="icon-button"
          aria-label="Toggle outline"
          disabled={map}
          title="Outline"
          aria-pressed={outline}
          onClick={() => setOutline((value) => !value)}
        >
          <List size={16} />
        </IconButton>
        <IconButton
          className="icon-button"
          aria-label="Toggle minimap"
          disabled={map}
          title="Minimap"
          aria-pressed={appearance.minimap.enabled}
          onClick={() =>
            changeAppearance({
              minimap: {
                ...appearance.minimap,
                enabled: !appearance.minimap.enabled,
              },
            })
          }
        >
          <Map size={16} />
        </IconButton>
        <IconButton
          className="icon-button"
          aria-label="Reset this example"
          title="Reset this example"
          onClick={() => void reset()}
        >
          <RotateCcw size={16} />
        </IconButton>
        <IconButton
          className="icon-button"
          aria-label="Export document"
          title="Export document"
          onClick={() => setExporting(true)}
        >
          <Download size={16} />
        </IconButton>
      </header>
      <div className="demo-editor-layout" data-mindmap={map || undefined}>
        {map && mapBinding && (
          <Suspense fallback={<p role="status">Opening mind map…</p>}>
            <MindmapSurface
              binding={mapBinding}
              account="showcase-local"
              scope={`showcase:${doc.id}:1`}
              title={doc.title}
              readOnly={mode === "read"}
              canEdit={() => current.current.mode !== "read"}
              context={renderContext()}
              onAuxiliary={() => setOutline(false)}
              onDocument={(at) => {
                navigate("editor", doc.id);
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => view.current?.focus(at)),
                );
              }}
              onLink={(target) => {
                const linked = store
                  .getSnapshot()
                  .documents.find((d) => d.id === target || d.title === target);
                if (linked) open(linked.id);
                else if (/^https?:\/\//i.test(target))
                  window.open(target, "_blank", "noopener,noreferrer");
                else notify("Import the linked note to open it here.");
              }}
            />
          </Suspense>
        )}
        <div className="document-navigation-row demo-writing-row" hidden={map}>
          <div
            ref={mount}
            className="demo-document-scroll ws-document-scroll document-scroll"
            tabIndex={-1}
            onScroll={followScroll}
          />
          <div className="minimap-slot">
            <DocumentMinimap
              root={mount}
              adapter={adapter}
              navigation={navigation}
              active
              source={source}
              parsed={parsed}
              mode={mode}
              preferences={appearance.minimap}
              themeKey={`${dark}:${editorAppearanceKey(appearance)}`}
              onChange={(minimap) => changeAppearance({ minimap })}
            />
          </div>
        </div>
        {outline && !map && (
          <ResizablePanel
            className="ws-document-context"
            label="Document context"
            account="showcase-local"
            name="document-context"
            edge="left"
          >
            <div className="ws-context-content">
              <nav className="ws-context-tabs" aria-label="Document panel">
                <IconButton
                  className="icon-button"
                  aria-label="outline panel"
                  title="Outline"
                  aria-pressed
                >
                  <List size={16} />
                </IconButton>
                <IconButton
                  className="icon-button"
                  aria-label="Close document panel"
                  title="Close document panel"
                  onClick={() => setOutline(false)}
                >
                  <X size={15} />
                </IconButton>
              </nav>
              <TableOfContents
                headings={parsed.outline}
                activeId={section}
                collapsed={collapsed}
                onCollapsedChange={setCollapsed}
                onNavigate={navigateSection}
                reveal={0}
              />
            </div>
          </ResizablePanel>
        )}
      </div>
      <footer className="demo-document-status">
        <span>
          <span className="demo-save-dot" />
          {snapshot.status}
        </span>
        <span>
          {statistics.words} words · {statistics.equations} equations ·{" "}
          {statistics.readingMinutes} min read
        </span>
        <span>
          {mode === "read" ? "Read only" : "Canonical Markdown"} · device only
        </span>
      </footer>
      <input
        hidden
        ref={uploadInput}
        type="file"
        multiple
        accept="image/*,application/pdf,audio/*,video/*,.txt,.md"
        onChange={(event) => {
          void insertFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {assetDialog && (
        <Dialog
          title="Insert a local file"
          subtitle="Choose an existing upload, or add one from your device. No files are sent to a server."
          size="wide"
          onClose={() => {
            setAssetDialog(false);
            prepared.current = null;
          }}
        >
          <div className="demo-asset-toolbar">
            <label>
              <SearchField
                aria-label="Find local files"
                placeholder="Find a local file…"
                value={assetQuery}
                onChange={(e) => setAssetQuery(e.target.value)}
              />
            </label>
            <Button
              className="button secondary"
              onClick={() => uploadInput.current?.click()}
            >
              <Upload size={15} />
              Upload from device
            </Button>
          </div>
          <div className="demo-asset-grid">
            {fileAssets.map((asset) => (
              <button
                key={asset.id}
                onClick={() =>
                  insert(
                    `${asset.mime.startsWith("image/") ? "!" : ""}[${asset.name.replace(/[\[\]\\]/g, "_")}](${markdownPath(asset.path)})`,
                  )
                }
              >
                {asset.mime.startsWith("image/") ? (
                  <img src={store.url(asset)} alt="" />
                ) : (
                  <Paperclip size={28} />
                )}
                <strong>{asset.name}</strong>
                <small>{(asset.blob.size / 1024).toFixed(1)} KB</small>
              </button>
            ))}
            {!fileAssets.length && (
              <p>
                No local files yet. Upload an image, PDF, audio or video to
                begin.
              </p>
            )}
          </div>
          <DialogFooter>
            <span className="demo-fineprint">
              <Image size={14} />
              Images keep stable Markdown paths and live previews.
            </span>
            <Button
              className="button secondary"
              onClick={() => {
                setAssetDialog(false);
                prepared.current = null;
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </Dialog>
      )}
      {tableDialog && (
        <Dialog
          title="Insert a table"
          size="compact"
          onClose={() => {
            setTableDialog(false);
            prepared.current = null;
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const binding = bindingRef.current,
                at = prepared.current && binding?.absolute(prepared.current);
              view.current?.execute("table", {
                rows,
                columns,
                ...(at
                  ? {
                      from: Math.min(at.anchor, at.head),
                      to: Math.max(at.anchor, at.head),
                    }
                  : {}),
              });
              prepared.current = null;
              setTableDialog(false);
            }}
          >
            <div className="demo-table-fields">
              <label>
                Rows
                <TextInput
                  type="number"
                  min={2}
                  max={40}
                  value={rows}
                  onChange={(e) =>
                    setRows(Math.min(40, Math.max(2, Number(e.target.value))))
                  }
                />
              </label>
              <label>
                Columns
                <TextInput
                  type="number"
                  min={1}
                  max={20}
                  value={columns}
                  onChange={(e) =>
                    setColumns(
                      Math.min(20, Math.max(1, Number(e.target.value))),
                    )
                  }
                />
              </label>
            </div>
            <DialogFooter>
              <Button variant="primary" type="submit">
                Insert table
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}
      {exporting && (
        <Dialog
          title="Take your work with you"
          subtitle="Portable Markdown, a self-contained styled web page, or a print-ready document."
          onClose={() => {
            if (!exportBusy) setExporting(false);
          }}
        >
          <div className="demo-export-options">
            <button
              onClick={() => {
                downloadText(
                  source,
                  `${safeName(doc.title)}.md`,
                  "text/markdown;charset=utf-8",
                );
              }}
            >
              <FileText size={21} />
              <span>
                <strong>Markdown</strong>
                <small>Original source, ready for any Markdown app</small>
              </span>
              <Download size={16} />
            </button>
            <button
              onClick={() =>
                void navigator.clipboard.writeText(source).then(
                  () => notify("Markdown copied."),
                  () =>
                    notify("Clipboard unavailable. Download Markdown instead."),
                )
              }
            >
              <Copy size={21} />
              <span>
                <strong>Copy Markdown</strong>
                <small>Keep the source exactly as written</small>
              </span>
            </button>
            <button
              disabled={exportBusy}
              onClick={() => void htmlExport(false)}
            >
              <FileCode2 size={21} />
              <span>
                <strong>Styled HTML</strong>
                <small>
                  Rendered math, diagrams, images and embedded fonts
                </small>
              </span>
              <Download size={16} />
            </button>
            <button disabled={exportBusy} onClick={() => void htmlExport(true)}>
              <Printer size={21} />
              <span>
                <strong>Print / PDF</strong>
                <small>Open the print dialog, then choose Save as PDF</small>
              </span>
            </button>
          </div>
          <div
            ref={exportStage}
            className="demo-export-stage"
            aria-hidden="true"
          >
            <ReadingView
              source={source}
              parsed={parsed}
              context={renderContext()}
              onLink={() => {}}
            />
          </div>
          <DialogFooter>
            <span role="status">
              {exportBusy
                ? "Preparing a styled document…"
                : "Export a backup before clearing browser data."}
            </span>
            <Button
              className="button secondary"
              disabled={exportBusy}
              onClick={() => setExporting(false)}
            >
              Done
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </main>
  );
}
