"use client";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { NativeBinding } from "@axiom/editor/binding";
import { EditorView } from "../lib/editor-view";
import { useWorkspace } from "./workspace/ui";

/** Private draft surface: no document provider, awareness, or document undo. */
export default function AnnotationEditor({
  value,
  onChange,
  onError,
}: {
  value: string;
  onChange: (value: string) => void;
  onError: (message: string) => void;
}) {
  const { appearance, editorSettings } = useWorkspace();
  const mount = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null);
  const [mode, setMode] = useState<"write" | "source">("write");
  const current = useRef({
    appearance,
    editorSettings,
    onChange,
    onError,
    mode,
  });
  current.current = { appearance, editorSettings, onChange, onError, mode };
  useEffect(() => {
    if (!mount.current) return;
    const doc = new Y.Doc(),
      text = doc.getText("markdown");
    text.insert(0, value);
    const undo = new Y.UndoManager(text),
      binding = new NativeBinding(doc, undo, null);
    // Opening a card is not an edit. Projection initialization must not
    // overwrite a newer sharing state with an unnecessary source save.
    let published = value;
    const editor = new EditorView(mount.current, binding, {
      mode: () => current.current.mode,
      appearance: () => ({
        ...current.current.appearance.effective,
        blockGuides: false,
      }),
      preferences: () => ({
        ...current.current.editorSettings.effective,
        typewriter: false,
      }),
      context: () => ({
        theme: current.current.appearance.dark ? "dark" : "light",
        disableImages: true,
      }),
      readOnly: () => false,
      workspace: (command) =>
        command === "source"
          ? setMode((v) => (v === "write" ? "source" : "write"))
          : current.current.onError("Use the document for workspace actions."),
      message: (message) => current.current.onError(message),
      recover: (source) => {
        current.current.onChange(source);
        current.current.onError(
          "Recovered annotation text retained in this draft.",
        );
      },
      prepare: () => {},
      navigate: () => {},
      link: () => {},
      notes: () => [],
      changed: (source) => {
        if (source === published) return;
        published = source;
        current.current.onChange(source);
      },
    });
    if ("setLabel" in editor)
      editor.setLabel("Annotation body", "annotation-editor");
    else {
      editor.content.setAttribute("aria-label", "Annotation body");
      editor.content.dataset.testid = "annotation-editor";
    }
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
      undo.destroy();
      doc.destroy();
    };
  }, []);
  useEffect(() => {
    view.current?.configure();
  }, [appearance.effective, editorSettings.effective, mode]);
  return (
    <div className="annotation-editor">
      <div className="annotation-editor-toolbar">
        <span>Markdown · math · code</span>
        <div
          className="scratchpad-modes"
          role="group"
          aria-label="Annotation editor mode"
        >
          {(["write", "source"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={mode === v}
              onClick={() => setMode(v)}
            >
              {v === "write" ? "Write" : "Source"}
            </button>
          ))}
        </div>
      </div>
      <div ref={mount} />
    </div>
  );
}
