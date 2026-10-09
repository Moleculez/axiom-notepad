"use client";
import { uiText, useInterfaceLocale, I18nText } from "@axiom/i18n/react";

import { useState } from "react";
import { HelpText } from "../ui/controls";
import { ErrorNotice, Loading, useData, useWorkspace } from "../workspace/ui";
import type { LatexReference, LatexAsset } from "@axiom/shared/latex-export";
export default function PaperReviewEvidence({
  id,
  summary,
}: {
  id: string;
  summary: { sourceHash: string; referenceCount: number; assetCount: number };
}) {
  useInterfaceLocale();
  const [open, setOpen] = useState(false),
    { revision } = useWorkspace();
  const data = useData<{
    unavailable?: boolean;
    sourceHash: string;
    references: LatexReference[];
    assets: LatexAsset[];
  }>(open ? `reviews/${id}/paper-context` : null, revision);
  return (
    <details
      className="paper-review-context"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <I18nText id="Frozen paper evidence ·" /> {summary.referenceCount}{" "}
        <I18nText id="bibliography keys ·" /> {summary.assetCount}{" "}
        <I18nText id="attached versions" />
      </summary>
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.loading && !data.data && (
        <Loading label={uiText("Loading frozen evidence…")} />
      )}
      {data.data?.unavailable ? (
        <HelpText>
          <I18nText id="Some frozen paper evidence is no longer accessible. No newer version has been substituted." />
        </HelpText>
      ) : (
        data.data && (
          <>
            <HelpText>
              <I18nText id="Source hash" /> {data.data.sourceHash.slice(0, 12)}{" "}
              <I18nText id="· bibliography and figure identities captured when this review was assigned." />
            </HelpText>
            <ul>
              {data.data.references.map((ref) => (
                <li key={ref.cite_key}>
                  <strong>
                    {ref.cite_key} · {ref.title}
                  </strong>
                  <HelpText>
                    {ref.authors} · v{ref.version}
                  </HelpText>
                  {ref.bibtex && (
                    <details>
                      <summary>
                        <I18nText id="BibTeX source" />
                      </summary>
                      <pre className="reference-original">{ref.bibtex}</pre>
                    </details>
                  )}
                </li>
              ))}
              {data.data.assets.map((asset) => (
                <li key={asset.id}>
                  {asset.name}
                  <HelpText>
                    <I18nText id="Exact version · SHA-256" />{" "}
                    {asset.sha256.slice(0, 12)}
                  </HelpText>
                </li>
              ))}
            </ul>
          </>
        )
      )}
    </details>
  );
}
