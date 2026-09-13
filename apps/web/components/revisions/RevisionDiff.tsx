"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Columns2, Rows2 } from "lucide-react";
import type { ParsedDocument } from "@axiom/markdown";
import type { RevisionContent } from "@axiom/shared/revisions";
import type { VersionDiff } from "@axiom/shared/version-diff";
import type { RevisionBlockGroup } from "@axiom/shared/version-diff-blocks";
import {
  collapseRevisionRows,
  type RevisionRow,
  type RevisionLine,
} from "@axiom/shared/version-diff-rows";
import ReadingView from "../ReadingView";
import { ErrorNotice, Loading } from "../workspace/ui";

type Compared = {
  diff: VersionDiff;
  rows: RevisionRow[];
  beforeParsed: ParsedDocument | null;
  afterParsed: ParsedDocument | null;
  blocks: RevisionBlockGroup[];
};
export default function RevisionDiff({
  before,
  after,
}: {
  before: RevisionContent;
  after: RevisionContent;
}) {
  const [mode, setMode] = useState<"rendered" | "source">("rendered"),
    [split, setSplit] = useState(true),
    [whitespace, setWhitespace] = useState(false),
    [comparison, setComparison] = useState<Compared | null>(null),
    [error, setError] = useState(""),
    [limit, setLimit] = useState(200),
    [all, setAll] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    change = useRef(-1);
  useEffect(() => {
    if (before.format === "image") return;
    setComparison(null);
    setError("");
    setLimit(200);
    change.current = -1;
    const worker = new Worker(
      new URL("../../lib/revision.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (e) => {
      if (e.data.error) setError(e.data.error);
      else setComparison(e.data);
    };
    worker.onerror = () =>
      setError("Comparison worker failed. Reopen history to retry.");
    worker.postMessage({
      id: 1,
      before: before.body ?? "",
      after: after.body ?? "",
      format: before.format,
    });
    return () => worker.terminate();
  }, [before.body, after.body, before.format]);
  const spans = comparison?.diff.spans ?? [];
  const oldRanges = useMemo(
    () =>
      spans
        .filter((s) => s.kind === "remove")
        .map((s) => ({
          from: s.oldFrom,
          to: s.oldFrom + s.text.length,
          kind: "remove" as const,
        })),
    [spans],
  );
  const newRanges = useMemo(
    () =>
      spans
        .filter((s) => s.kind === "add")
        .map((s) => ({
          from: s.newFrom,
          to: s.newFrom + s.text.length,
          kind: "add" as const,
        })),
    [spans],
  );
  const jump = (step: number) => {
    const nodes = [
      ...(root.current?.querySelectorAll<HTMLElement>(
        '[data-revision="changed"], .revision-source-change',
      ) ?? []),
    ];
    if (!nodes.length) return;
    change.current = (change.current + step + nodes.length) % nodes.length;
    nodes[change.current].scrollIntoView({ block: "center", behavior: "auto" });
  };
  if (before.format === "image")
    return <ImageComparison before={before} after={after} />;
  const rendered =
    mode === "rendered" &&
    before.format !== "text" &&
    (before.format === "latex" ||
      (comparison?.beforeParsed && comparison?.afterParsed));
  const lines = (
    all
      ? (comparison?.rows ?? [])
      : collapseRevisionRows(comparison?.rows ?? [])
  ).filter(
    (r) =>
      !whitespace ||
      !r.changed ||
      (r.before?.text ?? "").replace(/\s/g, "") !==
        (r.after?.text ?? "").replace(/\s/g, ""),
  );
  const cell = (
    line: RevisionLine | undefined,
    side: "before" | "after",
    changed: boolean,
  ) => {
    const ranges = side === "before" ? oldRanges : newRanges,
      content = line?.text.slice(0, 20000) ?? "";
    const pieces: React.ReactNode[] = [];
    let at = 0,
      lo = 0,
      hi = ranges.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ranges[mid].to <= (line?.from ?? 0)) lo = mid + 1;
      else hi = mid;
    }
    for (
      let i = lo;
      line && i < ranges.length && ranges[i].from < line.from + content.length;
      i++
    ) {
      const range = ranges[i],
        from = Math.max(at, range.from - line.from),
        to = Math.min(content.length, range.to - line.from);
      pieces.push(
        content.slice(at, from),
        <span key={i} className={"revision-source-" + range.kind}>
          {content.slice(from, to)}
        </span>,
      );
      at = to;
    }
    pieces.push(content.slice(at));
    return (
      <div
        className={
          "revision-source-line" + (changed ? " revision-source-change" : "")
        }
      >
        <span className="revision-line-number" aria-hidden="true">
          {line?.number ?? ""}
        </span>
        <code>
          {pieces}
          {(line?.text.length ?? 0) > 20000 && (
            <em>… long line truncated; export to read all characters.</em>
          )}
        </code>
      </div>
    );
  };
  const raw = () => (
    <div
      className={"revision-source-grid" + (split ? " is-split" : "")}
      aria-label="Source differences"
    >
      <div className="revision-source-row revision-source-head">
        <span>Before</span>
        {split && <span>After</span>}
      </div>
      {lines.slice(0, limit).map((r, index) =>
        r.omitted ? (
          <button
            className="revision-diff-gap"
            key={index}
            onClick={() => setAll(true)}
          >
            Show {r.omitted} unchanged lines
          </button>
        ) : (
          <div className="revision-source-row" key={index}>
            {split ? (
              <>
                {cell(r.before, "before", r.changed)}
                {cell(r.after, "after", r.changed)}
              </>
            ) : r.changed ? (
              <>
                {r.before && cell(r.before, "before", true)}
                {r.after && cell(r.after, "after", true)}
              </>
            ) : (
              cell(r.after, "after", false)
            )}
          </div>
        ),
      )}
    </div>
  );
  const read = (
    value: RevisionContent,
    parsed: ParsedDocument | null,
    ranges: typeof oldRanges | typeof newRanges,
  ) =>
    value.format === "latex" ? (
      <div
        className="revision-equation"
        style={{
          color: String(value.settings?.foreground ?? "var(--text)"),
          fontSize: Number(value.settings?.fontSize ?? 24),
          background: value.settings?.transparent
            ? "transparent"
            : String(value.settings?.background ?? "var(--paper)"),
        }}
      >
        <span
          className="math-render"
          data-math-request={JSON.stringify({
            tex: value.body ?? "",
            display: true,
            macros: String(value.settings?.macros ?? "")
              .split("\n")
              .filter(Boolean),
            physics: true,
          })}
        />
        <pre>{value.body}</pre>
      </div>
    ) : (
      parsed && (
        <ReadingView
          parsed={parsed}
          source={value.body ?? ""}
          context={{ reviewRanges: ranges }}
          onLink={() => {}}
        />
      )
    );
  return (
    <div className="revision-comparison" ref={root}>
      <div
        className="revision-compare-toolbar"
        role="toolbar"
        aria-label="Comparison options"
      >
        <div className="ws-segmented">
          <button
            aria-pressed={mode === "rendered"}
            onClick={() => setMode("rendered")}
          >
            Rendered
          </button>
          <button
            aria-pressed={mode === "source"}
            onClick={() => setMode("source")}
          >
            Source
          </button>
        </div>
        <button
          className="button ghost"
          aria-pressed={split}
          onClick={() => setSplit(!split)}
        >
          {split ? <Columns2 size={15} /> : <Rows2 size={15} />}
          {split ? "Side by side" : "Unified"}
        </button>
        <button
          className="icon-button"
          aria-label="Previous change"
          onClick={() => jump(-1)}
        >
          <ArrowUp size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Next change"
          onClick={() => jump(1)}
        >
          <ArrowDown size={15} />
        </button>
        {!rendered && (
          <label>
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
            />
            Show unchanged lines
          </label>
        )}
        {!rendered && (
          <label>
            <input
              type="checkbox"
              checked={whitespace}
              onChange={(e) => setWhitespace(e.target.checked)}
            />
            Hide whitespace-only lines
          </label>
        )}
      </div>
      <ErrorNotice message={error} />
      {!comparison && !error ? (
        <Loading label="Comparing revisions…" />
      ) : (
        <>
          {comparison?.diff.coarse && (
            <p className="revision-notice">
              Large change: some regions use a coarse comparison. Both sources
              remain complete.
            </p>
          )}
          {mode === "rendered" && !rendered && (
            <p className="revision-notice">
              Source view is used for raw text and revisions above 200,000
              characters.
            </p>
          )}
          <div
            className={
              "revision-diff-scroll" + (split && rendered ? " is-split" : "")
            }
          >
            {rendered &&
            !split &&
            before.format === "markdown" &&
            comparison?.beforeParsed &&
            comparison.afterParsed ? (
              <div
                className="revision-unified"
                aria-label="Unified rendered differences"
              >
                {comparison.blocks.map((group, i) => {
                  const parsed =
                    group.kind === "remove"
                      ? comparison.beforeParsed!
                      : comparison.afterParsed!;
                  const value = group.kind === "remove" ? before : after;
                  return (
                    <section
                      key={i}
                      className={
                        "revision-block-group revision-block-" + group.kind
                      }
                      data-revision={
                        group.kind === "equal" ? undefined : "changed"
                      }
                    >
                      {group.kind !== "equal" && (
                        <span className="revision-block-label">
                          {group.kind === "remove" ? "Removed" : "Added"}
                        </span>
                      )}
                      <ReadingView
                        parsed={{
                          ...parsed,
                          ast: { ...parsed.ast, children: group.nodes },
                        }}
                        context={{
                          fragment: true,
                          document: parsed,
                          reviewRanges:
                            group.kind === "remove" ? oldRanges : newRanges,
                        }}
                        source={value.body ?? ""}
                        onLink={() => {}}
                      />
                    </section>
                  );
                })}
                {comparison.beforeParsed.definitions?.length ||
                comparison.afterParsed.definitions?.length ? (
                  <details>
                    <summary>Footnote definitions · before and after</summary>
                    {[comparison.beforeParsed, comparison.afterParsed].map(
                      (p, i) => (
                        <ReadingView
                          key={i}
                          parsed={{ ...p, ast: { ...p.ast, children: [] } }}
                          context={{
                            document: p,
                            reviewRanges: i ? newRanges : oldRanges,
                          }}
                          source={(i ? after.body : before.body) ?? ""}
                          onLink={() => {}}
                        />
                      ),
                    )}
                  </details>
                ) : null}
              </div>
            ) : rendered ? (
              <>
                <section className="revision-before">
                  <h3>{before.label ?? "Before"}</h3>
                  {read(before, comparison?.beforeParsed ?? null, oldRanges)}
                </section>
                <section className="revision-after">
                  <h3>{after.label ?? "After"}</h3>
                  {read(after, comparison?.afterParsed ?? null, newRanges)}
                </section>
              </>
            ) : (
              <section>{raw()}</section>
            )}
            {!rendered && lines.length > limit && (
              <button
                className="button secondary"
                onClick={() => setLimit((n) => n + 200)}
              >
                Show more comparison regions
              </button>
            )}
          </div>
          {before.format === "latex" && (
            <details className="revision-settings">
              <summary>
                Project settings{" "}
                {JSON.stringify(before.settings) ===
                JSON.stringify(after.settings)
                  ? "(unchanged)"
                  : "(changed)"}
              </summary>
              {!before.settings && (
                <p>
                  Historical checkpoint: project settings were not recorded.
                </p>
              )}
              <pre>
                {JSON.stringify(
                  { before: before.settings, after: after.settings },
                  null,
                  2,
                )}
              </pre>
            </details>
          )}
          {!spans.some((s) => s.kind !== "equal") && (
            <p className="revision-notice">
              No source changes between these revisions.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ImageComparison({
  before,
  after,
}: {
  before: RevisionContent;
  after: RevisionContent;
}) {
  const [wipe, setWipe] = useState(false),
    [position, setPosition] = useState(50),
    [zoom, setZoom] = useState(1);
  const [dimensions, setDimensions] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const describe = (value: RevisionContent) => {
    const size = value.image ?? dimensions[value.id];
    return (
      (value.label ?? "Image revision") +
      (size ? " · " + size.width + " × " + size.height : "") +
      (value.image ? " · " + value.image.layers + " layers" : "")
    );
  };
  const loaded = (id: string, image: HTMLImageElement) =>
    setDimensions((d) => ({
      ...d,
      [id]: { width: image.naturalWidth, height: image.naturalHeight },
    }));
  return (
    <div className="revision-comparison">
      <div className="revision-compare-toolbar">
        <button
          className="button secondary"
          aria-pressed={wipe}
          onClick={() => setWipe(!wipe)}
        >
          {wipe ? "Wipe comparison" : "Side by side"}
        </button>
        <label>
          Zoom
          <input
            aria-label="Comparison zoom"
            type="range"
            min=".25"
            max="3"
            step=".25"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <button className="button ghost" onClick={() => setZoom(1)}>
          Fit images
        </button>
        {wipe && (
          <label>
            Reveal
            <input
              aria-label="Image comparison reveal"
              type="range"
              min="0"
              max="100"
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
            />
          </label>
        )}
      </div>
      <div className="revision-image-scroll">
        <div
          className={"revision-image-pair" + (wipe ? " is-wipe" : "")}
          style={{ width: (wipe ? 70 : 100) * zoom + "%" }}
        >
          <img
            src={before.preview ?? ""}
            alt="Previous image revision"
            onLoad={(e) => loaded(before.id, e.currentTarget)}
          />
          <img
            src={after.preview ?? ""}
            alt="Compared image revision"
            onLoad={(e) => loaded(after.id, e.currentTarget)}
            style={
              wipe
                ? { clipPath: "inset(0 " + (100 - position) + "% 0 0)" }
                : undefined
            }
          />
        </div>
      </div>
      <p className="revision-notice">
        {describe(before)}
        <br />
        {describe(after)}
        <br />
        {before.hash === after.hash
          ? "These saved images have the same content checksum."
          : "Saved image revisions · original files are unchanged."}
      </p>
    </div>
  );
}
