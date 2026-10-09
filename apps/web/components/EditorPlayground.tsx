"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { IconButton } from "./ui/controls";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { parseMarkdown } from "@axiom/markdown";
import { editorAppearanceKey } from "@axiom/shared/minimap";
import { useDocumentNavigation } from "../lib/document-navigation";
import DocumentMinimap from "./DocumentMinimap";
import * as Y from "yjs";
import type { EditorPreferences } from "@axiom/shared/editor";
import type { Preferences } from "@axiom/shared/appearance";
import { NativeBinding } from "../lib/native-editor/binding";
import { EditorView } from "../lib/editor-view";
import { Copy, RotateCcw } from "lucide-react";
import ThemeWorkbench from "./ThemeWorkbench";

const samples: Record<string, string> = {
  General:
    "# A clear structure\n\nGuides follow the range of each block as your document grows.\n\n- Record an observation\n  - Compare the model\n    - Check the assumptions\n  - [ ] Reproduce the result\n\n> Keep context close.\n>\n> > A nested perspective.\n\n| Quantity | Model |\n| --- | --- |\n| Energy | $E=mc^2$ |\n\n",
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
export default function EditorPlayground({
  preferences,
  appearance,
  category,
  showInterface = false,
  dark = false,
  active = true,
  onAppearanceChange,
  sample,
}: {
  preferences: EditorPreferences;
  appearance: Preferences;
  category: string;
  showInterface?: boolean;
  dark?: boolean;
  active?: boolean;
  onAppearanceChange?: (appearance: Preferences) => void;
  sample?: string;
}) {
  useInterfaceLocale();
  const mount = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null);
  const current = useRef({ preferences, appearance });
  current.current = { preferences, appearance };
  const [mode, setMode] = useState<"write" | "source" | "read">("write");
  const [surface, setSurface] = useState<"writing" | "interface">("writing");
  const writing = !showInterface || surface === "writing",
    writingId = useId(),
    interfaceId = useId();
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [reset, setReset] = useState(0),
    [message, setMessage] = useState("");
  const [source, setSource] = useState(
    sample ?? samples[category] ?? samples.Editor,
  );
  const parsed = useMemo(() => parseMarkdown(source), [source]);
  const adapter = useMemo(
    () => ({
      geometry: () => {
        const v = view.current;
        return v && "navigationGeometry" in v ? v.navigationGeometry() : [];
      },
      snapshot: () => {
        const v = view.current;
        return v && "navigationSnapshot" in v ? v.navigationSnapshot() : null;
      },
      position: (position: number) => {
        const v = view.current;
        return v && "navigationPosition" in v
          ? v.navigationPosition(position)
          : null;
      },
      focus: (position?: number) => {
        const v = view.current;
        if (v)
          v.focus(position ?? v.selection.anchor, position ?? v.selection.head);
      },
    }),
    [],
  );
  const navigation = useDocumentNavigation(
    mount,
    adapter,
    `${category}:${reset}`,
    source,
    mode,
    active && writing && appearance.minimap.enabled,
  );
  useEffect(() => {
    if (!mount.current) return;
    const doc = new Y.Doc(),
      text = doc.getText("markdown");
    text.insert(0, sample ?? samples[category] ?? samples.Editor);
    setSource(text.toString());
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
      changed: (source) => setSource(source),
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
  }, [category, reset, sample]);
  useEffect(() => {
    view.current?.configure();
  }, [preferences, editorAppearanceKey(appearance), mode]);
  return (
    <section
      className="settings-scratchpad"
      aria-label={`${category} settings preview`}
    >
      <div
        className="scratchpad-toolbar"
        aria-label={uiText("Live preview controls")}
      >
        <span className="scratchpad-title">
          <strong>
            <I18nText id="Try it here" />
          </strong>
        </span>
        {showInterface && (
          <div
            className="scratchpad-surface-switch"
            role="group"
            aria-label={uiText("Preview surface")}
          >
            {(["writing", "interface"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={surface === value}
                aria-controls={value === "writing" ? writingId : interfaceId}
                onClick={() => setSurface(value)}
              >
                {value === "writing" ? uiText("Writing") : uiText("Interface")}
              </button>
            ))}
          </div>
        )}
        <div className="scratchpad-context-actions">
          <div
            className="scratchpad-writing-actions"
            aria-hidden={!writing}
            inert={!writing}
          >
            <div
              className="scratchpad-modes"
              role="group"
              aria-label={uiText("Preview mode")}
            >
              {(["write", "read", "source"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {value === "write"
                    ? uiText("Write")
                    : value === "read"
                      ? "Read"
                      : "Source"}
                </button>
              ))}
            </div>
            <IconButton
              type="button"
              className="icon-button"
              aria-label={uiText("Copy sample Markdown")}
              title={uiText("Copy sample Markdown")}
              onClick={() =>
                void navigator.clipboard.writeText(source).then(
                  () => setMessage("Markdown copied."),
                  () =>
                    setMessage(
                      "Clipboard unavailable. Select and copy in Source mode.",
                    ),
                )
              }
            >
              <Copy size={15} />
            </IconButton>
            <IconButton
              type="button"
              className="icon-button scratchpad-reset"
              aria-label={uiText("Reset sample")}
              title={uiText("Reset sample")}
              onClick={() => {
                setReset((n) => n + 1);
                setMessage("");
              }}
            >
              <RotateCcw size={15} />
            </IconButton>
          </div>
          {showInterface && (
            <small
              className="scratchpad-preview-state"
              aria-hidden={writing}
              inert={writing}
            >
              {dark ? uiText("Dark") : uiText("Light")}{" "}
              <I18nText id="· live draft" />
            </small>
          )}
        </div>
      </div>
      <div className="document-navigation-row" hidden={!writing}>
        <div
          className="settings-scratchpad-scroll ws-document-scroll"
          tabIndex={-1}
          ref={mount}
          id={writingId}
          hidden={!writing}
        />
        <div className="minimap-slot">
          <DocumentMinimap
            root={mount}
            navigation={navigation}
            adapter={adapter}
            active={active && writing}
            source={source}
            parsed={parsed}
            mode={mode}
            preferences={appearance.minimap}
            themeKey={`${dark}:${editorAppearanceKey(appearance)}`}
            minimumDocumentWidth={260}
            onChange={(minimap) =>
              onAppearanceChange?.({ ...current.current.appearance, minimap })
            }
          />
        </div>
      </div>
      {showInterface && (
        <div
          className="settings-interface-preview"
          id={interfaceId}
          hidden={writing}
        >
          <ThemeWorkbench
            preferences={appearance}
            dark={dark}
            active={active && !writing}
          />
        </div>
      )}
      <div className="scratchpad-footer">
        <span>
          {writing
            ? uiText("Private scratchpad · never saved or synced")
            : uiText("Interface specimen · no files or accounts are changed")}
        </span>
        {writing && message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
