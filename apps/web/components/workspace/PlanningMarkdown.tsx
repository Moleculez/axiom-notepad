"use client";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { NativeBinding } from "../../lib/native-editor/binding";
import { EditorView } from "../../lib/editor-view";
import { useWorkspace } from "./ui";

/** Task drafts reuse the application's configured Markdown engine. Saving is an explicit CAS operation. */
export default function PlanningMarkdown({
  initial,
  onChange,
  readOnly = false,
}: {
  initial: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const { appearance, editorSettings, notify, open } = useWorkspace(),
    [mode, setMode] = useState<"write" | "source">("write");
  const mount = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    current = useRef({
      appearance,
      editorSettings,
      mode,
      readOnly,
      onChange,
      notify,
      open,
    });
  current.current = {
    appearance,
    editorSettings,
    mode,
    readOnly,
    onChange,
    notify,
    open,
  };
  useEffect(() => {
    if (!mount.current) return;
    const doc = new Y.Doc(),
      text = doc.getText("markdown");
    text.insert(0, initial);
    const undo = new Y.UndoManager(text),
      binding = new NativeBinding(doc, undo, null);
    const editor = new EditorView(mount.current, binding, {
      mode: () => current.current.mode,
      preferences: () => ({
        ...current.current.editorSettings.effective,
        typewriter: false,
      }),
      appearance: () => current.current.appearance.effective,
      context: () => ({
        theme: current.current.appearance.dark ? "dark" : "light",
      }),
      readOnly: () => current.current.readOnly,
      workspace: (command) => {
        if (command === "source")
          setMode((old) => (old === "source" ? "write" : "source"));
      },
      message: (message) => current.current.notify(message),
      recover: () =>
        current.current.notify(
          "Your local task draft is retained. Reopen it to recover.",
        ),
      prepare: () => {},
      navigate: () => {},
      link: (target) => {
        if (/^[\da-f-]{36}$/i.test(target))
          current.current.open({ id: target, kind: "note" });
      },
      changed: (source) => current.current.onChange(source),
      notes: () => [],
      files: () =>
        current.current.notify(
          "Upload evidence in Files, then link it to this task.",
        ),
    });
    if ("setLabel" in editor)
      editor.setLabel("Task description", "task-description");
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
  }, [appearance.effective, editorSettings.effective, mode, readOnly]);
  return (
    <div className="planning-markdown">
      <div className="scratchpad-toolbar">
        <span>Description</span>
        <div className="scratchpad-modes">
          {(["write", "source"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value === "write" ? "Write" : "Source"}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={mount}
        className="planning-markdown-scroll ws-document-scroll"
      />
    </div>
  );
}
