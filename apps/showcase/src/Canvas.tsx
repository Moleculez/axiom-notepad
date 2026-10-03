import { IconButton, NativeSelect } from "../../web/components/ui/controls";
import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { parseCanvas, readCanvas, seedCanvas } from "@axiom/shared/canvas";
import { Plus, RotateCcw, Network } from "lucide-react";
import {
  CanvasSurface,
  type CanvasSession,
} from "../../web/components/tools/CanvasSurface";
import {
  CanvasHostContext,
  type CanvasHost,
} from "../../web/components/tools/CanvasHost";
import { confirmAction } from "../../web/lib/app-prompt";
import { useDemo, store, useSnapshot } from "./context";
import type { LocalDocument } from "./store";
import { FilePreview } from "./FileViewer";
import CanvasExport from "./CanvasExport";
import { Loading } from "./App";

export default function Canvas({
  document: initial,
}: {
  document: LocalDocument;
}) {
  const snapshot = useSnapshot(),
    { dark, open, notify, renderContext } = useDemo();
  const document =
    snapshot.documents.find((d) => d.id === initial.id) ?? initial;
  const [shared, setShared] = useState<CanvasSession | null>(null),
    [reset, setReset] = useState(0);
  useEffect(() => {
    const doc = new Y.Doc();
    try {
      seedCanvas(
        doc,
        store.normalizeCanvas(
          parseCanvas(store.document(initial.id)?.source ?? ""),
        ),
      );
    } catch (error) {
      notify((error as Error).message);
      doc.destroy();
      return;
    }
    const update = () => {
      const source = JSON.stringify(readCanvas(doc));
      store.update(initial.id, source);
      setShared({
        document: doc,
        source,
        awareness: null,
        readOnly: false,
        error: "",
        recovery: null,
        status: "Saved locally",
        reconnect: () => {},
        reopen: () => {},
      });
    };
    doc.on("update", update);
    update();
    return () => {
      doc.off("update", update);
      doc.destroy();
    };
  }, [initial.id, reset, notify]);
  const host = useMemo<CanvasHost>(
    () => ({
      local: true,
      identity: "axiom-showcase",
      revision: snapshot.revision,
      appearance: { effective: snapshot.appearance, dark },
      editorSettings: { effective: snapshot.editor },
      notify,
      open: (resource) => open(resource.id),
      context: renderContext,
      resources: async (query, signal) => {
        signal.throwIfAborted();
        return store.resources(query);
      },
      resource: async (id) => store.resource(id),
      resolvePreview: async (id, _version, signal) => {
        signal.throwIfAborted();
        return store.preview(id);
      },
      importFiles: (files) => store.importFiles(files),
      filePath: store.filePath,
      normalizeCanvas: store.normalizeCanvas,
      renderFile: (file) => <FilePreview file={file} compact />,
      export: (options) => <CanvasExport {...options} />,
    }),
    [
      snapshot.appearance,
      snapshot.editor,
      dark,
      notify,
      open,
      renderContext,
      snapshot.revision,
    ],
  );
  return (
    <div className="demo-canvas-shell">
      <div className="demo-document-toolbar">
        <Network size={17} />
        <NativeSelect
          className="demo-document-select"
          aria-label="Choose a canvas"
          value={document.id}
          onChange={(event) => open(event.target.value)}
        >
          {snapshot.documents
            .filter((d) => d.kind === "canvas")
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
        </NativeSelect>
        <IconButton
          className="icon-button"
          aria-label="New canvas"
          title="New canvas"
          onClick={() =>
            open(
              store.create(
                "Untitled canvas",
                "canvas",
                '{"nodes":[],"edges":[]}',
              ).id,
            )
          }
        >
          <Plus size={16} />
        </IconButton>
        <span className="tool-spacer" />
        <span className="demo-canvas-help">
          Double-click a text card to edit · drag a port to connect · scroll to
          zoom
        </span>
        <IconButton
          className="icon-button"
          aria-label="Reset canvas example"
          title="Reset canvas example"
          onClick={async () => {
            if (
              await confirmAction(
                "Replace this local canvas with the original example? Export it first to keep your changes.",
                { title: "Reset this canvas", confirmLabel: "Reset canvas" },
              )
            ) {
              store.reset(initial.id);
              setReset((old) => old + 1);
            }
          }}
        >
          <RotateCcw size={16} />
        </IconButton>
      </div>
      <CanvasHostContext.Provider value={host}>
        {shared ? (
          <CanvasSurface
            key={shared.document?.clientID}
            project={{
              resource_id: document.id,
              name: document.title,
              space_id: "showcase",
              kind: "canvas",
              settings: {},
              version: 1,
              role: "editor",
              updated_at: document.modified,
            }}
            shared={{ ...shared, status: snapshot.status }}
          />
        ) : (
          <Loading />
        )}
      </CanvasHostContext.Provider>
    </div>
  );
}
