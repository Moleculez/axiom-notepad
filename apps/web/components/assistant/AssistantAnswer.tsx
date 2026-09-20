"use client";
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
}: {
  source: string;
  evidence: AssistantEvidence[];
  spaceId: string;
}) {
  const { navigate } = useWorkspace(),
    [selected, setSelected] = useState<AssistantEvidence | null>(null);
  const html = useMemo(() => assistantAnswerHtml(source), [source]);
  const keys = assistantCitationKeys(source);
  return (
    <>
      <div
        className="assistant-answer markdown-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {keys.length > 0 && (
        <div className="assistant-citations" aria-label="Answer sources">
          {keys.map((key, index) => {
            const e = evidence.find((e) => e.key === key);
            return e ? (
              <button
                key={key}
                onClick={() => setSelected(e)}
                title={`Captured ${new Date(e.capturedAt).toLocaleString()}`}
              >
                {index + 1} · {e.title}
                {e.page ? ` · p. ${e.page}` : ""}
              </button>
            ) : (
              <span key={key} className="muted">
                {index + 1} · Unverified citation
              </span>
            );
          })}
        </div>
      )}
      {selected && (
        <Dialog
          title={selected.title}
          subtitle={`Captured ${new Date(selected.capturedAt).toLocaleString()} · ${selected.kind === "pdf" ? "Browser-extracted text, not a verified quotation" : "Submitted evidence"}`}
          onClose={() => setSelected(null)}
        >
          <p className="ws-note">
            This is the exact excerpt sent. The current file or task may have
            changed. Citation membership does not verify the answer.
          </p>
          <pre className="assistant-excerpt">{selected.source}</pre>
          <div className="dialog-footer">
            <button
              className="button secondary"
              onClick={() => {
                const e = selected;
                setSelected(null);
                if (e.versionId)
                  navigate(
                    `/pdf/${e.id}?version=${e.versionId}&page=${e.page ?? 1}`,
                  );
                else if (e.kind === "task")
                  navigate(`/workspaces/${spaceId}/planning?task=${e.id}`);
                else
                  navigate(
                    `/${e.format === "latex" ? "math" : e.format === "text" ? "text" : "notes"}/${e.id}`,
                  );
              }}
            >
              Open current source
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
