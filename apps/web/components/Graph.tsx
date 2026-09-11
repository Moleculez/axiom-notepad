"use client";
import { useMemo, useState } from "react";
import { Search, Network } from "lucide-react";
import { colorFor } from "../lib/client";
export default function Graph({
  notes,
  links,
  open,
}: {
  notes: any[];
  links: { source_id: string; target_id: string }[];
  open: (id: string) => void;
}) {
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [zoom, setZoom] = useState(1);
  const visible = notes.filter(
    (n) =>
      !n.deleted_at &&
      (!search ||
        (n.title + " " + n.tags.join(" "))
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const layout = useMemo(
    () =>
      new Map(
        notes
          .filter((n) => !n.deleted_at)
          .map((n, i, arr) => [
            n.id,
            {
              x:
                450 +
                Math.cos((i * Math.PI * 2) / arr.length - Math.PI / 2) *
                  (arr.length === 1 ? 0 : 250),
              y:
                300 +
                Math.sin((i * Math.PI * 2) / arr.length - Math.PI / 2) *
                  (arr.length === 1 ? 0 : 190),
            },
          ]),
      ),
    [notes],
  );
  const ids = new Set(visible.map((n) => n.id));
  return (
    <section className="graph-page">
      <div className="section-heading">
        <div>
          <div className="eyebrow">FOLLOW THE CONNECTIONS</div>
          <h1>Knowledge graph</h1>
          <p className="muted">
            Ideas become more useful when you can see what connects them.
          </p>
        </div>
        <Network size={32} strokeWidth={1} />
      </div>
      <div className="graph-tools">
        <label className="search-field">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter notes or tags…"
            aria-label="Filter graph"
          />
        </label>
        <label className="zoom-control">
          Zoom
          <input
            type="range"
            min="0.6"
            max="1.5"
            step="0.05"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="graph-canvas">
        <svg
          viewBox="0 0 900 600"
          role="img"
          aria-label="Connected research notes"
        >
          <defs>
            <pattern
              id="dots"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r=".8" fill="currentColor" opacity=".12" />
            </pattern>
          </defs>
          <rect width="900" height="600" fill="url(#dots)" />
          <g
            transform={`translate(450 300) scale(${zoom}) translate(-450 -300)`}
          >
            {links
              .filter((l) => ids.has(l.source_id) && ids.has(l.target_id))
              .map((link, i) => {
                const a = layout.get(link.source_id)!,
                  b = layout.get(link.target_id)!;
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className={
                      selected &&
                      ![link.source_id, link.target_id].includes(selected)
                        ? "graph-edge dim"
                        : "graph-edge"
                    }
                  />
                );
              })}
            {visible.map((note) => {
              const pos = layout.get(note.id)!;
              const linked = links.filter(
                (l) => l.source_id === note.id || l.target_id === note.id,
              ).length;
              return (
                <g
                  key={note.id}
                  transform={`translate(${pos.x} ${pos.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${note.title}`}
                  onClick={() => open(note.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") open(note.id);
                  }}
                  onMouseEnter={() => setSelected(note.id)}
                  onMouseLeave={() => setSelected(null)}
                  className="graph-node"
                >
                  <circle
                    r={12 + Math.min(10, linked * 2)}
                    fill={colorFor(note.project_id ?? note.id)}
                    opacity=".14"
                  />
                  <circle
                    r={6 + Math.min(5, linked)}
                    fill={colorFor(note.project_id ?? note.id)}
                  />
                  <text y="38" textAnchor="middle">
                    {note.title.length > 31
                      ? note.title.slice(0, 30) + "…"
                      : note.title}
                  </text>
                  <title>{note.title}</title>
                </g>
              );
            })}
          </g>
        </svg>
        {!visible.length && (
          <div className="graph-empty">No notes match this filter.</div>
        )}
      </div>
      <div className="graph-legend">
        <span>
          <i className="legend-dot" />
          {visible.length} notes
        </span>
        <span>
          {
            links.filter((l) => ids.has(l.source_id) && ids.has(l.target_id))
              .length
          }{" "}
          connections
        </span>
        <span>Choose a note to open it</span>
      </div>
    </section>
  );
}
