import * as Y from "yjs";
import "../../packages/shared/assets/latin-modern/fonts.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/jetbrains-mono/400.css";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from "y-protocols/awareness";
import { NativeBinding } from "../../packages/editor/src/binding";
import type { Projection } from "../../packages/editor/src/projection";
import type { RichSurface } from "../../packages/editor/src/rich-surface";
import type { TextSurface } from "../../packages/editor/src/text-surface";
import { AxiomEditorView } from "../../apps/web/lib/editor-vnext/view";
import { NativeEditorView } from "../../apps/web/lib/native-editor/view";
import {
  editorDefaults,
  type EditorCommandId,
} from "../../packages/shared/src/editor";
import {
  defaults,
  appearanceVariables,
} from "../../packages/shared/src/appearance";
import "../../apps/web/app/globals.css";
import "../../apps/web/app/appearance.css";
import "../../apps/web/app/native-editor.css";
import "../../apps/web/app/editor-design.css";
import "../../apps/web/app/refinement.css";
import "../../apps/web/app/editor-vnext.css";
import "../../apps/web/app/editor-paper.css";
import "../../packages/shared/assets/document-decorations.css";
import "../../packages/shared/assets/document-tasks.css";
import "./lab.css";
import "../../apps/web/app/menu-icons.css";

for (const [key, value] of Object.entries(appearanceVariables(defaults, false)))
  document.documentElement.style.setProperty(key, value);
