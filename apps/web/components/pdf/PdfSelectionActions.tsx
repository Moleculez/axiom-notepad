"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Copy,
  Quote,
  StickyNote,
  X,
  Underline,
  Strikethrough,
} from "lucide-react";
import type { AnnotationData } from "@axiom/shared/research";
export type PdfSelection = {
  data: AnnotationData;
  anchor: { left: number; right: number; top: number; bottom: number };
};
export default function PdfSelectionActions({
  selection,
  busy,
  onHighlight,
  onMarkup,
  onNote,
  onCopy,
  onQuote,
  onClose,
}: {
  selection: PdfSelection;
  busy: boolean;
  onHighlight: (color: AnnotationData["color"]) => void;
  onMarkup: (kind: "underline" | "strikeout") => void;
  onNote: () => void;
  onCopy: () => void;
  onQuote: () => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState({
    left: selection.anchor.left,
    top: selection.anchor.bottom + 8,
  });
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    const a = selection.anchor;
    setPosition({
      left: Math.max(
        8,
        Math.min(
          window.innerWidth - box.width - 8,
          (a.left + a.right - box.width) / 2,
        ),
      ),
      top:
        a.top > box.height + 12
          ? a.top - box.height - 8
          : Math.max(
              8,
              Math.min(a.bottom + 8, window.innerHeight - box.height - 8),
            ),
    });
  }, [selection]);
  useEffect(() => {
    const dismiss = () => close.current();
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) dismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    };
    const collapsed = () => {
      if (window.getSelection()?.isCollapsed) dismiss();
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    document.addEventListener("selectionchange", collapsed);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
      document.removeEventListener("selectionchange", collapsed);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, []);
  return (
    <div
      ref={root}
      className="pdf-selection-actions"
      role="toolbar"
      aria-label="Selected text actions"
      style={position}
      onMouseDown={(event) => event.preventDefault()}
    >
      {(["yellow", "green", "blue", "pink"] as const).map((color) => (
        <button
          key={color}
          className={`highlight-color ${color}`}
          disabled={busy}
          title={`Highlight privately in ${color}`}
          aria-label={`Highlight privately in ${color}`}
          onClick={() => onHighlight(color)}
        />
      ))}
      <span className="pdf-tool-divider" />
      {(["underline", "strikeout"] as const).map((kind) => {
        const Icon = kind === "underline" ? Underline : Strikethrough;
        return (
          <button
            key={kind}
            className="icon-button"
            disabled={busy}
            title={
              kind === "underline"
                ? "Underline privately"
                : "Strike through privately"
            }
            aria-label={
              kind === "underline"
                ? "Underline selected PDF text"
                : "Strike through selected PDF text"
            }
            onClick={() => onMarkup(kind)}
          >
            <Icon size={15} />
          </button>
        );
      })}
      <button
        className="icon-button"
        disabled={busy}
        title="Copy text"
        aria-label="Copy selected PDF text"
        onClick={onCopy}
      >
        <Copy size={15} />
      </button>
      <button
        className="icon-button"
        disabled={busy}
        title="Insert quotation with citation"
        aria-label="Insert selected PDF quotation"
        onClick={onQuote}
      >
        <Quote size={15} />
      </button>
      <button
        className="icon-button"
        disabled={busy}
        title="Add annotation note"
        aria-label="Add note to selected PDF text"
        onClick={onNote}
      >
        <StickyNote size={15} />
      </button>
      <button
        className="icon-button"
        title="Dismiss selection actions"
        aria-label="Dismiss selection actions"
        onClick={onClose}
      >
        <X size={14} />
      </button>
    </div>
  );
}
