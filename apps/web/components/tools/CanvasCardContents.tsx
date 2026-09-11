"use client";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { GripVertical, LockKeyhole, MoreHorizontal } from "lucide-react";
import { canvasTitle, type CanvasNode } from "@axiom/shared/canvas";
import type { ResourceCardPreview } from "@axiom/shared/canvas-preview";
import CanvasTextCard from "./CanvasTextCard";
import {
  CanvasLinkPreview,
  CanvasMarkdownPreview,
  CanvasPreviewBoundary,
  CanvasResourcePreview,
} from "./CanvasPreviews";

type Props = {
  node: CanvasNode;
  active: boolean;
  readOnly: boolean;
  sizingOwner: boolean;
  parentId: string;
  text?: Y.Text;
  undo: Y.UndoManager | null;
  awareness: Awareness | null;
  activate: () => void;
  done: () => void;
  menu: (event: MouseEvent) => void;
  renaming: boolean;
  rename: (title: string) => boolean;
  cancelRename: () => void;
  height: (height: number, expected: CanvasNode) => void;
  resolved: (preview: ResourceCardPreview | null) => void;
};
export default function CanvasCardContents(props: Props) {
  const { node } = props,
    host = useRef<HTMLDivElement>(null),
    composing = useRef(false),
    current = useRef(props);
  current.current = props;
  useEffect(() => {
    const root = host.current;
    if (
      !root ||
      props.readOnly ||
      !props.sizingOwner ||
      node.heightMode !== "auto" ||
      node.locked ||
      node.type === "group"
    )
      return;
    let timer: ReturnType<typeof setTimeout> | undefined,
      alive = true;
    const measure = () => {
      if (!alive) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const p = current.current,
          n = p.node;
        if (
          composing.current ||
          p.readOnly ||
          !p.sizingOwner ||
          n.heightMode !== "auto" ||
          n.locked
        )
          return;
        const text = root.querySelector<HTMLElement>(".canvas-size-measure"),
          content = root.querySelector<HTMLElement>(".canvas-preview-content"),
          img = content?.querySelector("img");
        const value =
          n.type === "link"
            ? 350
            : text
              ? text.scrollHeight + 36
              : img?.naturalWidth
                ? (img.naturalHeight / img.naturalWidth) * (n.width - 2) + 76
                : content
                  ? Math.max(
                      100,
                      content.firstElementChild?.scrollHeight ??
                        content.scrollHeight,
                    ) + 76
                  : 200;
        const height = Math.round(Math.max(120, Math.min(800, value)));
        if (Math.abs(n.height - height) > 1) p.height(height, n);
      }, 180);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    for (const el of root.querySelectorAll(
      ".canvas-size-measure,.reading-view,.canvas-preview-content,img,.canvas-nested-stage",
    ))
      resize.observe(el);
    const mutation = new MutationObserver(() => {
      for (const el of root.querySelectorAll(
        ".canvas-size-measure,.reading-view,.canvas-preview-content,img",
      ))
        resize.observe(el);
      measure();
    });
    mutation.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    root.addEventListener("load", measure, true);
    root.addEventListener("axiom:math-rendered", measure);
    root.addEventListener("compositionend", measure);
    void document.fonts.ready.then(measure);
    measure();
    return () => {
      alive = false;
      clearTimeout(timer);
      resize.disconnect();
      mutation.disconnect();
      root.removeEventListener("load", measure, true);
      root.removeEventListener("axiom:math-rendered", measure);
      root.removeEventListener("compositionend", measure);
    };
  }, [
    node.id,
    node.heightMode,
    node.locked,
    node.width,
    props.sizingOwner,
    props.readOnly,
  ]);
  const heading = (
    <div className="canvas-card-heading">
      <GripVertical size={13} className="canvas-card-grip" />
      {props.renaming ? (
        <CardNameInput
          initial={
            node.title ?? (node.type === "group" ? (node.label ?? "") : "")
          }
          save={props.rename}
          cancel={props.cancelRename}
        />
      ) : (
        <span className="canvas-card-name" title={canvasTitle(node)}>
          {canvasTitle(node)}
        </span>
      )}
      {node.locked && <LockKeyhole size={12} aria-label="Position locked" />}
    </div>
  );
  const actions = (
    <button
      type="button"
      className="icon-button canvas-card-more"
      aria-label="Card actions"
      title="Card actions"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={props.menu}
    >
      <MoreHorizontal size={16} />
    </button>
  );
  return (
    <div
      className="canvas-card-shell"
      ref={host}
      onCompositionStartCapture={() => {
        composing.current = true;
      }}
      onCompositionEndCapture={() => {
        composing.current = false;
      }}
    >
      <CanvasPreviewBoundary
        resetKey={`${node.id}:${node.type}:${node.type === "file" ? node.resourceId : node.type === "text" ? node.text : ""}`}
      >
        {node.type === "text" ? (
          <CanvasTextCard
            source={node.text}
            text={props.text}
            active={props.active}
            undo={props.undo}
            awareness={props.awareness}
            readOnly={props.readOnly}
            activate={props.activate}
            done={props.done}
            heading={heading}
            actions={actions}
          />
        ) : (
          <>
            <header className="canvas-card-toolbar">
              {heading}
              {actions}
            </header>
            {node.type === "file" ? (
              <CanvasResourcePreview
                node={node}
                active={props.active}
                onActivate={props.activate}
                onDone={props.done}
                ancestors={[props.parentId]}
                onResolved={props.resolved}
              />
            ) : node.type === "link" ? (
              <CanvasLinkPreview
                node={node}
                active={props.active}
                onActivate={props.activate}
                onDone={props.done}
              />
            ) : null}
          </>
        )}
      </CanvasPreviewBoundary>
      {node.type === "text" &&
        node.heightMode === "auto" &&
        props.sizingOwner &&
        !props.readOnly && (
          <div className="canvas-size-measure" aria-hidden="true" inert>
            <CanvasMarkdownPreview source={node.text} />
          </div>
        )}
    </div>
  );
}
function CardNameInput({
  initial,
  save,
  cancel,
}: {
  initial: string;
  save: (value: string) => boolean;
  cancel: () => void;
}) {
  const [value, setValue] = useState(initial),
    finished = useRef(false);
  const commit = () => {
    if (!finished.current && save(value.trim())) finished.current = true;
  };
  return (
    <input
      autoFocus
      aria-label="Card name"
      maxLength={200}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          finished.current = true;
          cancel();
        }
      }}
    />
  );
}