const mount = document.querySelector<HTMLElement>("#editors")!;
const sessions: {
  doc: Y.Doc;
  undo: Y.UndoManager;
  awareness: Awareness;
  view: AxiomEditorView | NativeEditorView;
  mode: "write" | "source" | "read";
  readOnly: boolean;
  autoPair: boolean;
  updates: number;
}[] = [];
const recovery: string[] = [];
const hostEvents: (
  | { kind: "command" | "link"; index: number; target: string }
  | { kind: "prepare"; index: number; from: number; to: number }
)[] = [];
let imagesEnabled = false;
async function reset(source: string, legacy = false) {
  for (const session of sessions) {
    session.view.destroy();
    session.awareness.destroy();
    session.undo.destroy();
    session.doc.destroy();
  }
  sessions.length = 0;
  recovery.length = 0;
  hostEvents.length = 0;
  mount.replaceChildren();
  for (let i = 0; i < 2; i++) {
    const section = document.createElement("section"),
      title = document.createElement("nav"),
      host = document.createElement("div"),
      footer = document.createElement("footer");
    title.textContent =
      i === 0
        ? "Rich editor · Researcher A"
        : legacy
          ? "Legacy editor · Researcher B"
          : "Source editor · Researcher B";
    const toggle = document.createElement("button");
    toggle.textContent = "Toggle Write / Source";
    toggle.addEventListener("click", () => toggleMode(i));
    title.append(toggle);
    host.className = "lab-host";
    host.dataset.pane = String(i);
    footer.textContent = "Markdown remains the shared document";
    section.append(title, host, footer);
    mount.append(section);
    const doc = new Y.Doc();
    if (i === 0) doc.getText("markdown").insert(0, source);
    else Y.applyUpdate(doc, Y.encodeStateAsUpdate(sessions[0].doc));
    const undo = new Y.UndoManager(doc.getText("markdown")),
      awareness = new Awareness(doc),
      binding = new NativeBinding(doc, undo, awareness);
    const mode: "write" | "source" = i === 0 || legacy ? "write" : "source";
    const Constructor = i === 1 && legacy ? NativeEditorView : AxiomEditorView;
    const view = new Constructor(host, binding, {
      mode: () => sessions[i]?.mode ?? mode,
      preferences: () => ({
        ...editorDefaults,
        autoPair: sessions[i]?.autoPair ?? false,
      }),
      appearance: () => defaults,
      context: () => ({ disableImages: !imagesEnabled }),
      readOnly: () => sessions[i]?.readOnly ?? false,
      workspace: (id) => {
        hostEvents.push({ kind: "command", index: i, target: id });
        if (id === "source") toggleMode(i);
      },
      prepare: (range) => {
        const selection = sessions[i].view.selection;
        hostEvents.push({
          kind: "prepare",
          index: i,
          from: range?.from ?? Math.min(selection.anchor, selection.head),
          to: range?.to ?? Math.max(selection.anchor, selection.head),
        });
      },
      navigate: () => {},
      link: (target) => hostEvents.push({ kind: "link", index: i, target }),
      notes: () => [],
      message: (text) => {
        document.querySelector("#message")!.textContent = text;
      },
      recover: (source) => recovery.push(source),
      changed: (text) => {
        footer.textContent = `${text.length} characters · Shared Y.Text`;
      },
    });
    sessions.push({
      doc,
      undo,
      awareness,
      view,
      mode,
      readOnly: false,
      autoPair: false,
      updates: 0,
    });
    awareness.setLocalStateField("user", {
      id: "researcher-" + i,
      name: "Researcher " + (i ? "B" : "A"),
      color: i ? "#8464ad" : "#376e84",
    });
  }
  sessions.forEach((session, index) => {
    session.doc.on("update", (update: Uint8Array, origin: unknown) => {
      session.updates++;
      if (origin !== "lab-wire")
        Y.applyUpdate(sessions[1 - index].doc, update, "lab-wire");
    });
    session.awareness.on(
      "update",
      (
        {
          added,
          updated,
          removed,
        }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        if (origin !== "lab-wire")
          applyAwarenessUpdate(
            sessions[1 - index].awareness,
            encodeAwarenessUpdate(session.awareness, [
              ...added,
              ...updated,
              ...removed,
            ]),
            "lab-wire",
          );
      },
    );
    applyAwarenessUpdate(
      sessions[1 - index].awareness,
      encodeAwarenessUpdate(session.awareness, [session.doc.clientID]),
      "lab-wire",
    );
  });
  await Promise.all(
    sessions.map((session) =>
      session.view instanceof AxiomEditorView
        ? session.view.ready
        : Promise.resolve(),
    ),
  );
}
function toggleMode(index: number) {
  const s = sessions[index];
  if (!s) return;
  s.mode = s.mode === "write" ? "source" : "write";
  s.view.configure();
}
const lab = {
  reset,
  snapshot: () =>
    sessions.map((s) => ({
      source: s.doc.getText("markdown").toString(),
      selection: s.view.selection,
      updates: s.updates,
      mode: s.mode,
      undo: s.undo.undoStack.length,
    })),
  focus: (index: number, anchor: number, head = anchor) =>
    sessions[index].view.focus(anchor, head),
  images: (enabled: boolean) => {
    imagesEnabled = enabled;
    sessions.forEach((session) => session.view.configure());
  },
  // Test-only observability: assert the actual browser caret, not just the
  // engine's remembered source offset. Never exposed by the deployed app.
  domSelection: (index: number) => {
    const view = sessions[index].view as unknown as {
      rich: RichSurface | null;
      projection: Projection | null;
      sourceView: TextSurface | null;
      activeEmbedded: () => { surface: TextSurface } | undefined;
    };
    const selected = document.getSelection();
    const text = view.sourceView ?? view.activeEmbedded?.()?.surface;
    if (
      text &&
      selected?.anchorNode &&
      selected.focusNode &&
      text.view.contentDOM.contains(selected.anchorNode) &&
      text.view.contentDOM.contains(selected.focusNode)
    )
      return {
        anchor: text.sourceAt(
          text.view.posAtDOM(selected.anchorNode, selected.anchorOffset),
        ),
        head: text.sourceAt(
          text.view.posAtDOM(selected.focusNode, selected.focusOffset),
        ),
      };
    if (
      !view.rich ||
      !view.projection ||
      !selected?.anchorNode ||
      !selected.focusNode ||
      !view.rich.view.dom.contains(selected.anchorNode) ||
      !view.rich.view.dom.contains(selected.focusNode)
    )
      return null;
    return {
      anchor: view.projection.map.sourceAt(
        view.rich.view.posAtDOM(selected.anchorNode, selected.anchorOffset),
        1,
      ),
      head: view.projection.map.sourceAt(
        view.rich.view.posAtDOM(selected.focusNode, selected.focusOffset),
        selected.isCollapsed ? 1 : -1,
      ),
    };
  },
  execute: (index: number, id: EditorCommandId) =>
    sessions[index].view.execute(id),
  mode: async (index: number, mode: "write" | "source" | "read") => {
    sessions[index].mode = mode;
    sessions[index].view.configure();
    const view = sessions[index].view;
    if (view instanceof AxiomEditorView) await view.ready;
  },
  readOnly: (index: number, value: boolean) => {
    sessions[index].readOnly = value;
    sessions[index].view.configure();
  },
  autoPair: (index: number, value: boolean) => {
    sessions[index].autoPair = value;
    sessions[index].view.configure();
  },
  recovery: () => recovery,
  hostEvents: () => hostEvents,
  remote: (index: number, from: number, to: number, insert: string) => {
    const doc = sessions[index].doc;
    doc.transact(() => {
      const text = doc.getText("markdown");
      text.delete(from, to - from);
      text.insert(from, insert);
    });
  },
};
declare global {
  interface Window {
    editorLab: typeof lab;
    editorLabReady: Promise<void>;
  }
}
window.editorLab = lab;
window.editorLabReady = reset(
  "# A place for careful thinking\n\nWrite **precisely**, keep _your source_.\n\n- [ ] Reproduce the result\n  - Check the assumptions\n\n> A good question is a useful starting point.\n\n| Quantity | Model |\n| :--- | ---: |\n| Energy | $E=mc^2$ |\n\n```python\ndef energy(m, c):\n    return m * c**2\n```\n\n$$\nE = mc^2\n$$\n\n",
);
