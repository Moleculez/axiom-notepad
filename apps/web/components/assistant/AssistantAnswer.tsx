"use client";
import { formatDate, formatNumber } from "@axiom/i18n";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, HelpText, Notice } from "../ui/controls";
import { useMemo, useState } from "react";
import {
  parseMarkdown,
  renderDocument,
  type MarkdownNode,
} from "@axiom/markdown";
import {
  assistantCitationKeys,
  type AssistantEvidence,
} from "@axiom/shared/assistant";
import Dialog from "../Dialog";
import { useWorkspace } from "../workspace/ui";
import { api } from "../../lib/client";

/** No provider-controlled HTML, image requests, diagram execution or navigation. */
export function assistantAnswerHtml(source: string) {
  const doc = parseMarkdown(source);
  const keys = assistantCitationKeys(source);
  const visit = (n: MarkdownNode) => {
    if (n.type === "codeBlock") n.lang = "";
    if (n.type === "wikiLink") {
      n.type = "text";
      const index = keys.indexOf(n.href ?? "");
      n.text = index < 0 ? `[[${n.text ?? n.href ?? ""}]]` : `[${index + 1}]`;
      n.children = undefined;
      n.href = undefined;
    }
    if (n.type === "link") {
      n.type = "strong";
      n.href = undefined;
    }
    if (
      [
        "toc",
        "metadata",
        "frontmatter",
        "footnoteRef",
        "footnoteReference",
        "citation",
        "include",
        "embed",
      ].includes(n.type)
    ) {
      n.type = "text";
      n.text = n.text ?? "";
      n.children = undefined;
    }
    n.children?.forEach(visit);
  };
  visit(doc.ast);
  Object.values(doc.footnotes).forEach((nodes) => nodes.forEach(visit));
  return renderDocument(doc, { disableImages: true, scrollTables: true });
}
export default function AssistantAnswer({
  source,
  evidence,
  spaceId,
  conversationId,
  turnId,
}: {
  source: string;
  evidence: AssistantEvidence[];
  spaceId: string;
  conversationId?: string;
  turnId?: string;
}) {
  const { t, locale } = useInterfaceLocale();
  const capturedDate = (value: string) =>
    formatDate(locale, value, { dateStyle: "medium", timeStyle: "short" });
  const { navigate } = useWorkspace(),
    [selected, setSelected] = useState<AssistantEvidence | null>(null);
  const [freshness, setFreshness] = useState("snapshot-only"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const inspect = async (e: AssistantEvidence) => {
    setError("");
    setLoading(true);
    try {
      if (conversationId && turnId) {
        const value = await api<{
          evidence: AssistantEvidence;
          freshness: string;
        }>(
          `assistant/conversations/${conversationId}/turns/${turnId}/evidence/${encodeURIComponent(e.key)}`,
        );
        setFreshness(value.freshness);
        setSelected(value.evidence);
      } else {
        setFreshness("snapshot-only");
        setSelected(e);
      }
    } catch (e) {
      setSelected(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const html = useMemo(() => assistantAnswerHtml(source), [source]);
  const keys = assistantCitationKeys(source);
  return (
    <>
      {error && <Notice tone="warning">{error}</Notice>}
      <div
        className="assistant-answer markdown-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {keys.length > 0 && (
        <div
          className="assistant-citations"
          aria-label={uiText("Answer sources")}
        >
          {keys.map((key, index) => {
            const e = evidence.find((e) => e.key === key);
            return e ? (
              <Button
                key={key}
                type="button"
                disabled={loading}
                onClick={() => void inspect(e)}
                title={t("Captured {date}", {
                  date: capturedDate(e.capturedAt),
                })}
              >
                {formatNumber(locale, index + 1)} · {e.title}
                {e.page ? (
                  <I18nText
                    id=" · Page {page, number}"
                    values={{ page: e.page }}
                  />
                ) : null}
              </Button>
            ) : (
              <span key={key} className="muted">
                {formatNumber(locale, index + 1)}{" "}
                <I18nText id="· Unverified citation" />
              </span>
            );
          })}
        </div>
      )}
      {selected && (
        <Dialog
          title={selected.title}
          subtitle={t(
            "Captured {date} · {kind, select, pdf {Browser-extracted text, not a verified quotation} other {Submitted evidence}}",
            { date: capturedDate(selected.capturedAt), kind: selected.kind },
          )}
          onClose={() => setSelected(null)}
        >
          <HelpText>
            <I18nText id="This is the exact excerpt sent. The current file or task may have changed. Citation membership does not verify the answer." />
          </HelpText>
          <HelpText>
            {freshness === "changed"
              ? uiText("Current source differs from this captured version.")
              : freshness === "current"
                ? uiText("Source matches this snapshot at inspection time.")
                : uiText(
                    "Captured snapshot; freshness has not been established.",
                  )}{" "}
            {selected.locator ? (
              <>
                <I18nText
                  id="Location: {locator}."
                  values={{ locator: selected.locator }}
                />{" "}
              </>
            ) : null}
            {selected.from !== undefined && selected.to !== undefined ? (
              <>
                <I18nText
                  id="Characters {from, number}–{to, number}."
                  values={{ from: selected.from, to: selected.to }}
                />{" "}
              </>
            ) : null}
            {selected.generation !== undefined ? (
              <>
                <I18nText
                  id="Generation {generation, number}."
                  values={{ generation: selected.generation }}
                />{" "}
              </>
            ) : null}
            {selected.versionId ? (
              <>
                <I18nText
                  id="File version {version}."
                  values={{ version: selected.versionId }}
                />{" "}
              </>
            ) : null}
            <I18nText
              id="Source hash: {hash}."
              values={{ hash: selected.hash.slice(0, 12) }}
            />
          </HelpText>
          <pre className="assistant-excerpt">{selected.source}</pre>
          <div className="dialog-footer">
            <Button
              className="button secondary"
              onClick={() => {
                const e = selected;
                setSelected(null);
                if (e.kind === "office") {
                  const query = new URLSearchParams({ version: e.versionId! });
                  const anchor = new URLSearchParams();
                  if (e.format === "xlsx" && e.locator) {
                    const at = e.locator.lastIndexOf("!");
                    anchor.set("sheet", e.locator.slice(0, at));
                    anchor.set("cell", e.locator.slice(at + 1));
                  } else if (e.locator)
                    anchor.set(
                      e.format === "pptx" ? "slide" : "block",
                      e.locator,
                    );
                  navigate(`/files/${e.id}?${query}#${anchor}`);
                } else if (e.versionId)
                  navigate(
                    `/pdf/${e.id}?version=${e.versionId}&page=${e.page ?? 1}`,
                  );
                else if (e.kind === "task")
                  navigate(
                    `/workspaces/${e.spaceId ?? spaceId}/planning?task=${e.id}`,
                  );
                else if (e.kind === "planning")
                  navigate(`/workspaces/${e.id}/planning`);
                else if (e.kind === "canvas")
                  navigate(
                    `/notes/${e.id}#card=${encodeURIComponent(e.locator?.split(",")[0] ?? "")}`,
                  );
                else
                  navigate(
                    `/${e.format === "latex" ? "math" : e.format === "text" ? "text" : "notes"}/${e.id}`,
                  );
              }}
            >
              <I18nText id="Open current source" />
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
