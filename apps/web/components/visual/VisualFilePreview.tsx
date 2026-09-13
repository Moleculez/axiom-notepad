"use client";
import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize, ImagePlus } from "lucide-react";
import type { FilePreviewManifest } from "@axiom/shared/file-preview";
import { openVisual, type VisualAsset } from "../../lib/visual-assets";
import {
  inheritedVisualContext,
  visualPlacement,
} from "../../lib/visual-surface";
import { loadVisualMedia, type VisualMedia } from "../../lib/visual-media";
import {
  fitVisual,
  initialVisualTransform,
  zoomVisual,
} from "../../lib/visual-geometry";
import { bytes } from "../workspace/ui";
import { openContextMenu } from "../../lib/context-menu";
import VisualStage from "./VisualStage";
export default function VisualFilePreview({
  file,
  onEdit,
  gallery,
}: {
  file: FilePreviewManifest;
  onEdit: () => void;
  gallery?: VisualAsset[];
}) {
  const root = useRef<HTMLDivElement>(null),
    [media, setMedia] = useState<VisualMedia | null>(null),
    [error, setError] = useState(""),
    [t, setT] = useState(initialVisualTransform),
    [size, setSize] = useState({ w: 0, h: 0 });
  const asset = useRef<VisualAsset>({
    id: file.resourceId,
    kind: "image",
    url: file.source,
    name: file.name,
    mime: file.mime,
    bytes: file.bytes,
  });
  useEffect(() => {
    const abort = new AbortController();
    let owned: VisualMedia | undefined;
    const inherited = inheritedVisualContext(root.current!);
    asset.current = {
      id: file.resourceId,
      kind: "image",
      url: file.source,
      name: file.name,
      mime: file.mime,
      bytes: file.bytes,
      placement: visualPlacement(
        inherited ?? { resourceId: file.resourceId, versionId: file.versionId },
      ),
    };
    if (asset.current.placement)
      asset.current.placement.versionId = file.versionId;
    setMedia(null);
    setError("");
    void loadVisualMedia(asset.current, root.current!, abort.signal)
      .then((v) => {
        owned = v;
        if (abort.signal.aborted) v.dispose();
        else setMedia(v);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => {
      abort.abort();
      owned?.dispose();
    };
  }, [
    file.resourceId,
    file.versionId,
    file.source,
    file.name,
    file.mime,
    file.bytes,
  ]);
  useEffect(() => {
    if (media && size.w)
      setT({
        ...initialVisualTransform(),
        zoom: fitVisual(media.width, media.height, size.w, size.h),
      });
  }, [media, size.w, size.h]);
  const open = (initialPanel?: "info" | "markup") => {
    const items = gallery?.some((i) => i.id === asset.current.id)
        ? gallery.map((i) => (i.id === asset.current.id ? asset.current : i))
        : [asset.current],
      index = items.findIndex((i) => i.id === asset.current.id);
    const active = document.activeElement as HTMLElement | null;
    openVisual({
      items,
      index: Math.max(0, index),
      initialPanel,
      restore: () =>
        active?.isConnected && active.focus({ preventScroll: true }),
    });
  };
  return (
    <div ref={root} className="visual-file-preview">
      <div className="tool-controls">
        <span>
          {media
            ? `${media.width} × ${media.height} · ${bytes(file.bytes)}`
            : file.mime}
        </span>
        <span className="tool-spacer" />
        <button
          className="icon-button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => setT((v) => zoomVisual(v, v.zoom / 1.25))}
        >
          <ZoomOut size={16} />
        </button>
        <button
          className="button ghost"
          title="Fit image"
          onClick={() =>
            media &&
            setT({
              ...initialVisualTransform(),
              zoom: fitVisual(media.width, media.height, size.w, size.h),
            })
          }
        >
          {Math.round(t.zoom * 100)}%
        </button>
        <button
          className="icon-button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => setT((v) => zoomVisual(v, v.zoom * 1.25))}
        >
          <ZoomIn size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="View image larger"
          title="View image larger"
          onClick={() => open()}
        >
          <Maximize size={16} />
        </button>
        <button className="button secondary" onClick={onEdit}>
          <ImagePlus size={15} />
          {file.mime === "application/vnd.axiom.image+zip"
            ? "Open Image Studio"
            : "Edit a copy"}
        </button>
      </div>
      {error && (
        <p className="visual-notice is-error" role="alert">
          {error}
        </p>
      )}
      <div
        className="visual-file-stage"
        onKeyDown={(e) => {
          if (e.altKey && e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            open();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openContextMenu({
            owner: e.currentTarget,
            x: e.clientX,
            y: e.clientY,
            label: "Image actions",
            items: [
              {
                label: "View larger",
                icon: "focus",
                group: "View",
                action: () => open(),
              },
              {
                label: "Image information",
                icon: "info",
                group: "View",
                action: () => open("info"),
              },
              {
                label: "Annotate this placement",
                icon: "comment",
                group: "Markup",
                action: () => open("markup"),
              },
              {
                label: "Edit a copy",
                icon: "edit",
                group: "Edit",
                action: onEdit,
              },
            ],
          });
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          open();
        }}
      >
        <VisualStage
          media={media}
          transform={t}
          onTransform={setT}
          color="#d14b59"
          stroke={2}
          marks={[]}
          selected={null}
          onSelect={() => {}}
          onShape={() => {}}
          onSize={(w, h) => setSize({ w, h })}
          background="checker"
          userId=""
        />
      </div>
    </div>
  );
}
