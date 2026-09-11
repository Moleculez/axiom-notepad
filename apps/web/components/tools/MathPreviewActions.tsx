"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Blend,
  Check,
  Copy,
  Download,
  LoaderCircle,
  MoreHorizontal,
} from "lucide-react";
import { openContextMenu } from "../../lib/context-menu";
import {
  captureMathPreview,
  clipboardSupports,
  copyMathImage,
  mathClipboardPlan,
  mathImageLabel,
  type MathImageFormat,
  type MathImageSettings,
} from "../../lib/tools/math-export";

export default function MathPreviewActions({
  preview,
  format,
  onFormat,
  request,
  latex,
  settings,
  onScale,
  onTransparent,
  onExport,
  onPanel,
  onError,
  notify,
}: {
  preview: RefObject<HTMLDivElement | null>;
  format: MathImageFormat;
  onFormat: (format: MathImageFormat) => void;
  request: string;
  latex: string;
  settings: MathImageSettings;
  onScale: (value: number) => void;
  onTransparent: (value: boolean) => void;
  onExport: (format: MathImageFormat) => Promise<void>;
  onPanel: (panel: "export" | "settings") => void;
  onError: (message: string) => void;
  notify: (message: string) => void;
}) {
  const [ready, setReady] = useState<string | null>(null),
    [working, setWorking] = useState(false),
    [copied, setCopied] = useState(false),
    [expanded, setExpanded] = useState(false),
    [hint, setHint] = useState("");
  const locked = useRef(false),
    menu = useRef<(() => void) | null>(null),
    feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
  const valid = ready === request && !!latex.trim();
  useEffect(() => {
    const element = preview.current;
    const update = () => {
      const math = element?.querySelector<HTMLElement>("[data-math-request]");
      setReady(
        math?.dataset.mathState === "ready" && math.querySelector("svg")
          ? (math.dataset.mathRequest ?? null)
          : null,
      );
    };
    update();
    element?.addEventListener("axiom:math-rendered", update);
    // Menu commands belong to the equation shown when the menu was opened.
    menu.current?.();
    return () => element?.removeEventListener("axiom:math-rendered", update);
  }, [preview, request]);
  useEffect(() => {
    const plan = mathClipboardPlan(format, clipboardSupports);
    setHint(
      format === "svg"
        ? plan.mime === "text/plain"
          ? "Copy uses SVG markup · Download saves the vector file"
          : "Vector artwork · sharp at any size"
        : format === "jpeg"
          ? plan.mime === "image/png"
            ? "JPG download · clipboard uses opaque PNG"
            : "JPG uses your paper color · no transparency"
          : "PNG image · ready for documents and slides",
    );
    setCopied(false);
    menu.current?.();
  }, [
    format,
    request,
    settings.foreground,
    settings.background,
    settings.transparent,
    settings.scale,
  ]);
  useEffect(
    () => () => {
      menu.current?.();
      clearTimeout(feedbackTimer.current);
    },
    [],
  );
  const run = async (action: () => Promise<string | void>) => {
    if (locked.current) return;
    locked.current = true;
    setWorking(true);
    setCopied(false);
    onError("");
    try {
      const message = await action();
      if (message) {
        notify(message);
        setCopied(true);
        clearTimeout(feedbackTimer.current);
        feedbackTimer.current = setTimeout(() => setCopied(false), 2000);
      }
    } catch (error) {
      onError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Clipboard access was denied. Allow clipboard access in your browser or use Download instead."
          : error instanceof Error
            ? error.message
            : "The equation could not be copied. Use Download instead.",
      );
    } finally {
      locked.current = false;
      setWorking(false);
    }
  };
  const copyText = (kind: "latex" | "mathml") =>
    run(async () => {
      if (!navigator.clipboard?.writeText)
        throw new Error(
          "Clipboard is unavailable. Use Export to download the source instead.",
        );
      let value = latex;
      if (kind === "mathml") {
        const { math } = captureMathPreview(preview.current, request, settings);
        if (!math) throw new Error("MathML is unavailable for this equation.");
        value = new XMLSerializer().serializeToString(math);
      }
      await navigator.clipboard.writeText(value);
      return kind === "latex"
        ? "LaTeX copied, including project macros."
        : "MathML copied.";
    });
  return (
    <div className="math-preview-tools">
      <div className="math-preview-label">
        <span>LIVE PREVIEW</span>
        <div
          className="math-preview-actions"
          role="group"
          aria-label="Equation copy and download"
        >
          <div className="math-copy-control">
            <select
              aria-label="Preview image format"
              value={format}
              disabled={working}
              onChange={(event) =>
                onFormat(event.target.value as MathImageFormat)
              }
            >
              <option value="svg">SVG</option>
              <option value="png">PNG</option>
              <option value="jpeg">JPG</option>
            </select>
            <button
              type="button"
              disabled={!valid || working}
              aria-label={`Copy ${mathImageLabel[format]}`}
              title={`Copy ${mathImageLabel[format]} · ${hint}`}
              onClick={() =>
                void run(() => {
                  const { svg } = captureMathPreview(
                    preview.current,
                    request,
                    settings,
                  );
                  return copyMathImage(svg, format, settings);
                })
              }
            >
              {working ? (
                <LoaderCircle size={14} className="math-export-spinner" />
              ) : copied ? (
                <Check size={14} />
              ) : (
                <Copy size={14} />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            className="icon-button"
            disabled={!valid || working}
            aria-label={`Download ${mathImageLabel[format]}`}
            title={`Download ${mathImageLabel[format]}`}
            onClick={() => void run(() => onExport(format))}
          >
            <Download size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="More preview actions"
            title="More preview actions"
            aria-haspopup="menu"
            aria-expanded={expanded}
            onClick={(event) => {
              if (expanded) {
                menu.current?.();
                return;
              }
              const owner = event.currentTarget,
                box = owner.getBoundingClientRect();
              setExpanded(true);
              menu.current = openContextMenu({
                owner,
                x: box.right - 280,
                y: box.bottom + 6,
                label: "Preview actions",
                restore: () => owner.focus({ preventScroll: true }),
                onClose: () => setExpanded(false),
                items: [
                  {
                    label: "Copy LaTeX",
                    icon: "code",
                    group: "Source",
                    disabled: !latex.trim() || working,
                    action: () => void copyText("latex"),
                  },
                  {
                    label: "Copy MathML",
                    icon: "copy",
                    group: "Source",
                    disabled: !valid || working,
                    action: () => void copyText("mathml"),
                  },
                  {
                    label: "All export formats…",
                    icon: "download",
                    group: "Equation",
                    action: () => onPanel("export"),
                  },
                  {
                    label: "Rendering settings…",
                    icon: "settings",
                    group: "Equation",
                    action: () => onPanel("settings"),
                  },
                ],
              });
            }}
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
      </div>
      <div className="math-preview-options">
        <label title="Pixel resolution for copied and downloaded PNG/JPG images">
          Resolution
          <select
            aria-label="Preview export resolution"
            value={settings.scale}
            disabled={format === "svg" || working}
            onChange={(event) => onScale(Number(event.target.value))}
          >
            {[1, 2, 3, 4, 6].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label="Transparent image background"
          aria-pressed={settings.transparent && format !== "jpeg"}
          disabled={format === "jpeg" || working}
          title={
            format === "jpeg"
              ? "JPG always uses the paper color"
              : "Toggle transparency for SVG and PNG; save in Rendering settings to remember it"
          }
          onClick={() => onTransparent(!settings.transparent)}
        >
          <Blend size={13} />
          Transparent
        </button>
      </div>
      <p className="math-preview-copy-hint">
        {hint || "Copy or download your equation locally"}
      </p>
    </div>
  );
}
