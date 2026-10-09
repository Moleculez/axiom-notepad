"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import { useState } from "react";
import { Button, HelpText, ActionRow } from "../ui/controls";
import type { ReferenceProvenance } from "@axiom/shared/research-library";
import { api, timeAgo } from "../../lib/client";
import { useData, useAction, ErrorNotice } from "./ui";
import ResearchTaskHandoff from "./ResearchTaskHandoff";
export default function ReferenceHistory({
  referenceId,
  spaceId,
  canEdit,
}: {
  referenceId: string;
  spaceId: string;
  canEdit: boolean;
}) {
  useInterfaceLocale();
  const [cursors, setCursors] = useState<string[]>([""]),
    [source, setSource] = useState<ReferenceProvenance | null>(null),
    [handoff, setHandoff] = useState<ReferenceProvenance | null>(null);
  const base = `research/library/items/${referenceId}/provenance`,
    cursor = cursors.at(-1)!;
  const data = useData<{
      items: ReferenceProvenance[];
      nextCursor: string | null;
    }>(base + (cursor ? `?cursor=${cursor}` : "")),
    action = useAction();
  return (
    <section
      className="reference-history"
      aria-label={uiText("Reference provenance")}
    >
      <HelpText>
        <I18nText id="History starts at the upgrade baseline for existing records. Imports and explicit changes retain their source and field decisions; no earlier history is invented." />
      </HelpText>
      <ErrorNotice message={data.error || action.error} retry={data.reload} />
      {data.data?.items.map((event) => (
        <article key={event.id}>
          <header>
            <strong>
              {event.kind === "baseline"
                ? uiText("Existing at upgrade")
                : event.kind[0].toUpperCase() + event.kind.slice(1)}
            </strong>
            <span>
              v{event.version} · {timeAgo(event.created_at)}
              {event.actor ? ` · ${event.actor}` : ""}
            </span>
          </header>
          <HelpText>
            {String(event.after_data.cite_key ?? "Reference")}
          </HelpText>
          {event.before_data && (
            <dl>
              {Object.entries(event.after_data)
                .filter(
                  ([key, value]) =>
                    JSON.stringify(value) !==
                    JSON.stringify(event.before_data?.[key]),
                )
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replaceAll("_", " ")}</dt>
                    <dd>
                      <del>{String(event.before_data?.[key] ?? "Empty")}</del>
                      <span> → </span>
                      <span>
                        {key === "merged_into"
                          ? value
                            ? "Retained reference"
                            : "Separate record"
                          : Array.isArray(value)
                            ? value.join(", ")
                            : String(value ?? "Empty")}
                      </span>
                    </dd>
                  </div>
                ))}
            </dl>
          )}
          {event.kind === "merge" && !!event.details.extraFields && (
            <HelpText>
              <I18nText id="Additional field decisions:" />{" "}
              {Object.entries(
                event.details.extraFields as Record<string, string>,
              )
                .map(([key, value]) => `${key}: ${value}`)
                .join(" · ") || "Retained record values"}
            </HelpText>
          )}
          <ActionRow>
            <Button
              variant="ghost"
              onClick={() =>
                void action.run(async () =>
                  setSource(
                    await api<ReferenceProvenance>(`${base}/${event.id}`),
                  ),
                )
              }
            >
              <I18nText id="View source" />
            </Button>
            {canEdit && (
              <Button variant="ghost" onClick={() => setHandoff(event)}>
                <I18nText id="Follow-up task" />
              </Button>
            )}
          </ActionRow>
        </article>
      ))}
      {source && (
        <details className="reference-original" open>
          <summary>
            <I18nText id="Selected source · v" />
            {source.version}
          </summary>
          <pre>
            {String(source.after_data.bibtex ?? "No original BibTeX record")}
          </pre>
          <Button variant="ghost" onClick={() => setSource(null)}>
            <I18nText id="Close source" />
          </Button>
        </details>
      )}
      <ActionRow>
        <Button
          variant="secondary"
          disabled={cursors.length === 1}
          onClick={() => setCursors((old) => old.slice(0, -1))}
        >
          <I18nText id="Newer" />
        </Button>
        <Button
          variant="secondary"
          disabled={!data.data?.nextCursor}
          onClick={() => setCursors((old) => [...old, data.data!.nextCursor!])}
        >
          <I18nText id="Older" />
        </Button>
      </ActionRow>
      {handoff && (
        <ResearchTaskHandoff
          spaceId={spaceId}
          endpoint={`research/library/items/${handoff.reference_id}/research-tasks`}
          anchor={{ referenceEventId: handoff.id }}
          title={String(handoff.after_data.title ?? "reference")}
          onClose={() => setHandoff(null)}
        />
      )}
    </section>
  );
}
