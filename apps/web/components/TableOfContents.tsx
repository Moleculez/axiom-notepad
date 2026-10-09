"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";
import { t, currentLocale } from "@axiom/i18n/client";
import { formatNumber } from "@axiom/i18n";

import { useEffect, useId, useMemo } from "react";
import { ChevronRight, ListTree } from "lucide-react";
import {
  outlineAncestors,
  outlineBranches,
  outlineTree,
  type OutlineHeading,
  type OutlineNode,
} from "../lib/outline";

export default function TableOfContents({
  headings,
  activeId,
  collapsed,
  onCollapsedChange,
  onNavigate,
  reveal,
}: {
  headings: OutlineHeading[];
  activeId: string | null;
  collapsed: string[];
  onCollapsedChange: (ids: string[]) => void;
  onNavigate: (heading: OutlineHeading) => void;
  reveal: number;
}) {
  useInterfaceLocale();
  const prefix = useId(),
    tree = useMemo(() => outlineTree(headings), [headings]);
  const branches = useMemo(() => outlineBranches(tree), [tree]);
  // A section reached from the caret, a bookmark or a deep link must be visible.
  // Merely collapsing a branch must not immediately reopen it.
  useEffect(() => {
    const ancestors = outlineAncestors(tree, activeId ?? "");
    if (collapsed.some((id) => ancestors.includes(id)))
      onCollapsedChange(collapsed.filter((id) => !ancestors.includes(id)));
    // The disclosure state is intentionally not a trigger for revealing a section.
  }, [activeId, reveal, tree]);
  const render = (nodes: OutlineNode[]) => (
    <ol>
      {nodes.map((node) => {
        const expandable = node.children.length > 0,
          closed = collapsed.includes(node.id);
        return (
          <li key={node.id} data-depth={node.depth}>
            <div
              className={`toc-row ${activeId === node.id ? "is-current" : ""}`}
            >
              {expandable ? (
                <button
                  type="button"
                  className="toc-disclosure"
                  aria-label={t(
                    closed ? "Expand {title}" : "Collapse {title}",
                    { title: node.text },
                  )}
                  aria-expanded={!closed}
                  aria-controls={`${prefix}-${node.id}`}
                  onClick={() =>
                    onCollapsedChange(
                      closed
                        ? collapsed.filter((id) => id !== node.id)
                        : [...collapsed, node.id],
                    )
                  }
                >
                  <ChevronRight size={13} aria-hidden="true" />
                </button>
              ) : (
                <span className="toc-leaf" aria-hidden="true">
                  <i />
                </span>
              )}
              <button
                type="button"
                className="toc-link"
                aria-current={activeId === node.id ? "location" : undefined}
                onClick={() => onNavigate(node)}
                title={node.text}
              >
                {node.text}
              </button>
            </div>
            {expandable && (
              <div id={`${prefix}-${node.id}`} hidden={closed}>
                {render(node.children)}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
  return (
    <nav className="table-of-contents" aria-label={uiText("Table of contents")}>
      <div className="toc-heading">
        <span>
          <I18nText id="On this page" />
        </span>
        <span
          className="toc-count"
          aria-label={t("{count, number} headings", { count: headings.length })}
        >
          {formatNumber(currentLocale(), headings.length)}
        </span>
      </div>
      {branches.length > 0 && (
        <div className="toc-actions">
          <button
            type="button"
            onClick={() => onCollapsedChange([])}
            disabled={!collapsed.length}
          >
            <I18nText id="Expand all" />
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => onCollapsedChange(branches)}
            disabled={branches.every((id) => collapsed.includes(id))}
          >
            <I18nText id="Collapse all" />
          </button>
        </div>
      )}
      {tree.length ? (
        render(tree)
      ) : (
        <div className="toc-empty">
          <ListTree size={24} aria-hidden="true" />
          <p>
            <I18nText id="A map of your thinking" />
          </p>
          <small>
            <I18nText id="Add headings to navigate the ideas in this note." />
          </small>
        </div>
      )}
    </nav>
  );
}
