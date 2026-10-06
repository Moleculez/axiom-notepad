"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Button, IconButton, HelpText } from "../ui/controls";
import { Unlink } from "lucide-react";
import type { ResearchTaskLink } from "@axiom/shared/research-task-api";
import type { RevisionContent } from "@axiom/shared/revisions";
import type { ReferenceProvenance } from "@axiom/shared/research-library";
import { api } from "../../lib/client";
import Dialog, { DialogFooter } from "../Dialog";
import { useWorkspace, useData, useAction, mutate, ErrorNotice } from "./ui";
const PlanningMarkdown = dynamic(() => import("./PlanningMarkdown"));
export default function TaskResearchLinks({
  taskId,
  readOnly,
}: {
  taskId: string;
  readOnly: boolean;
}) {
  const { revision, refresh } = useWorkspace(),
    action = useAction(),
    data = useData<ResearchTaskLink[]>(
      `tasks/${taskId}/research-links`,
      revision,
    );
  const [source, setSource] = useState<{
    title: string;
    body: string;
    markdown: boolean;
  } | null>(null);
  if (!data.data?.length && !data.error) return null;
  return (
    <section className="task-paper-links" aria-label="Linked research sources">
      <h3>Research sources</h3>
      <ErrorNotice message={action.error || data.error} retry={data.reload} />
      {data.data?.map((link) => (
        <div key={link.id}>
          <Button
            variant="ghost"
            disabled={!link.available || action.busy}
            onClick={() =>
              void action.run(async () => {
                if (link.source_kind === "manuscript") {
                  const value = await api<RevisionContent>(
                    `resources/${link.note_id}/history/snapshot:${link.snapshot_id}`,
                  );
                  setSource({
                    title: value.label || value.title,
                    body: value.body ?? "",
                    markdown: true,
                  });
                } else {
                  const value = await api<ReferenceProvenance>(
                    `research/library/items/${link.reference_id}/provenance/${link.reference_event_id}`,
                  );
                  setSource({
                    title: String(value.after_data.title ?? "Reference source"),
                    body: String(
                      value.after_data.bibtex ??
                        JSON.stringify(value.after_data, null, 2),
                    ),
                    markdown: false,
                  });
                }
              })
            }
          >
            {link.name}
            <small>
              {" "}
              ·{" "}
              {link.source_kind === "manuscript"
                ? link.label || "Saved manuscript"
                : `Reference v${link.version}`}
              {!link.available ? " · unavailable" : ""}
            </small>
          </Button>
          {!readOnly && (
            <IconButton
              label="Remove research link"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await mutate(
                    `tasks/${taskId}/research-links/${link.id}`,
                    {},
                    "DELETE",
                  );
                  refresh();
                })
              }
            >
              <Unlink size={15} />
            </IconButton>
          )}
        </div>
      ))}
      {source && (
        <Dialog
          title={source.title}
          subtitle="Immutable linked source · never substituted with the current version"
          wide
          onClose={() => setSource(null)}
        >
          <HelpText>
            Images and external resources are disabled in this isolated source
            preview.
          </HelpText>
          {source.markdown ? (
            <PlanningMarkdown
              key={source.body}
              initial={source.body}
              onChange={() => {}}
              readOnly
              preview
              isolated
              label="Linked manuscript"
            />
          ) : (
            <pre className="reference-original">{source.body}</pre>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSource(null)}>
              Close
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </section>
  );
}
