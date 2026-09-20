"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Download,
  FileQuestion,
  Maximize,
  Search,
  WrapText,
  Link,
} from "lucide-react";
import type { FilePreviewManifest } from "@axiom/shared/file-preview";
import { parseDelimited } from "@axiom/shared/file-preview";
import { parseMarkdown } from "@axiom/markdown";
import ReadingView from "../ReadingView";
import VisualFilePreview from "../visual/VisualFilePreview";
import type { VisualAsset } from "../../lib/visual-assets";
import { post } from "../../lib/client";
import {
  requestFileCreation,
  type FileCreationRequest,
} from "../../lib/file-creation";
import {
  bytes,
  ErrorNotice,
  Loading,
  useData,
  useWorkspace,
} from "../workspace/ui";
const PdfPreview = dynamic(() => import("../workspace/PdfQuickPreview"), {
  ssr: false,
});
const WorkbookPreview = dynamic(() => import("./WorkbookPreview"), {
  ssr: false,
  loading: () => <Loading label="Opening workbook…" />,
});
const OfficePreview = dynamic(() => import("./OfficePreview"), {
  ssr: false,
  loading: () => <Loading label="Opening document…" />,
});

export default function FilePreviewSurface({
  resourceId,
  versionId,
  compact = false,
  pdf,
  initialManifest,
  onReload,
  creationTarget,
  visualGallery,
}: {
  resourceId: string;
  versionId?: string | null;
  compact?: boolean;
  pdf?: React.ReactNode;
  initialManifest?: FilePreviewManifest;
  onReload?: () => void;
  creationTarget?: FileCreationRequest["target"];
  visualGallery?: VisualAsset[];
}) {
  const manifest = useData<FilePreviewManifest>(
    initialManifest
      ? null
      : `files/${resourceId}/preview${versionId ? `?version=${versionId}` : ""}`,
  );
  const file = initialManifest ?? manifest.data;
  const [conversionError, setConversionError] = useState("");
  const reload = onReload ?? manifest.reload;
  useEffect(() => {
    if (file?.status !== "queued") return;
    const timer = setInterval(reload, 2500);
    return () => clearInterval(timer);
  }, [file?.status, reload]);
  if (manifest.error)
    return <ErrorNotice message={manifest.error} retry={manifest.reload} />;
  if (!file) return <Loading label="Preparing preview…" />;
  return (
    <section
      className={`tool-preview ${compact ? "is-compact" : ""}`}
      aria-label={`${file.name} preview`}
    >
      {file.message &&
        !file.office &&
        file.source.includes("preview-content") && (
          <p className="ws-note">{file.message}</p>
        )}
      <ErrorNotice message={conversionError} />
      {file.office ? (
        <OfficePreview
          key={file.versionId}
          file={file}
          onConvert={async () => {
            try {
              await post(
                `files/${file.resourceId}/preview-convert?version=${file.versionId}`,
                {},
              );
              setConversionError("");
              reload();
            } catch (error) {
              setConversionError((error as Error).message);
              throw error;
            }
          }}
        />
      ) : file.kind === "image" ? (
        <ImagePreview
          key={file.versionId}
          file={file}
          target={creationTarget}
          gallery={visualGallery}
        />
      ) : file.kind === "audio" || file.kind === "video" ? (
        <MediaPreview key={file.versionId} file={file} />
      ) : file.kind === "pdf" ? (
        ((file.source.includes("preview-content") ? null : pdf) ??
        (file.bytes < 100_000_000 ? (
          <PdfPreview source={file.source} />
        ) : (
          <DownloadFallback
            file={file}
            message="This PDF is too large for Quick Preview. Open the full research reader or download it."
          />
        )))
      ) : file.kind === "office" ? (
        <>
          <DownloadFallback file={file} />
          <div className="tool-controls">
            <button
              className="button secondary"
              disabled={file.status === "queued"}
              onClick={() =>
                void post(
                  `files/${file.resourceId}/preview-convert?version=${file.versionId}`,
                  {},
                )
                  .then(() => {
                    setConversionError("");
                    reload();
                  })
                  .catch((e) => setConversionError(e.message))
              }
            >
              {file.status === "queued"
                ? "Converting privately…"
                : "Generate private preview"}
            </button>
          </div>
        </>
      ) : file.kind === "workbook" ? (
        <WorkbookPreview key={file.versionId} file={file} />
      ) : ["text", "markdown", "table"].includes(file.kind) ? (
        <TextPreview key={file.versionId} file={file} />
      ) : (
        <DownloadFallback file={file} />
      )}
    </section>
  );
}
export function DownloadFallback({
  file,
  message,
}: {
  file: FilePreviewManifest;
  message?: string;
}) {
  return (
    <div className="tool-preview-fallback">
      <FileQuestion size={36} strokeWidth={1.3} />
      <h3>{file.name}</h3>
      <p>
        {message ?? file.message ?? "Download the original to open this file."}
      </p>
      <small>
        {bytes(file.bytes)} · {file.mime}
      </small>
      <a
        className="button secondary"
        href={`/api/v1/files/${file.resourceId}/download?version=${file.versionId}`}
      >
        <Download size={16} />
        Download original
      </a>
    </div>
  );
}
function ImagePreview({
  file,
  target,
  gallery,
}: {
  file: FilePreviewManifest;
  target?: FileCreationRequest["target"];
  gallery?: VisualAsset[];
}) {
  const { navigate } = useWorkspace();
  return (
    <VisualFilePreview
      file={file}
      gallery={gallery}
      onEdit={() =>
        file.mime === "application/vnd.axiom.image+zip"
          ? navigate(`/image/${file.resourceId}`)
          : requestFileCreation({
              type: "image",
              target,
              importFile: file.resourceId,
              importVersion: file.versionId,
            })
      }
    />
  );
}
export function MediaPreview({ file }: { file: FilePreviewManifest }) {
  const media = useRef<HTMLMediaElement | null>(null),
    stage = useRef<HTMLDivElement>(null);
  const [speed, setSpeed] = useState(1),
    [loop, setLoop] = useState(false),
    [captions, setCaptions] = useState<string>(),
    [error, setError] = useState("");
  const { notify } = useWorkspace();
  useEffect(
    () => () => {
      if (captions) URL.revokeObjectURL(captions);
    },
    [captions],
  );
  useEffect(() => {
    if (media.current) media.current.playbackRate = speed;
  }, [speed]);
  const props = {
    src: file.source,
    controls: true,
    preload: "metadata",
    loop,
    onError: () =>
      setError(
        "This browser cannot play this codec. Try downloading the original.",
      ),
    onLoadedMetadata: () => {
      const t = Number(new URLSearchParams(location.hash.slice(1)).get("t"));
      if (media.current && t > 0 && Number.isFinite(t))
        media.current.currentTime = Math.min(t, media.current.duration);
    },
  } as const;
  return (
    <>
      <div className="tool-controls">
        <span>
          {file.kind === "audio" ? "Audio" : "Video"} · {bytes(file.bytes)}
        </span>
        <span className="tool-spacer" />
        <label>
          Speed{" "}
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
          />
          Loop
        </label>
        <button
          className="icon-button"
          aria-label="Copy link at current time"
          title="Copy link at current time"
          onClick={() => {
            const u = new URL(location.href);
            u.hash = `t=${Math.floor(media.current?.currentTime ?? 0)}`;
            void navigator.clipboard.writeText(u.toString()).then(
              () => notify("Timestamp link copied."),
              () => setError("Clipboard access was denied."),
            );
          }}
        >
          <Link size={16} />
        </button>
        {file.kind === "video" && (
          <>
            <label className="button secondary">
              Captions
              <input
                type="file"
                accept=".vtt"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && f.size < 2_000_000)
                    setCaptions(URL.createObjectURL(f));
                  else if (f)
                    setError("Caption files must be smaller than 2 MB.");
                }}
              />
            </label>
            <button
              className="icon-button"
              title="Fullscreen"
              aria-label="Fullscreen"
              onClick={() =>
                void stage.current
                  ?.requestFullscreen()
                  .catch(() => setError("Fullscreen is unavailable."))
              }
            >
              <Maximize size={16} />
            </button>
          </>
        )}
      </div>
      <ErrorNotice message={error} />
      <div className={`media-preview-stage ${file.kind}`} ref={stage}>
        {file.kind === "video" ? (
          <video
            ref={(e) => {
              media.current = e;
            }}
            {...props}
          >
            {captions && (
              <track
                key={captions}
                src={captions}
                kind="captions"
                label="Local captions"
                srcLang="en"
                default
              />
            )}
          </video>
        ) : (
          <audio
            ref={(e) => {
              media.current = e;
            }}
            {...props}
          />
        )}
      </div>
    </>
  );
}
function TextPreview({ file }: { file: FilePreviewManifest }) {
  const [limit, setLimit] = useState(2_000_000),
    [encoding, setEncoding] = useState("auto"),
    [text, setText] = useState<string | null>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [wrap, setWrap] = useState(true),
    [rendered, setRendered] = useState(file.kind === "markdown");
  useEffect(() => {
    const c = new AbortController();
    setText(null);
    setError("");
    void fetch(file.source, {
      signal: c.signal,
      headers: file.bytes
        ? { Range: `bytes=0-${Math.min(file.bytes, limit) - 1}` }
        : {},
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Unable to read this file.");
        const buffer = await r.arrayBuffer();
        if (buffer.byteLength > limit + 8)
          throw new Error(
            "The server did not honor this preview's size limit.",
          );
        const prefix = new Uint8Array(
          buffer,
          0,
          Math.min(3, buffer.byteLength),
        );
        const detected =
          prefix[0] === 0xff && prefix[1] === 0xfe
            ? "utf-16le"
            : prefix[0] === 0xfe && prefix[1] === 0xff
              ? "utf-16be"
              : "utf-8";
        const t = new TextDecoder(
          encoding === "auto" ? detected : encoding,
        ).decode(buffer);
        if (!c.signal.aborted) setText(t);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [file.source, file.bytes, limit, encoding]);
  const parsed = useMemo(
    () => (rendered && text !== null ? parseMarkdown(text) : null),
    [text, rendered],
  );
  const rows = useMemo(
    () =>
      file.kind === "table" && text !== null
        ? parseDelimited(text, /\.tsv$/i.test(file.name) ? "\t" : ",")
        : null,
    [file.kind, file.name, text],
  );
  return (
    <>
      <div className="tool-controls">
        <label className="tool-search">
          <Search size={15} />
          <input
            aria-label="Search file"
            placeholder="Find in file…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="tool-spacer" />
        {file.kind === "markdown" && (
          <button
            className="button secondary"
            aria-pressed={rendered}
            onClick={() => setRendered(!rendered)}
          >
            {rendered ? "Source" : "Reading view"}
          </button>
        )}
        <select
          aria-label="Text encoding"
          value={encoding}
          onChange={(e) => setEncoding(e.target.value)}
        >
          <option value="auto">Auto-detect encoding</option>
          {[
            "utf-8",
            "utf-16le",
            "utf-16be",
            "windows-1252",
            "gb18030",
            "shift_jis",
          ].map((e) => (
            <option key={e}>{e}</option>
          ))}
        </select>
        <button
          className="icon-button"
          title="Wrap lines"
          aria-label="Wrap lines"
          aria-pressed={wrap}
          onClick={() => setWrap(!wrap)}
        >
          <WrapText size={16} />
        </button>
      </div>
      <ErrorNotice message={error} />
      {text === null ? (
        <Loading />
      ) : rows ? (
        <DataGrid rows={rows} search={search} />
      ) : parsed ? (
        <div className="text-preview-reading">
          <ReadingView
            parsed={parsed}
            context={{}}
            onLink={(target) => {
              if (/^https?:\/\//i.test(target))
                window.open(target, "_blank", "noopener,noreferrer");
            }}
          />
        </div>
      ) : (
        <TextLines text={text} wrap={wrap} search={search} />
      )}
      {file.bytes > limit && (
        <div className="tool-controls">
          <small>
            Showing the first {bytes(limit)} of {bytes(file.bytes)}. A final
            line may be incomplete.
          </small>
          {limit < 20_000_000 && (
            <button
              className="button secondary"
              onClick={() => setLimit(Math.min(limit + 2_000_000, 20_000_000))}
            >
              Load more
            </button>
          )}
        </div>
      )}
    </>
  );
}
function TextLines({
  text,
  wrap,
  search,
}: {
  text: string;
  wrap: boolean;
  search: string;
}) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const matches = useMemo(
    () =>
      search
        ? lines
            .map((line, index) => ({ line, index }))
            .filter((item) =>
              item.line.toLowerCase().includes(search.toLowerCase()),
            )
        : null,
    [lines, search],
  );
  const visible = matches ?? lines.map((line, index) => ({ line, index }));
  // Bounded previews avoid mounting unbounded syntax/token DOM for logs.
  const [count, setCount] = useState(2000);
  return (
    <div className={`text-preview-lines ${wrap ? "wrap" : ""}`}>
      <small>
        {matches ? `${matches.length} matching lines` : `${lines.length} lines`}
      </small>
      <pre>
        {visible.slice(0, count).map(({ line, index }) => (
          <div key={index}>
            <span className="text-line-number" aria-hidden="true">
              {index + 1}
            </span>
            <code>{line || " "}</code>
          </div>
        ))}
      </pre>
      {visible.length > count && (
        <button
          className="button secondary"
          onClick={() => setCount(count + 2000)}
        >
          Show 2,000 more lines
        </button>
      )}
    </div>
  );
}
export function DataGrid({
  rows,
  search = "",
}: {
  rows: string[][];
  search?: string;
}) {
  const [scroll, setScroll] = useState(0),
    [selected, setSelected] = useState<{ row: number; column: number } | null>(
      null,
    );
  const viewport = useRef<HTMLDivElement>(null);
  const filtered = useMemo(
    () =>
      rows
        .map((cells, index) => ({ cells, index }))
        .filter(
          (row) =>
            !search ||
            row.cells.some((c) =>
              c.toLowerCase().includes(search.toLowerCase()),
            ),
        ),
    [rows, search],
  );
  const columns = Math.min(
      256,
      rows.reduce((n, r) => Math.max(n, r.length), 0),
    ),
    start = Math.max(0, Math.floor(scroll / 30) - 6),
    end = Math.min(filtered.length, start + 48);
  useEffect(() => {
    setScroll(0);
    setSelected(null);
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [search, rows]);
  return (
    <div className="data-preview">
      <div className="data-preview-formula">
        <strong>
          {selected
            ? `${columnLabel(selected.column)}${selected.row + 1}`
            : "Select a cell"}
        </strong>
        <span>
          {selected
            ? rows[selected.row]?.[selected.column]
            : `${rows.length.toLocaleString()} rows · ${columns} columns`}
        </span>
      </div>
      <div
        ref={viewport}
        className="data-preview-scroll"
        role="region"
        aria-label="Spreadsheet data"
        tabIndex={0}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      >
        <table style={{ minWidth: Math.max(320, 50 + columns * 140) }}>
          <colgroup>
            <col style={{ width: 50 }} />
            {Array.from({ length: columns }, (_, i) => (
              <col key={i} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th aria-label="Row" />
              {Array.from({ length: columns }, (_, i) => (
                <th key={i}>{columnLabel(i)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {start > 0 && (
              <tr aria-hidden="true" style={{ height: start * 30 }}>
                <td colSpan={columns + 1} />
              </tr>
            )}
            {filtered.slice(start, end).map(({ cells, index }) => (
              <tr key={index}>
                <th>{index + 1}</th>
                {Array.from({ length: columns }, (_, column) => (
                  <td
                    key={column}
                    title={cells[column]}
                    tabIndex={0}
                    aria-selected={
                      selected?.row === index && selected.column === column
                    }
                    onFocus={() => setSelected({ row: index, column })}
                    onClick={() => setSelected({ row: index, column })}
                  >
                    {cells[column]}
                  </td>
                ))}
              </tr>
            ))}
            {end < filtered.length && (
              <tr
                aria-hidden="true"
                style={{ height: (filtered.length - end) * 30 }}
              >
                <td colSpan={columns + 1} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {columns === 256 && (
        <small>
          Preview displays the first 256 columns. The original workbook is
          unchanged.
        </small>
      )}
    </div>
  );
}
function columnLabel(index: number) {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
}
