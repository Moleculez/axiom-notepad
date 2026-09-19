"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ListTree,
  Search,
  X,
} from "lucide-react";
export type PdfOutlineItem = { title: string; dest: unknown; depth: number };
export default function PdfOutline({
  pdf,
  items,
  page,
  labels,
  onPage,
}: {
  pdf: PDFDocumentProxy | null;
  items: PdfOutlineItem[];
  page: number;
  labels: string[];
  onPage: (page: number) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(
    () =>
      new Set(items.flatMap((item, index) => (item.depth > 0 ? [index] : []))),
  );
  const [filtering, setFiltering] = useState(false),
    [query, setQuery] = useState("");
  const [pages, setPages] = useState<Map<number, number | null>>(new Map()),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const structure = useMemo(() => {
    const parents: (number | undefined)[] = [],
      stack: number[] = [],
      branches = new Set<number>();
    items.forEach((item, index) => {
      while (stack.length && items[stack.at(-1)!].depth >= item.depth)
        stack.pop();
      parents[index] = stack.at(-1);
      if (stack.length) branches.add(stack.at(-1)!);
      stack.push(index);
    });
    return { parents, branches };
  }, [items]);
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase(),
      included = new Set<number>();
    if (term)
      items.forEach((item, index) => {
        if (!item.title.toLocaleLowerCase().includes(term)) return;
        for (
          let i: number | undefined = index;
          i !== undefined;
          i = structure.parents[i]
        )
          included.add(i);
      });
    return items.flatMap((item, index) => {
      if (term) return included.has(index) ? [index] : [];
      for (
        let p = structure.parents[index];
        p !== undefined;
        p = structure.parents[p]
      )
        if (collapsed.has(p)) return [];
      return [index];
    });
  }, [items, structure, collapsed, query]);
  useEffect(() => {
    if (!pdf) return;
    let alive = true,
      next = 0;
    const resolved = new Map<number, number | null>();
    const worker = async () => {
      while (alive && next < items.length) {
        const index = next++;
        try {
          const item = items[index];
          const dest =
            typeof item.dest === "string"
              ? await pdf.getDestination(item.dest)
              : item.dest;
          const n = Array.isArray(dest)
            ? typeof dest[0] === "number"
              ? dest[0] + 1
              : (await pdf.getPageIndex(dest[0])) + 1
            : null;
          resolved.set(index, n && n >= 1 && n <= pdf.numPages ? n : null);
        } catch {
          resolved.set(index, null);
        }
        if (alive && (next % 20 === 0 || resolved.size === items.length))
          setPages(new Map(resolved));
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
    return () => {
      alive = false;
    };
  }, [pdf, items]);
  let active: number | undefined;
  for (let index = 0; index < items.length; index++) {
    const n = pages.get(index),
      previous = active === undefined ? 0 : (pages.get(active) ?? 0);
    if (n && n <= page && n >= previous) active = index;
  }
  while (active !== undefined && !visible.includes(active))
    active = structure.parents[active];
  const toggle = (index: number) =>
    setCollapsed((old) => {
      const next = new Set(old);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  return (
    <section className="pdf-outline" aria-label="Document outline">
      <header className="pdf-outline-heading">
        <h3>Contents</h3>
        {items.length > 0 && (
          <div>
            <button
              className="icon-button"
              aria-label="Filter outline"
              title="Filter sections"
              aria-pressed={filtering}
              onClick={() => {
                setFiltering(!filtering);
                setQuery("");
                if (!filtering)
                  requestAnimationFrame(() => input.current?.focus());
              }}
            >
              <Search size={14} />
            </button>
            {structure.branches.size > 0 && (
              <button
                className="icon-button"
                aria-label="Collapse outline sections"
                title="Collapse sections"
                onClick={() => {
                  setQuery("");
                  setCollapsed(new Set(structure.branches));
                }}
              >
                <ChevronsDownUp size={14} />
              </button>
            )}
          </div>
        )}
      </header>
      {filtering && (
        <div className="pdf-outline-filter">
          <Search size={13} />
          <input
            ref={input}
            aria-label="Search PDF outline"
            placeholder="Find a section…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setFiltering(false);
                setQuery("");
              }
            }}
          />
          <button
            className="icon-button"
            aria-label="Close outline filter"
            onClick={() => {
              setFiltering(false);
              setQuery("");
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {!items.length && (
        <div className="pdf-outline-empty">
          <ListTree size={24} strokeWidth={1.25} />
          <p>No contents in this PDF</p>
          <small>Use Pages or Find to navigate.</small>
        </div>
      )}
      {!!items.length && !visible.length && (
        <p className="muted">No matching sections.</p>
      )}
      <nav aria-label="Document sections">
        <ul className="pdf-outline-list">
          {visible.map((index) => {
            const item = items[index],
              branch = structure.branches.has(index),
              number = pages.get(index),
              expanded = !!query || !collapsed.has(index);
            return (
              <li
                key={index}
                className={`pdf-outline-row ${index === active ? "is-current" : ""} ${item.depth === 0 ? "is-root" : ""}`}
                style={
                  {
                    "--outline-depth": Math.min(item.depth, 8),
                  } as React.CSSProperties
                }
              >
                {branch ? (
                  <button
                    className="pdf-outline-toggle"
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${item.title}`}
                    aria-expanded={expanded}
                    onClick={() => {
                      if (query) setQuery("");
                      toggle(index);
                    }}
                  >
                    {expanded ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                  </button>
                ) : (
                  <span className="pdf-outline-spacer" />
                )}
                <button
                  className="pdf-outline-link"
                  title={item.title}
                  aria-current={index === active ? "location" : undefined}
                  onClick={async () => {
                    if (number) {
                      onPage(number);
                      return;
                    }
                    if (branch) toggle(index);
                    else
                      setError(
                        "This section has no readable page destination.",
                      );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" && branch) {
                      e.preventDefault();
                      e.stopPropagation();
                      setCollapsed((old) => {
                        const next = new Set(old);
                        next.delete(index);
                        return next;
                      });
                    }
                    if (e.key === "ArrowLeft" && branch) {
                      e.preventDefault();
                      e.stopPropagation();
                      setCollapsed((old) => new Set(old).add(index));
                    }
                  }}
                >
                  <span>{item.title || "Untitled section"}</span>
                  {number && <small>{labels[number - 1] ?? number}</small>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      {error && <p role="status">{error}</p>}
    </section>
  );
}
