"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Search, ImagePlus } from "lucide-react";
import { parseMarkdown, renderDocument } from "@axiom/markdown";
import type { Resource, ResourcePage } from "@axiom/shared/workspace";
import type { FilePreviewManifest } from "@axiom/shared/file-preview";
import type { VisualAnnotation } from "@axiom/shared/visual-annotations";
import type { VisualAsset } from "../../lib/visual-assets";
import {
  readVisualMetadata,
  visualCanvas,
  downloadVisual,
  type VisualMedia,
} from "../../lib/visual-media";
import type { MetadataField } from "../../lib/visual-metadata.worker";
import { api } from "../../lib/client";
import { bytes, useWorkspace } from "../workspace/ui";
import AnnotationEditor from "../AnnotationEditor";

export function Information({
  asset,
  media,
}: {
  asset: VisualAsset;
  media: VisualMedia | null;
}) {
  const [fields, setFields] = useState<MetadataField[]>([]),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [query, setQuery] = useState(""),
    [sensitive, setSensitive] = useState(false);
  useEffect(() => {
    setFields([]);
    setError("");
    setSensitive(false);
    setPending(false);
    if (!media?.blob || asset.kind === "mermaid") return;
    const abort = new AbortController();
    setPending(true);
    void readVisualMetadata(media.blob, abort.signal)
      .then(setFields)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setPending(false);
      });
    return () => abort.abort();
  }, [media, asset.kind]);
  const visible = fields.filter(
    (f) =>
      (sensitive || !f.sensitive) &&
      `${f.group} ${f.name} ${f.value}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section>
      <h3>
        {asset.kind === "mermaid" ? "Diagram information" : "Image information"}
      </h3>
      <dl className="visual-properties">
        <dt>Name</dt>
        <dd>{asset.name}</dd>
        <dt>Dimensions</dt>
        <dd>{media ? `${media.width} × ${media.height}` : "Loading…"}</dd>
        <dt>Format</dt>
        <dd>{media?.blob?.type || asset.mime || "Remote image"}</dd>
        <dt>Size</dt>
        <dd>{media?.blob ? bytes(media.blob.size) : "Unavailable"}</dd>
        <dt>Source identity</dt>
        <dd>
          {media?.identity.verified
            ? "Verified snapshot"
            : "Unverified remote content"}
        </dd>
        {asset.placement?.versionId && (
          <>
            <dt>File version</dt>
            <dd>{asset.placement.versionId}</dd>
          </>
        )}
        {asset.kind === "mermaid" && (
          <>
            <dt>Diagram type</dt>
            <dd>
              {asset.source
                ?.trim()
                .replace(/^---[\s\S]*?---\s*/, "")
                .split(/[\s;]/)[0] || "Mermaid"}
            </dd>
            <dt>Source length</dt>
            <dd>{asset.source?.length ?? 0} characters</dd>
          </>
        )}
      </dl>
      {asset.kind === "mermaid" ? (
        <>
          <p className="visual-caption">
            Vector rendering with strict diagram security. EXIF does not apply
            to diagrams.
          </p>
          <details>
            <summary>Mermaid source</summary>
            <pre className="visual-source">{asset.source}</pre>
          </details>
        </>
      ) : (
        <>
          <label className="visual-search">
            <Search size={15} />
            <input
              aria-label="Search image metadata"
              placeholder="Search metadata…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="visual-check">
            <input
              type="checkbox"
              checked={sensitive}
              onChange={(e) => setSensitive(e.target.checked)}
            />
            Reveal location / identifying fields
          </label>
          {pending && <p role="status">Reading metadata privately…</p>}
          {error && <p className="visual-caption">{error}</p>}
          {!pending && !fields.length && (
            <p className="visual-caption">
              No readable metadata in this preview. Screenshots, optimized
              images, and remote images often have none.
            </p>
          )}
          <dl className="visual-properties">
            {visible.map((f) => (
              <div key={`${f.group}:${f.name}`}>
                <dt>
                  {f.name}
                  <small>{f.group}</small>
                </dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          {fields.length > 0 && (
            <button
              className="button secondary"
              onClick={() =>
                downloadVisual(
                  new Blob(
                    [
                      JSON.stringify(
                        fields.filter((f) => sensitive || !f.sensitive),
                        null,
                        2,
                      ),
                    ],
                    { type: "application/json" },
                  ),
                  "image-metadata.json",
                )
              }
            >
              <Download size={15} />
              Export {sensitive ? "all" : "non-identifying"} metadata
            </button>
          )}
        </>
      )}
    </section>
  );
}
export function Histogram({ media }: { media: VisualMedia }) {
  const ref = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    try {
      const sample = visualCanvas(
          media,
          Math.min(1, 512 / Math.max(media.width, media.height)),
        ),
        data = sample
          .getContext("2d")!
          .getImageData(0, 0, sample.width, sample.height).data,
        channels = Array.from({ length: 3 }, () =>
          new Array<number>(256).fill(0),
        );
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 3]) for (let c = 0; c < 3; c++) channels[c][data[i + c]]++;
      const ctx = ref.current!.getContext("2d")!;
      ctx.clearRect(0, 0, 256, 96);
      ctx.globalAlpha = 0.6;
      const max = Math.max(1, ...channels.flat());
      channels.forEach((values, c) => {
        ctx.strokeStyle = ["#d14b59", "#439f6b", "#5689d5"][c];
        ctx.beginPath();
        values.forEach((v, x) => ctx.lineTo(x, 95 - (v / max) * 90));
        ctx.stroke();
      });
      sample.width = 0;
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [media]);
  return (
    <div className="visual-histogram">
      <h4>Sampled RGB histogram</h4>
      {error && <p className="visual-caption">{error}</p>}
      <canvas
        hidden={!!error}
        ref={ref}
        width={256}
        height={96}
        role="img"
        aria-label="Sampled red, green and blue intensity distributions"
      />
    </div>
  );
}
export function Replies({
  rows,
  onReply,
  canReply,
  userId,
  canManage,
  onRemove,
}: {
  rows: VisualAnnotation[];
  onReply: (body: string) => Promise<boolean>;
  canReply: boolean;
  userId: string;
  canManage: boolean;
  onRemove: (row: VisualAnnotation) => Promise<boolean>;
}) {
  const [body, setBody] = useState(""),
    [sending, setSending] = useState(false),
    [epoch, setEpoch] = useState(0),
    [error, setError] = useState("");
  return (
    <div className="visual-replies">
      <h4>Discussion</h4>
      {rows.map((r) => (
        <article key={r.id}>
          <strong>{r.authorName}</strong>
          <VisualNote body={r.body} />
          {(r.authorId === userId || canManage) && (
            <button
              className="text-button danger"
              onClick={() => void onRemove(r)}
            >
              Remove reply
            </button>
          )}
        </article>
      ))}
      {canReply && (
        <AnnotationEditor
          key={epoch}
          value={body}
          onChange={setBody}
          onError={setError}
        />
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="button secondary"
        disabled={!canReply || !body.trim() || sending}
        onClick={() => {
          setSending(true);
          void onReply(body)
            .then((saved) => {
              if (saved) {
                setBody("");
                setEpoch((v) => v + 1);
              }
            })
            .finally(() => setSending(false));
        }}
      >
        Post reply
      </button>
    </div>
  );
}
export function VisualNote({ body }: { body: string }) {
  const { appearance } = useWorkspace();
  const html = useMemo(
    () =>
      renderDocument(parseMarkdown(body), {
        theme: appearance.dark ? "dark" : "light",
        disableImages: true,
        scrollTables: true,
      }),
    [body, appearance.dark],
  );
  return (
    <div
      className="visual-note-body prose"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
export function ComparePicker({
  items,
  selected,
  onSelect,
  onClose,
}: {
  items: VisualAsset[];
  selected: string;
  onSelect: (v: VisualAsset) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(""),
    [files, setFiles] = useState<Resource[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(
      () =>
        void api<ResourcePage>(
          `resources?view=all&kind=file&q=${encodeURIComponent(query)}&limit=60`,
          { signal: abort.signal },
        )
          .then((r) =>
            setFiles(r.items.filter((f) => f.mime?.startsWith("image/"))),
          )
          .catch((e) => {
            if (!abort.signal.aborted) setError(e.message);
          }),
      250,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);
  return (
    <section
      className="visual-compare-picker"
      aria-label="Choose comparison visual"
    >
      <header>
        <strong>Compare with</strong>
        <button className="text-button" onClick={onClose}>
          Cancel
        </button>
      </header>
      <div className="visual-compare-items">
        {items
          .filter((i) => i.id !== selected)
          .map((item) => (
            <button
              key={item.id}
              className="button secondary"
              onClick={() => onSelect(item)}
            >
              {item.name}
            </button>
          ))}
      </div>
      <label>
        Find a workspace image
        <input
          aria-label="Find comparison image"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="visual-compare-items">
        {files.map((file) => (
          <button
            key={file.id}
            className="button secondary"
            onClick={() =>
              void api<FilePreviewManifest>(`files/${file.id}/preview`)
                .then((f) =>
                  onSelect({
                    id: f.resourceId,
                    kind: "image",
                    name: f.name,
                    url: f.source,
                    mime: f.mime,
                    bytes: f.bytes,
                    placement: {
                      resourceId: f.resourceId,
                      path: [],
                      versionId: f.versionId,
                    },
                  }),
                )
                .catch((e) => setError(e.message))
            }
          >
            <ImagePlus size={14} />
            {file.name}
          </button>
        ))}
      </div>
    </section>
  );
}
