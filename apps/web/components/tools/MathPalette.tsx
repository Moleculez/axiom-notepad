"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { MathRequest } from "@axiom/markdown";
import {
  Search,
  Star,
  Sigma,
  LayoutTemplate,
  X,
  ChevronRight,
} from "lucide-react";
import {
  mathSymbols,
  mathCategories,
  mathSymbolFields,
  type MathSymbol,
} from "@axiom/editor/math-symbols";
import { MathSymbolIcon } from "../../lib/icons/MathSymbolIcon";
import { openContextMenu } from "../../lib/context-menu";
import {
  mathTemplates,
  matchesMathLibrary,
} from "../../lib/tools/math-library";

export default function MathPalette({
  userId,
  readOnly,
  insert,
  onError,
}: {
  userId: string;
  readOnly: boolean;
  insert: (value: string, fields?: [number, number][]) => void;
  onError: (message: string) => void;
}) {
  const [tab, setTab] = useState<"symbols" | "favorites" | "templates">(
      "symbols",
    ),
    [category, setCategory] = useState("all"),
    [search, setSearch] = useState(""),
    [favorites, setFavorites] = useState<string[]>([]),
    [inspected, setInspected] = useState<MathSymbol | null>(null);
  const id = useId(),
    results = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(`axiom:math-favorites:${userId}`) ?? "[]",
      );
      setFavorites(
        Array.isArray(saved)
          ? mathSymbols
              .filter((symbol) => saved.includes(symbol.id))
              .map((symbol) => symbol.id)
          : [],
      );
    } catch {
      setFavorites([]);
    }
  }, [userId]);
  useEffect(() => {
    results.current?.scrollTo({ top: 0 });
    setInspected(null);
  }, [search, category, tab]);
  const favorite = (symbol: MathSymbol) => {
    const next = favorites.includes(symbol.id)
      ? favorites.filter((value) => value !== symbol.id)
      : [...favorites, symbol.id];
    setFavorites(next);
    try {
      localStorage.setItem(
        `axiom:math-favorites:${userId}`,
        JSON.stringify(next),
      );
    } catch {
      onError("Favorites could not be saved on this device.");
    }
  };
  const symbols = mathSymbols.filter(
    (symbol) =>
      (tab !== "favorites" || favorites.includes(symbol.id)) &&
      (tab === "favorites" ||
        search.trim() ||
        category === "all" ||
        category === symbol.category) &&
      matchesMathLibrary(
        search,
        symbol.id,
        symbol.title,
        symbol.category,
        symbol.insert,
      ),
  );
  const templates = mathTemplates.filter((template) =>
    matchesMathLibrary(
      search,
      template.name,
      template.category,
      template.description,
      template.tex,
    ),
  );
  const count = tab === "templates" ? templates.length : symbols.length;
  return (
    <aside className="math-symbol-palette" aria-label="Math library">
      <header className="math-library-header">
        <div>
          <Sigma size={16} />
          <h2>Math library</h2>
          <small>{mathSymbols.length} symbols</small>
        </div>
        <label className="tool-search math-library-search">
          <Search size={15} />
          <input
            aria-label="Search math library"
            placeholder={
              tab === "templates"
                ? "Find a template…"
                : "Name, command, or topic…"
            }
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              className="icon-button"
              aria-label="Clear library search"
              onClick={() => setSearch("")}
            >
              <X size={13} />
            </button>
          )}
        </label>
        <div
          className="studio-segmented math-library-tabs"
          role="tablist"
          aria-label="Math library sections"
        >
          {(
            [
              ["symbols", "Symbols", Sigma],
              ["favorites", "Saved", Star],
              ["templates", "Templates", LayoutTemplate],
            ] as const
          ).map(([key, title, Icon]) => (
            <button
              key={key}
              id={`${id}-${key}`}
              role="tab"
              aria-selected={tab === key}
              aria-controls={`${id}-results`}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const keys = ["symbols", "favorites", "templates"] as const;
                const index =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 2
                      : (keys.indexOf(key) +
                          (event.key === "ArrowRight" ? 1 : 2)) %
                        3;
                setTab(keys[index]);
                document.getElementById(`${id}-${keys[index]}`)?.focus();
              }}
            >
              <Icon size={13} />
              {title}
            </button>
          ))}
        </div>
        {tab === "symbols" && (
          <select
            className="math-category"
            aria-label="Symbol category"
            value={search.trim() ? "all" : category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={!!search.trim()}
          >
            <option value="all">All symbols</option>
            {mathCategories.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        )}
        <div className="math-library-count" role="status">
          {count}{" "}
          {tab === "templates"
            ? "template"
            : tab === "favorites"
              ? "saved symbol"
              : "symbol"}
          {count === 1 ? "" : "s"}
          {search.trim() && " matching your search"}
        </div>
      </header>
      <div
        className="math-library-results"
        ref={results}
        id={`${id}-results`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}`}
      >
        {!count ? (
          <div className="math-library-empty">
            <Search size={24} strokeWidth={1.3} />
            <strong>{search ? "No matches" : "Save your go-to symbols"}</strong>
            <p>
              {search
                ? "Try a command, a name, or a topic such as calculus."
                : "Use the star on a symbol to keep it here. Saved symbols stay on this device."}
            </p>
          </div>
        ) : tab === "templates" ? (
          <div className="math-template-list">
            {templates.map((template) => (
              <button
                key={template.name}
                className="math-template"
                disabled={readOnly}
                onMouseDown={(event) => {
                  if (event.button === 0) event.preventDefault();
                }}
                onClick={() => insert(template.tex)}
                aria-label={`Insert ${template.name}`}
                title={template.description}
              >
                <span className="math-template-category">
                  {template.category}
                  <ChevronRight size={12} />
                </span>
                <span className="math-template-preview" aria-hidden="true">
                  <span
                    className="math-render"
                    data-math-request={JSON.stringify({
                      tex: template.tex,
                      display: true,
                      physics: true,
                      macros: [],
                    } satisfies MathRequest)}
                    aria-busy="true"
                  />
                </span>
                <strong>{template.name}</strong>
                <span className="math-template-description">
                  {template.description}
                </span>
              </button>
            ))}
          </div>
        ) : (
          mathCategories.map((group) => {
            const items = symbols.filter((symbol) => symbol.category === group);
            return !items.length ? null : (
              <section
                className="math-symbol-group"
                key={group}
                aria-label={group}
              >
                <h3>
                  {group}
                  <small>{items.length}</small>
                </h3>
                <div className="math-symbol-grid">
                  {items.map((symbol) => (
                    <div
                      key={symbol.id}
                      className="math-symbol-tile"
                      onMouseEnter={() => setInspected(symbol)}
                      onFocus={() => setInspected(symbol)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openContextMenu({
                          owner: event.currentTarget,
                          x: event.clientX,
                          y: event.clientY,
                          label: `${symbol.title} actions`,
                          items: [
                            {
                              label: "Insert symbol",
                              icon: "math",
                              disabled: readOnly,
                              action: () =>
                                insert(symbol.insert, mathSymbolFields(symbol)),
                            },
                            {
                              label: favorites.includes(symbol.id)
                                ? "Remove from saved symbols"
                                : "Save symbol",
                              icon: "star",
                              checked: favorites.includes(symbol.id),
                              group: "Library",
                              action: () => favorite(symbol),
                            },
                            {
                              label: "Copy LaTeX",
                              icon: "copy",
                              action: () => {
                                void navigator.clipboard
                                  .writeText(symbol.insert)
                                  .catch(() =>
                                    onError("Clipboard access was denied."),
                                  );
                              },
                            },
                          ],
                        });
                      }}
                    >
                      <button
                        className="math-symbol-insert"
                        aria-label={symbol.title}
                        title={`${symbol.title} · \\${symbol.id}`}
                        disabled={readOnly}
                        onMouseDown={(event) => {
                          if (event.button === 0) event.preventDefault();
                        }}
                        onClick={() =>
                          insert(symbol.insert, mathSymbolFields(symbol))
                        }
                      >
                        <MathSymbolIcon id={symbol.id} />
                        <small>\{symbol.id}</small>
                      </button>
                      <button
                        className="math-symbol-save"
                        aria-label={`${favorites.includes(symbol.id) ? "Unsave" : "Save"} ${symbol.title}`}
                        aria-pressed={favorites.includes(symbol.id)}
                        title={
                          favorites.includes(symbol.id)
                            ? "Remove from saved symbols"
                            : "Save symbol"
                        }
                        onClick={() => favorite(symbol)}
                      >
                        <Star size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
      <footer className="math-library-detail">
        {inspected ? (
          <>
            <strong>{inspected.title}</strong>
            <code>{inspected.insert}</code>
          </>
        ) : (
          <>
            <strong>
              {readOnly ? "Read-only library" : "Insert at your cursor"}
            </strong>
            <span>
              {tab === "templates"
                ? "Choose a preview to insert its LaTeX."
                : "Type \\ in Source for suggestions. Tab moves through placeholders."}
            </span>
          </>
        )}
      </footer>
    </aside>
  );
}
