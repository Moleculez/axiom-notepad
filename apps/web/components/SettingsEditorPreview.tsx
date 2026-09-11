"use client";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import type { EditorPreferences } from "@axiom/shared/editor";
import type { Preferences } from "@axiom/shared/appearance";
import { NativeBinding } from "../lib/native-editor/binding";
import { EditorView } from "../lib/editor-view";
import { RotateCcw } from "lucide-react";

const samples: Record<string, string> = {
  Appearance:
    "# A little room to think\n\nA **reproducible** observation, with room for _uncertainty_. Select a sentence to try highlighting.\n\nGreek symbols α, β, λ · 中文研究笔记 · 0123456789\n\n> Keep the assumptions beside the result.\n\n| Quantity | Model |\n| :--- | ---: |\n| Energy | $E=mc^2$ |\n\n```python\ndef energy(mass, c):\n    return mass * c**2\n```\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n",
  Editor:
    "# Research scratchpad\n\nTry **bold**, `inline code`, or a / command.\n\n- Record an observation\n  - Compare the model\n- [ ] Reproduce the result\n\n> A good question is a useful starting point.\n\n",
  Code: "```python\ndef energy(m, c):\n    return m * c**2\n```\n\nHover over the code block for its controls.\n",
  Tables:
    "| Quantity | Model |\n| :--- | ---: |\n| Energy | $E=mc^2$ |\n| Uncertainty | $\\sigma^2$ |\n\nMove near the right or bottom edge to add a column or row. Hover at the top-right for alignment, copy and more actions. Right-click a cell or press Shift-F10 for the compact panel.\n",
  Mathematics:
    "$$\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n$$\n\nClick the equation to edit its TeX source.\n",
};

/** A throwaway in-memory document, deliberately without a provider, awareness,
 * IndexedDB, attachment handlers, or any account/note identity. */
export default function SettingsEditorPreview({
  preferences,
  appearance,
  category,
}: {
  preferences: EditorPreferences;
  appearance: Preferences;
  category: string;
}) {
  const mount = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null);
  const current = useRef({ preferences, appearance });
  current.current = { preferences, appearance };
  const [mode, setMode] = useState<"write" | "source" | "read">("write");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [reset, setReset] = useState(0),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!mount.current) return;
    const doc = new Y.Doc(),
      text = doc.getText("markdown");
    text.insert(0, samples[category] ?? samples.Editor);
    const undo = new Y.UndoManager(text),
      binding = new NativeBinding(doc, undo, null);
    const editor = new EditorView(mount.current, binding, {
      mode: () => modeRef.current,
      preferences: () => current.current.preferences,
      appearance: () => current.current.appearance,
      context: () => ({ disableImages: true }),
      readOnly: () => false,
      workspace: (command) =>
        command === "source"
          ? setMode((old) => (old === "source" ? "write" : "source"))
          : setMessage(
              "Workspace actions are unavailable in this private scratchpad.",
            ),
      message: setMessage,
      recover: () =>
        setMessage(
          "Reset the sample to start again. No notes have been changed.",
        ),
      prepare: () => {},
      navigate: () => {},
      link: () => setMessage("Links are disabled in the scratchpad."),
      changed: () => {},
      notes: () => [],
      files: () => setMessage("Uploads are disabled in the scratchpad."),
    });
    if ("setLabel" in editor)
      editor.setLabel(`${category} scratchpad`, "settings-scratchpad");
    else {
      editor.content.setAttribute("aria-label", `${category} scratchpad`);
      editor.content.dataset.testid = "settings-scratchpad";
    }
    view.current = editor;
    return () => {
      view.current = null;
      editor.destroy();
      undo.destroy();
      doc.destroy();
    };
  }, [category, reset]);
  useEffect(() => {
    view.current?.configure();
  }, [preferences, appearance, mode]);
  return (
    <section
      className="settings-scratchpad"
      aria-label={`${category} settings preview`}
    >
      <div className="scratchpad-toolbar">
        <span>
          <strong>Try it here</strong>
          <small>Live preview · your own space to experiment</small>
        </span>
        <div className="ws-actions">
          <div
            className="scratchpad-modes"
            role="group"
            aria-label="Preview mode"
          >
            {(["write", "read", "source"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {value === "write"
                  ? "Write"
                  : value === "read"
                    ? "Read"
                    : "Source"}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="text-button scratchpad-reset"
            aria-label="Reset sample"
            title="Reset sample"
            onClick={() => {
              setReset((n) => n + 1);
              setMessage("");
            }}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
      <div
        className="settings-scratchpad-scroll ws-document-scroll"
        ref={mount}
      />
      <div className="scratchpad-footer">
        <span>Private scratchpad · never saved or synced</span>
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
