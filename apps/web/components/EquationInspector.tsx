"use client";
import { useMemo, useState } from "react";
import { Search, Sigma, AlertCircle, ArrowUpRight } from "lucide-react";
import {
  documentIndex,
  type ParsedDocument,
  type EquationEntry,
} from "@axiom/markdown";

export default function EquationInspector({
  parsed,
  navigate,
  openStudio,
}: {
  parsed: ParsedDocument;
  navigate: (position: number) => void;
  openStudio?: (equation: EquationEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const index = useMemo(() => documentIndex(parsed), [parsed]);
  const equations = index.equations.filter((equation) =>
    `${equation.label ?? ""} ${equation.tex}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="equation-inspector" aria-label="Equation inspector">
      <header>
        <Sigma size={19} />
        <div>
          <h2>Equations</h2>
          <p>
            {index.equations.length} display equations · {index.labels.size}{" "}
            labels
          </p>
        </div>
      </header>
      <label className="equation-search">
        <Search size={15} />
        <input
          type="search"
          aria-label="Search equations"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a label or TeX…"
        />
      </label>
      {!!index.diagnostics.length && (
        <div
          className="equation-diagnostics"
          aria-label="Equation reference warnings"
        >
          {index.diagnostics.map((diagnostic, i) => (
            <button
              key={`${diagnostic.from}:${i}`}
              onClick={() => navigate(diagnostic.from)}
            >
              <AlertCircle size={14} />
              <span>{diagnostic.message}</span>
            </button>
          ))}
        </div>
      )}
      <div className="equation-list">
        {equations.map((equation) => (
          <div className="equation-list-item" key={equation.from}>
            <button
              onClick={() => navigate(equation.from)}
              title="Go to equation source"
            >
              <span className="equation-number">{equation.number}</span>
              <span>
                <strong>{equation.label || "Unlabeled equation"}</strong>
                <code>
                  {equation.tex
                    .replace(/\\label\s*\{[^}]*\}/g, "")
                    .trim()
                    .slice(0, 220)}
                </code>
                <small>
                  {equation.label
                    ? `${index.references.filter((reference) => reference.label === equation.label).length} references`
                    : "Add a label from the equation menu"}
                </small>
              </span>
            </button>
            {openStudio && (
              <button
                className="button ghost equation-studio-link"
                onClick={() => openStudio(equation)}
              >
                <ArrowUpRight size={14} />
                Open in Math Studio
              </button>
            )}
          </div>
        ))}
      </div>
      {!equations.length && (
        <p className="muted ws-small">
          {query
            ? "No matching equations."
            : "Display equations appear here. Label important results to reference them throughout your research."}
        </p>
      )}
      <p className="equation-help">
        AMS and chemistry are available offline. Enable physics notation
        explicitly with <code>{"\\require{physics}"}</code>.
      </p>
    </section>
  );
}
