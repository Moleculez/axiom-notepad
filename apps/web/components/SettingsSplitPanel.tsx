"use client";
import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const defaultWidth = 44;
const clamp = (value: number) => Math.min(64, Math.max(32, value));

/** A local layout preference, never part of a synced appearance draft. */
export default function SettingsSplitPanel({
  children,
  preview,
  showPreview,
}: {
  children: ReactNode;
  preview?: ReactNode;
  showPreview: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    drag = useRef<{ start: number; width: number; ratio: number } | null>(null),
    fieldsId = useId(),
    previewId = useId();
  const [width, setWidth] = useState(defaultWidth),
    [resizing, setResizing] = useState(false);
  return (
    <div
      ref={root}
      className="settings-split"
      data-preview={!!preview && showPreview}
      data-resizing={resizing || undefined}
      style={{ "--settings-fields": `${width}%` } as CSSProperties}
    >
      <div className="settings-fields-pane" id={fieldsId}>
        {children}
      </div>
      {preview && (
        <>
          <div
            className="settings-split-handle"
            role="separator"
            aria-label="Resize settings and preview"
            aria-orientation="vertical"
            aria-controls={`${fieldsId} ${previewId}`}
            aria-valuemin={32}
            aria-valuemax={64}
            aria-valuenow={Math.round(width)}
            aria-valuetext={`${Math.round(width)}% settings, ${100 - Math.round(width)}% preview`}
            tabIndex={showPreview ? 0 : -1}
            title="Drag to resize · Arrow keys to adjust · Double-click to reset"
            onDoubleClick={() => setWidth(defaultWidth)}
            onPointerDown={(event) => {
              if (event.button !== 0 || !root.current) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                start: event.clientX,
                width: root.current.clientWidth,
                ratio: width,
              };
              setResizing(true);
            }}
            onPointerMove={(event) => {
              if (!drag.current) return;
              setWidth(
                clamp(
                  drag.current.ratio +
                    ((event.clientX - drag.current.start) /
                      drag.current.width) *
                      100,
                ),
              );
            }}
            onPointerUp={(event) => {
              drag.current = null;
              setResizing(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onLostPointerCapture={() => {
              drag.current = null;
              setResizing(false);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setResizing(false);
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 5 : 2;
              const next =
                event.key === "ArrowLeft"
                  ? width - step
                  : event.key === "ArrowRight"
                    ? width + step
                    : event.key === "Home"
                      ? 32
                      : event.key === "End"
                        ? 64
                        : event.key === "Enter"
                          ? defaultWidth
                          : null;
              if (next === null) return;
              event.preventDefault();
              setWidth(clamp(next));
            }}
          >
            <span aria-hidden="true" />
          </div>
          <aside
            className="settings-preview-pane"
            id={previewId}
            aria-label="Live settings preview"
            hidden={!showPreview}
          >
            {preview}
          </aside>
        </>
      )}
    </div>
  );
}
