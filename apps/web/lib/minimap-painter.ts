import { clamp, minimapY, type MinimapBlock } from "@axiom/editor/minimap";
import type { MinimapPreferences } from "@axiom/shared/minimap";

/** Paint into a spare bounded bitmap, then swap atomically. Typing must never
 * alternate between a blank canvas and a half-painted document. */
export function paintMinimap(
  canvas: HTMLCanvasElement,
  blocks: readonly MinimapBlock[],
  options: {
    width: number;
    height: number;
    scale: number;
    offset: number;
    mode: string;
    rendering: MinimapPreferences["rendering"];
  },
) {
  const dpr = clamp(window.devicePixelRatio, 1, 2);
  const width = Math.max(1, Math.ceil(options.width)),
    height = Math.max(1, Math.min(4096, Math.ceil(options.height)));
  const buffer = document.createElement("canvas");
  buffer.width = Math.ceil(width * dpr);
  buffer.height = Math.ceil(height * dpr);
  const ctx = buffer.getContext("2d");
  if (!ctx) return () => {};
  ctx.scale(dpr, dpr * (height / Math.max(1, options.height)));
  const style = getComputedStyle(canvas);
  const color = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  const colors = {
    text: color("--text", "#555"),
    muted: color("--muted", "#777"),
    accent: color("--accent", "#5679ad"),
    syntax: color("--syntax", "#9671ad"),
    line: color("--line", "#aaa"),
  };
  const font = color(
    options.mode === "source" ? "--font-code" : "--font-prose",
    "monospace",
  );
  let left = Infinity,
    right = 0;
  for (const b of blocks) {
    left = Math.min(left, b.left);
    right = Math.max(right, b.right);
  }
  if (!Number.isFinite(left)) left = 0;
  const xScale = (width - 16) / Math.max(1, right - left);
  const seen = new Set<string>();
  let at = 0,
    frame = 0,
    cancelled = false;
  const started = performance.now();
  const stroke = (x: number, y: number, w: number, h: number) =>
    ctx.strokeRect(x, y, Math.max(1, w), Math.max(1, h));
  const draw = (b: MinimapBlock) => {
    const y = minimapY(b.top, options),
      h = (b.bottom - b.top) * options.scale;
    if (y > options.height || y + h < 0) return;
    const source = options.mode === "source";
    if (source && b.type !== "sourceLine") return;
    const container = [
      "list",
      "item",
      "blockquote",
      "callout",
      "theorem",
      "proof",
    ].includes(b.type);
    const key = `${container ? b.type : "text"}:${Math.floor(y)}:${Math.floor(b.left)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const x = 5 + (b.left - left) * xScale,
      w = Math.max(3, (b.right - b.left) * xScale - 3);
    ctx.lineWidth = 0.65;
    ctx.strokeStyle = colors.muted;
    ctx.fillStyle = colors.text;
    ctx.globalAlpha = 0.62;
    if (b.folded) {
      ctx.fillStyle = colors.accent;
      ctx.globalAlpha = 0.24;
      ctx.fillRect(x, y, w, Math.max(2, Math.min(h, 5)));
      return;
    }
    if (container) {
      if (["blockquote", "callout", "theorem", "proof"].includes(b.type))
        ctx.fillRect(Math.max(2, x - 2), y, 0.8, h);
      return;
    }
    if (b.type === "hr") {
      ctx.fillRect(x, y + h / 2, w, 0.8);
      return;
    }
    if (["table", "frontmatter"].includes(b.type)) {
      stroke(x, y + 1, w, h - 2);
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w / 2, y + h);
      for (let row = 1; row < 4 && h / 4 > 2; row++) {
        ctx.moveTo(x, y + (h * row) / 4);
        ctx.lineTo(x + w, y + (h * row) / 4);
      }
      ctx.stroke();
      return;
    }
    if (["mathBlock", "image", "toc", "htmlBlock"].includes(b.type)) {
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = colors.accent;
      ctx.fillRect(x, y, w, Math.max(2, h));
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = colors.muted;
      if (h >= 7) {
        ctx.font = `7px ${font}`;
        ctx.fillText(
          b.type === "mathBlock"
            ? "∑  equation"
            : b.type === "image"
              ? "▧  image"
              : b.type === "toc"
                ? "≡ contents"
                : "HTML",
          x + 2,
          y + h / 2 + 2,
          w - 4,
        );
      }
      return;
    }
    if (b.type === "codeBlock") {
      ctx.globalAlpha = 0.08;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.65;
    }
    const lines = b.text.split("\n").slice(0, 28),
      lineHeight = Math.max(1, Math.min(5, h / Math.max(1, lines.length)));
    const size = Math.min(b.type === "heading" ? 5 : 4, lineHeight * 0.8);
    ctx.font = `${b.type === "heading" ? "600 " : ""}${Math.max(1, size)}px ${font}`;
    for (let i = 0; i < lines.length && i * lineHeight < h; i++) {
      const line = lines[i].slice(0, 180),
        top = y + i * lineHeight;
      if (!line.trim()) continue;
      const lineColor =
        b.type === "heading" || /^\s*#{1,6}\s/.test(line)
          ? colors.accent
          : /^\s*(?:```|\$\$|>|\/\/|#(?!#))/.test(line)
            ? colors.syntax
            : colors.text;
      ctx.fillStyle = lineColor;
      if (options.rendering === "blocks" || size < 1.8) {
        const indent =
          (line.match(/^\s*/)?.[0].length ?? 0) * Math.max(0.6, size * 0.5);
        ctx.fillRect(
          x + indent,
          top + 0.3,
          Math.max(
            1,
            Math.min(
              w - indent,
              line.trim().length * Math.max(0.5, size * 0.52),
            ),
          ),
          Math.max(0.6, Math.min(2, lineHeight - 0.7)),
        );
      } else {
        // Small, source-colored runs without loading any extra language parser.
        let offset = 0;
        for (const run of line.split(
          /("[^"\n]*"|'[^'\n]*'|\b\d+(?:\.\d+)?\b|`[^`\n]*`)/g,
        )) {
          if (!run || offset >= w) continue;
          ctx.fillStyle = /^["'`]/.test(run)
            ? colors.accent
            : /^\d/.test(run)
              ? colors.syntax
              : lineColor;
          ctx.fillText(run, x + offset, top + size, Math.max(1, w - offset));
          offset += ctx.measureText(run).width;
        }
      }
    }
  };
  const batch = () => {
    if (cancelled) return;
    const time = performance.now();
    while (at < blocks.length) {
      draw(blocks[at++]);
      if (performance.now() - time >= 4) break;
    }
    if (at < blocks.length) {
      frame = requestAnimationFrame(batch);
      return;
    }
    if (cancelled) return;
    canvas.width = buffer.width;
    canvas.height = buffer.height;
    canvas.getContext("2d")?.drawImage(buffer, 0, 0);
    canvas.dataset.paintCount = String(
      Number(canvas.dataset.paintCount ?? 0) + 1,
    );
    canvas.dataset.paintMs = String(Math.round(performance.now() - started));
  };
  frame = requestAnimationFrame(batch);
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    buffer.width = 0;
    buffer.height = 0;
  };
}
