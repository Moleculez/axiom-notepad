import { uiText, useInterfaceLocale } from "@axiom/i18n/react";
import type { MindmapLayout, MindmapCamera } from "@axiom/mindmap";
import { IconButton, Button } from "../ui/controls";
import { X } from "lucide-react";

/** Lightweight geometry only: no second renderer, external media or source edits. */
export default function MindmapOverview({
  layout,
  camera,
  viewport,
  onCamera,
  onClose,
}: {
  layout: MindmapLayout;
  camera: MindmapCamera;
  viewport: { width: number; height: number };
  onCamera: (camera: MindmapCamera) => void;
  onClose: () => void;
}) {
  useInterfaceLocale();
  const bounds = {
    x: layout.bounds.x - 30,
    y: layout.bounds.y - 30,
    width: layout.bounds.width + 60,
    height: layout.bounds.height + 60,
  };
  return (
    <aside
      className="mindmap-overview"
      aria-label={uiText("Mind-map overview")}
    >
      <IconButton
        label={uiText("Hide map overview")}
        className="mindmap-overview-close"
        onClick={onClose}
      >
        <X size={14} />
      </IconButton>
      <Button
        variant="ghost"
        className="mindmap-overview-canvas"
        aria-label={uiText(
          "Navigate map overview. Click or use arrow keys to pan.",
        )}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          const svg = e.currentTarget.querySelector("svg")!,
            rect = svg.getBoundingClientRect();
          const factor = Math.min(
              rect.width / bounds.width,
              rect.height / bounds.height,
            ),
            offsetX = (rect.width - bounds.width * factor) / 2,
            offsetY = (rect.height - bounds.height * factor) / 2;
          const x = bounds.x + (e.clientX - rect.left - offsetX) / factor,
            y = bounds.y + (e.clientY - rect.top - offsetY) / factor;
          onCamera({
            ...camera,
            x: viewport.width / 2 - x * camera.scale,
            y: viewport.height / 2 - y * camera.scale,
          });
        }}
        onPointerMove={(e) => {
          if (
            e.currentTarget.hasPointerCapture(e.pointerId) &&
            e.buttons === 1
          ) {
            const svg = e.currentTarget.querySelector("svg")!,
              rect = svg.getBoundingClientRect(),
              factor = Math.min(
                rect.width / bounds.width,
                rect.height / bounds.height,
              );
            const x =
                bounds.x +
                (e.clientX -
                  rect.left -
                  (rect.width - bounds.width * factor) / 2) /
                  factor,
              y =
                bounds.y +
                (e.clientY -
                  rect.top -
                  (rect.height - bounds.height * factor) / 2) /
                  factor;
            onCamera({
              ...camera,
              x: viewport.width / 2 - x * camera.scale,
              y: viewport.height / 2 - y * camera.scale,
            });
          }
        }}
        onKeyDown={(e) => {
          if (
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
          )
            return;
          e.preventDefault();
          e.stopPropagation();
          const delta = e.shiftKey ? 120 : 40;
          onCamera({
            ...camera,
            x:
              camera.x +
              (e.key === "ArrowLeft"
                ? delta
                : e.key === "ArrowRight"
                  ? -delta
                  : 0),
            y:
              camera.y +
              (e.key === "ArrowUp"
                ? delta
                : e.key === "ArrowDown"
                  ? -delta
                  : 0),
          });
        }}
      >
        <svg
          viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
          aria-hidden="true"
        >
          {layout.nodes.map((node) => (
            <rect
              key={node.id}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              className="mindmap-overview-node"
            />
          ))}
          <rect
            x={-camera.x / camera.scale}
            y={-camera.y / camera.scale}
            width={viewport.width / camera.scale}
            height={viewport.height / camera.scale}
            className="mindmap-overview-window"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </Button>
    </aside>
  );
}
