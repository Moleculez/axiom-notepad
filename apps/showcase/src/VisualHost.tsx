import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";
import {
  Button,
  IconButton,
  NativeSelect,
} from "../../web/components/ui/controls";
import { useEffect, useRef, useState } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize,
  RotateCw,
  Download,
  Info,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import Dialog, { DialogFooter } from "../../web/components/Dialog";
import VisualStage from "../../web/components/visual/VisualStage";
import { useVisualFullscreen } from "../../web/components/visual/useVisualFullscreen";
import {
  loadVisualMedia,
  readVisualMetadata,
  exportVisual,
  type VisualMedia,
} from "../../web/lib/visual-media";
import {
  fitVisual,
  initialVisualTransform,
  zoomVisual,
} from "../../web/lib/visual-geometry";
import {
  visualOpenEvent,
  type VisualRequest,
} from "../../web/lib/visual-assets";
import { retainEditorCard } from "../../web/lib/editor-popover";
import { downloadBlob } from "../../web/lib/tools/download";
import type { MetadataField } from "../../web/lib/visual-metadata.worker";
import { store, useDemo } from "./context";
import { safeName } from "./store";

export default function VisualHost() {
  const [request, setRequest] = useState<VisualRequest | null>(null),
    current = useRef(request);
  current.current = request;
  useEffect(() => {
    let unpin: (() => void) | undefined;
    const close = () => {
      const previous = current.current;
      current.current = null;
      setRequest(null);
      unpin?.();
      unpin = undefined;
      requestAnimationFrame(() => previous?.restore?.());
    };
    const open = (event: Event) => {
      event.preventDefault();
      unpin?.();
      const value = (event as CustomEvent<VisualRequest>).detail;
      if (!value.items.length) return;
      current.current = value;
      unpin = retainEditorCard();
      setRequest(value);
    };
    window.addEventListener(visualOpenEvent, open);
    window.addEventListener("axiom:route", close);
    window.addEventListener("axiom:close-visual", close);
    return () => {
      window.removeEventListener(visualOpenEvent, open);
      window.removeEventListener("axiom:route", close);
      window.removeEventListener("axiom:close-visual", close);
      unpin?.();
    };
  }, []);
  return request ? (
    <Viewer
      key={request.items[request.index]?.id}
      request={request}
      close={() => window.dispatchEvent(new Event("axiom:close-visual"))}
    />
  ) : null;
}
function Viewer({
  request,
  close,
}: {
  request: VisualRequest;
  close: () => void;
}) {
  useInterfaceLocale();
  const [index, setIndex] = useState(request.index),
    [media, setMedia] = useState<VisualMedia | null>(null),
    [error, setError] = useState(""),
    [information, setInformation] = useState(false),
    [fields, setFields] = useState<MetadataField[]>([]),
    [transform, setTransform] = useState(initialVisualTransform),
    [size, setSize] = useState({ width: 1, height: 1 }),
    [format, setFormat] = useState("png");
  const stage = useRef<HTMLDivElement>(null),
    fullscreen = useVisualFullscreen(),
    { notify } = useDemo();
  const item = request.items[index];
  useEffect(() => {
    if (!item || !stage.current) return;
    const abort = new AbortController();
    let owned: VisualMedia | undefined;
    setError("");
    setMedia(null);
    setFields([]);
    const asset =
      item.kind === "image"
        ? {
            ...item,
            url: item.url?.startsWith("blob:")
              ? item.url
              : store.resolveImage(item.url ?? ""),
          }
        : item;
    if (item.kind === "image" && !asset.url) {
      setError("Import this image to view it in the local demo.");
      return;
    }
    void loadVisualMedia(asset, stage.current, abort.signal)
      .then((value) => {
        owned = value;
        if (abort.signal.aborted) {
          value.dispose();
          return;
        }
        setMedia(value);
        if (value.blob)
          void readVisualMetadata(value.blob, abort.signal)
            .then((metadata) => {
              if (!abort.signal.aborted) setFields(metadata);
            })
            .catch(() => {});
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(error.message);
      });
    return () => {
      abort.abort();
      owned?.dispose();
    };
  }, [item]);
  useEffect(() => {
    if (media)
      setTransform({
        ...initialVisualTransform(),
        zoom: fitVisual(media.width, media.height, size.width, size.height),
      });
  }, [media, size.width, size.height]);
  const download = async () => {
    if (!media) return;
    try {
      if (format === "original" && media.blob)
        downloadBlob(media.blob, safeName(item.name));
      else {
        const result = await exportVisual(
          media,
          format as "png" | "jpeg" | "webp" | "svg",
          1,
          undefined,
          [],
        );
        downloadBlob(
          result,
          `${safeName(item.name.replace(/\.[^.]+$/, ""))}.${format === "jpeg" ? "jpg" : format}`,
        );
      }
    } catch (error) {
      notify((error as Error).message);
    }
  };
  return (
    <Dialog
      title={item.name}
      subtitle={
        item.kind === "mermaid"
          ? uiText("Mermaid diagram · local rendered preview")
          : uiText("Image viewer · device-only file")
      }
      size="visual"
      surfaceRef={fullscreen.surface}
      expanded={fullscreen.expanded}
      className="demo-visual-dialog"
      onClose={close}
      onEscape={() => {
        if (fullscreen.active) void fullscreen.exit();
        else close();
      }}
    >
      <div className="demo-visual-toolbar">
        <IconButton
          className="icon-button"
          aria-label={uiText("Previous image")}
          disabled={index === 0}
          onClick={() => setIndex((i) => i - 1)}
        >
          <ArrowLeft size={16} />
        </IconButton>
        <IconButton
          className="icon-button"
          aria-label={uiText("Next image")}
          disabled={index >= request.items.length - 1}
          onClick={() => setIndex((i) => i + 1)}
        >
          <ArrowRight size={16} />
        </IconButton>
        <span className="tool-spacer" />
        <IconButton
          className="icon-button"
          aria-label={uiText("Zoom out")}
          onClick={() =>
            setTransform(zoomVisual(transform, transform.zoom / 1.2, [0, 0]))
          }
        >
          <ZoomOut size={17} />
        </IconButton>
        <span>{Math.round(transform.zoom * 100)}%</span>
        <IconButton
          className="icon-button"
          aria-label={uiText("Zoom in")}
          onClick={() =>
            setTransform(zoomVisual(transform, transform.zoom * 1.2, [0, 0]))
          }
        >
          <ZoomIn size={17} />
        </IconButton>
        <Button
          className="button ghost"
          onClick={() =>
            media &&
            setTransform({
              ...initialVisualTransform(),
              zoom: fitVisual(
                media.width,
                media.height,
                size.width,
                size.height,
              ),
            })
          }
        >
          <I18nText id="Fit" />
        </Button>
        <IconButton
          className="icon-button"
          aria-label={uiText("Rotate image")}
          onClick={() =>
            setTransform((t) => ({ ...t, rotation: (t.rotation + 90) % 360 }))
          }
        >
          <RotateCw size={17} />
        </IconButton>
        <IconButton
          className="icon-button"
          aria-label={uiText("Image information")}
          aria-pressed={information}
          onClick={() => setInformation((old) => !old)}
        >
          <Info size={17} />
        </IconButton>
        <IconButton
          className="icon-button"
          aria-label={
            fullscreen.active
              ? uiText("Exit fullscreen")
              : uiText("Fullscreen viewer")
          }
          onClick={() => void fullscreen.toggle()}
        >
          {fullscreen.active ? <Minimize size={17} /> : <Maximize size={17} />}
        </IconButton>
      </div>
      <div className="demo-visual-body" ref={stage}>
        <div className="demo-visual-stage">
          {error ? (
            <p role="alert">{error}</p>
          ) : media ? (
            <VisualStage
              media={media}
              transform={transform}
              onTransform={setTransform}
              tool="pan"
              marks={[]}
              selected={null}
              color="#447869"
              stroke={2}
              background="checker"
              userId="showcase"
              onSelect={() => {}}
              onShape={() => {}}
              onSize={(width, height) =>
                setSize((old) =>
                  old.width === width && old.height === height
                    ? old
                    : { width, height },
                )
              }
            />
          ) : (
            <p>
              <I18nText id="Opening visual preview…" />
            </p>
          )}
        </div>
        {information && (
          <aside className="demo-visual-info">
            <h3>
              <I18nText id="Information" />
            </h3>
            <dl>
              <dt>
                <I18nText id="Dimensions" />
              </dt>
              <dd>{media ? `${media.width} × ${media.height}` : "—"}</dd>
              <dt>
                <I18nText id="Size" />
              </dt>
              <dd>
                {((media?.blob?.size ?? item.bytes ?? 0) / 1024).toFixed(1)}{" "}
                <I18nText id="KB" />
              </dd>
              <dt>
                <I18nText id="Type" />
              </dt>
              <dd>{media?.blob?.type || item.mime || item.kind}</dd>
              {fields.slice(0, 30).map((field) => (
                <div key={`${field.group}:${field.name}`}>
                  <dt>{field.name}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
            {!fields.length && (
              <p>
                <I18nText id="No additional EXIF metadata." />
              </p>
            )}
          </aside>
        )}
      </div>
      <DialogFooter>
        <span>{media?.notice || "Drag to pan · scroll to zoom"}</span>
        <NativeSelect
          aria-label={uiText("Visual export format")}
          value={format}
          onChange={(e) => setFormat(e.target.value)}
        >
          <option value="png">
            <I18nText id="PNG" />
          </option>
          <option value="jpeg">
            <I18nText id="JPEG" />
          </option>
          <option value="webp">
            <I18nText id="WebP" />
          </option>
          {media?.svg && (
            <option value="svg">
              <I18nText id="SVG" />
            </option>
          )}
          {item.kind === "image" && (
            <option value="original">
              <I18nText id="Original" />
            </option>
          )}
        </NativeSelect>
        <Button
          className="button secondary"
          disabled={!media}
          onClick={() => void download()}
        >
          <Download size={15} />
          <I18nText id="Download" />
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
