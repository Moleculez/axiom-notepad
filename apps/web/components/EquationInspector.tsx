"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, SearchField } from "./ui/controls";
import { useMemo, useState } from "react";
import { Sigma, AlertCircle, ArrowUpRight } from "lucide-react";
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
  useInterfaceLocale();
  const [query, setQuery] = useState("");
  const index = useMemo(() => documentIndex(parsed), [parsed]);
  const equations = index.equations.filter((equation) =>
    `${equation.label ?? ""} ${equation.tex}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section
      className="equation-inspector"
      aria-label={uiText("Equation inspector")}
    >
      <header>
        <Sigma size={19} />
        <div>
          <h2>
            <I18nText id="Equations" />
          </h2>
          <p>
            {index.equations.length} <I18nText id="display equations ·" />{" "}
            {index.labels.size} <I18nText id="labels" />
          </p>
        </div>
      </header>
      <SearchField
        wrapperClassName="equation-search"
        type="search"
        aria-label={uiText("Search equations")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={uiText("Find a label or TeX…")}
      />
      {!!index.diagnostics.length && (
        <div
          className="equation-diagnostics"
          aria-label={uiText("Equation reference warnings")}
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
              title={uiText("Go to equation source")}
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
                    : uiText("Add a label from the equation menu")}
                </small>
              </span>
            </button>
            {openStudio && (
              <Button
                className="button ghost equation-studio-link"
                onClick={() => openStudio(equation)}
              >
                <ArrowUpRight size={14} />
                <I18nText id="Open in Math Studio" />
              </Button>
            )}
          </div>
        ))}
      </div>
      {!equations.length && (
        <p className="muted ws-small">
          {query
            ? uiText("No matching equations.")
            : uiText(
                "Display equations appear here. Label important results to reference them throughout your research.",
              )}
        </p>
      )}
      <p className="equation-help">
        <I18nText id="AMS and chemistry are available offline. Enable physics notation explicitly with" />{" "}
        <code>{"\\require{physics}"}</code>.
      </p>
    </section>
  );
}
