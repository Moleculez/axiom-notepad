import * as Y from "yjs";
import { NativeEditorView } from "../../apps/web/lib/native-editor/view";
import { NativeBinding } from "../../apps/web/lib/native-editor/binding";
import { editorDefaults } from "../../packages/shared/src/editor";
import { defaults } from "../../packages/shared/src/appearance";

declare global {
  interface Window {
    nativeTest: {
      mount(
        source: string,
        at?: number,
        autoPair?: boolean,
        mode?: "write" | "source",
      ): void;
      state(): {
        source: string;
        selection: { anchor: number; head: number };
        dom: { anchor: number; head: number } | null;
      };
      focus(anchor: number, head?: number): void;
      mode(mode: "write" | "source" | "read"): void;
      remote(from: number, to: number, insert: string): void;
    };
  }
}

let doc: Y.Doc, view: NativeEditorView;
let mode: "write" | "source" | "read" = "write";
window.nativeTest = {
  mount(source, at = source.length, autoPair = false, initialMode = "write") {
    if (view) {
      view.binding.undo.destroy();
      view.destroy();
      doc.destroy();
    }
    doc = new Y.Doc();
    doc.getText("markdown").insert(0, source);
    mode = initialMode;
    const binding = new NativeBinding(
      doc,
      new Y.UndoManager(doc.getText("markdown")),
      null,
    );
    view = new NativeEditorView(document.getElementById("host")!, binding, {
      mode: () => mode,
      preferences: () => ({ ...editorDefaults, autoPair }),
      appearance: () => defaults,
      context: () => ({}),
      readOnly: () => mode === "read",
      workspace: (id) => {
        if (id === "source") {
          mode = mode === "source" ? "write" : "source";
          view.configure();
        }
      },
      message: () => {},
      recover: () => {},
      prepare: () => {},
      navigate: () => {},
      link: () => {},
      changed: () => {},
      notes: () => [],
    });
    view.focus(at);
  },
  state: () => ({
    source: view.source,
    selection: { ...view.selection },
    dom: view.map.read(),
  }),
  focus: (anchor, head = anchor) => view.focus(anchor, head),
  mode: (next) => {
    mode = next;
    view.configure();
    if (mode !== "read") view.focus();
  },
  remote: (from, to, insert) => {
    doc.transact(() => {
      const text = doc.getText("markdown");
      if (to > from) text.delete(from, to - from);
      if (insert) text.insert(from, insert);
    }, "remote-test-author");
  },
};
