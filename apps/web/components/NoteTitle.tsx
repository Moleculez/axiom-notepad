"use client";
import { useLayoutEffect, useRef } from "react";

// Textarea rows cannot predict wrapping after a font, zoom, or pane-size change.
export default function NoteTitle({
  value,
  typography,
  onSave,
  onContinue,
}: {
  value: string;
  typography: unknown;
  onSave: (value: string) => void;
  onContinue: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = node.scrollHeight + "px";
  };
  useLayoutEffect(() => {
    resize();
  }, [typography]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let width = 0,
      frame = 0,
      alive = true;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next !== width) {
        width = next;
        // Mutating a measured textarea during observer delivery raises a
        // ResizeObserver loop error in WebKit. Resize on the following frame.
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (alive) resize();
        });
      }
    });
    observer.observe(node);
    void document.fonts.ready.then(() => {
      if (alive) resize();
    });
    resize();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return (
    <textarea
      ref={ref}
      className="document-title"
      aria-label="Note title"
      defaultValue={value}
      rows={1}
      onInput={resize}
      onBlur={(event) => {
        const title = event.currentTarget.value.trim();
        if (title && title !== value) onSave(title);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.blur();
          onContinue();
        }
      }}
    />
  );
}
