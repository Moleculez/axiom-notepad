"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { Button, HelpText } from "../ui/controls";
import { useEffect, useMemo, useState } from "react";
import { documentAssets, parseMarkdown, plainText } from "@axiom/markdown";
import type { ResolvedAsset } from "@axiom/shared/editor-media";
import { api } from "../../lib/client";
import Dialog, { DialogFooter } from "../Dialog";
import { ErrorNotice, Loading } from "../workspace/ui";
export default function AttachmentChecks({
  source,
  onJump,
  onClose,
}: {
  source: string;
  onJump: (position: number) => void;
  onClose: () => void;
}) {
  useInterfaceLocale();
  const parsed = useMemo(() => parseMarkdown(source), [source]),
    assets = useMemo(() => documentAssets(parsed), [parsed]);
  const [resolved, setResolved] = useState<Map<string, ResolvedAsset> | null>(
      null,
    ),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResolved(null);
    setError("");
    void (async () => {
      const versions = [
          ...new Set(
            assets.flatMap((entry) =>
              entry.versionId ? [entry.versionId] : [],
            ),
          ),
        ],
        result = new Map<string, ResolvedAsset>();
      for (let i = 0; i < versions.length; i += 200) {
        const rows = await api<ResolvedAsset[]>("media-assets", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ versions: versions.slice(i, i + 200) }),
        });
        rows.forEach((row) => result.set(row.versionId, row));
      }
      if (!controller.signal.aborted) setResolved(result);
    })().catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    return () => controller.abort();
  }, [assets, retry]);
  const issues = [
    ...parsed.diagnostics
      .filter((item) => /figure|media wrapper/.test(item.message))
      .map((item) => ({ at: item.from, label: item.message })),
    ...assets.flatMap(({ node, versionId }) => {
      const entry = versionId ? resolved?.get(versionId) : undefined,
        result: { at: number; label: string }[] = [];
      if (node.type === "image" && !plainText(node).trim())
        result.push({ at: node.from, label: "Image has no alternative text" });
      if (entry?.unavailable)
        result.push({
          at: node.from,
          label: "Attachment missing or inaccessible",
        });
      if (entry?.currentVersionId && entry.currentVersionId !== versionId)
        result.push({
          at: node.from,
          label: `${entry.name}: a newer version is available; this reference stays pinned`,
        });
      return result;
    }),
  ];
  return (
    <Dialog
      title={uiText("Document attachment check")}
      subtitle={uiText(
        "Inspect references without changing this note or contacting external hosts",
      )}
      onClose={onClose}
      size="wide"
    >
      <ErrorNotice message={error} retry={() => setRetry((n) => n + 1)} />
      {!resolved && !error ? (
        <Loading label={uiText("Checking attachment access and versions…")} />
      ) : (
        <>
          <p>
            {assets.length} <I18nText id="links and images inspected." />{" "}
            {issues.length} <I18nText id="items to review." />
          </p>
          <div className="attachment-check-list">
            {issues.map((issue, index) => (
              <button
                key={`${issue.at}:${index}`}
                onClick={() => {
                  onClose();
                  onJump(issue.at);
                }}
              >
                {issue.label}
                <small>
                  <I18nText id="Go to occurrence" />
                </small>
              </button>
            ))}
          </div>
          {!issues.length && (
            <HelpText>
              <I18nText id="No attachment issues found." />
            </HelpText>
          )}
          <p className="ws-small muted">
            <I18nText id="Remote URLs are not network-tested. Private or missing resources use the same unavailable status. No files or versions are removed automatically." />
          </p>
        </>
      )}
      <DialogFooter>
        <Button className="button secondary" onClick={onClose}>
          <I18nText id="Close" />
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
