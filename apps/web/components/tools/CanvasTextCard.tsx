"use client";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { GripHorizontal } from "lucide-react";
import { parseMarkdown } from "@axiom/markdown";
import { NativeBinding } from "@axiom/editor/binding";
import { EditorView } from "../../lib/editor-view";
import {
  installMarkdownVisuals,
  visualTextAnchor,
} from "../../lib/visual-surface";
import ReadingView from "../ReadingView";
import { useWorkspace } from "../workspace/ui";

type Mode = "write" | "source";
type Props = {
  text: Y.Text | undefined;
  source: string;
  active: boolean;
  undo: Y.UndoManager | null;
  awareness: Awareness | null;
  readOnly: boolean;
  activate: () => void;
  done: () => void;
  heading?: ReactNode;
  actions?: ReactNode;
};

/** Only the active card needs a full editor. Inactive cards render immediately;
 * editing binds directly to the same nested Y.Text, never a disposable copy. */
export default function CanvasTextCard(props: Props) {
  const [mode, setMode] = useState<Mode>("write");
  const changeMode = (next: Mode) => {
    setMode(next);
    props.activate();
  };
  return (
    <div className="canvas-text-card">
      <header className="canvas-card-toolbar">
        {props.heading ?? (
          <span className="canvas-card-grip" title="Drag to move card">
            <GripHorizontal size={14} /> Text
          </span>
        )}
        <div
          role="group"
          aria-label="Card editor mode"
          className="scratchpad-modes"
        >
          {(["write", "source"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              title={
                value === "write"
                  ? "Rich text · ⌘/ toggles source"
                  : "Markdown source · ⌘/ toggles writing"
              }
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => changeMode(value)}
            >
              {value === "write" ? "Write" : "Source"}
            </button>
          ))}
        </div>
        {props.actions}
      </header>
      {props.active && props.text && props.undo ? (
        <CardEditor
          text={props.text}
          undo={props.undo}
          awareness={props.awareness}
          mode={mode}
          readOnly={props.readOnly}
          toggle={() =>
            setMode((value) => (value === "write" ? "source" : "write"))
          }
          done={props.done}
        />
      ) : (
        <div className="canvas-card-body" title="Double-click to edit">
          {props.source ? (
            <CardPreview source={props.source} text={props.text} />
          ) : (
            <p className="canvas-placeholder">
              Double-click to write a thought…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const CardPreview = memo(function CardPreview({
  source,
  text,
}: {
  source: string;
  text?: Y.Text;
}) {
  const { appearance, open } = useWorkspace();
  const parsed = useMemo(() => parseMarkdown(source), [source]);
  const context = useMemo(
    () => ({ theme: appearance.dark ? ("dark" as const) : ("light" as const) }),
    [appearance.dark],
  );
  return (
    <ReadingView
      source={source}
      visualAnchor={
        text ? (from, to) => visualTextAnchor(text, from, to) : undefined
      }
      parsed={parsed}
      context={context}
      onLink={(target) => {
        if (/^[\da-f-]{36}$/i.test(target)) open({ id: target, kind: "note" });
      }}
    />
  );
});

function CardEditor({
  text,
  undo,
  awareness,
  mode,
  readOnly,
  toggle,
  done,
}: {
  text: Y.Text;
  undo: Y.UndoManager;
  awareness: Awareness | null;
  mode: Mode;
  readOnly: boolean;
  toggle: () => void;
  done: () => void;
}) {
  const { appearance, editorSettings, notify, open } = useWorkspace();
  const mount = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null);
  const current = useRef({
    appearance,
    editorSettings,
    mode,
    readOnly,
    toggle,
    notify,
    open,
    done,
  });
  current.current = {
    appearance,
    editorSettings,
    mode,
    readOnly,
    toggle,
    notify,
    open,
    done,
  };
  useEffect(() => {
    if (!mount.current || !text.doc) return;
    let alive = true;
    undo.stopCapturing();
    const binding = new NativeBinding(text.doc, undo, awareness, text);
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
      workspace: (command) =>
        command === "source"
          ? current.current.toggle()
          : current.current.notify(
              "Open the canvas discussion or the original note for workspace actions.",
            ),
      message: (message) => current.current.notify(message),
      recover: () =>
        current.current.notify(
          "Your card is saved in the canvas journal. Export the canvas to retain a separate copy.",
        ),
      prepare: () => {},
      navigate: () => {},
      link: (target) => {
        if (/^[\da-f-]{36}$/i.test(target))
          current.current.open({ id: target, kind: "note" });
      },
      changed: () => {},
      exit: () => current.current.done(),
      notes: () => [],
      files: () =>
        current.current.notify(
          "Use Add file card to include workspace images and attachments.",
        ),
    });
    if ("setLabel" in editor)
      editor.setLabel("Card Markdown", "canvas-card-editor");
    else {
      editor.content.setAttribute("aria-label", "Card Markdown");
      editor.content.dataset.testid = "canvas-card-editor";
    }
    view.current = editor;
    const closeVisuals = installMarkdownVisuals(editor.dom, {
      selection: () => editor.selection,
      parsed: () => editor.parsed,
      source: () => editor.source,
      binding,
      captureRestore: () => {
        const at = binding.relative(editor.selection);
        return () => {
          const s = binding.absolute(at);
          if (alive && s) editor.focus(s.anchor, s.head);
        };
      },
      editorMenu: (x, y, at) =>
        editor.openBlockMenu(x, y, { anchor: at, head: at }),
    });
    void Promise.resolve("ready" in editor ? editor.ready : undefined).then(
      () => {
        if (alive && !current.current.readOnly)
          editor.focus(binding.source.length);
      },
    );
    return () => {
      alive = false;
      view.current = null;
      undo.stopCapturing();
      closeVisuals();
      editor.destroy();
    };
  }, [text, undo, awareness]);
  useEffect(() => {
    view.current?.configure();
  }, [
    appearance.effective,
    appearance.dark,
    editorSettings.effective,
    mode,
    readOnly,
  ]);
  return (
    <div
      className="canvas-card-editor"
      ref={mount}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          done();
        }
      }}
    />
  );
}
