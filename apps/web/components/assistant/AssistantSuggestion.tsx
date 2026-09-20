"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { NativeBinding } from "@axiom/editor/binding";
import type { ProposalDraft } from "../../lib/suggestion-outbox";
import { hasSuggestionBase } from "@axiom/shared/suggestion-hunks";
import { useData, useLocation, ErrorNotice } from "../workspace/ui";
const SuggestionEditor = dynamic(
  () => import("../revisions/SuggestionEditor"),
  { ssr: false },
);
export default function AssistantSuggestion({
  noteId,
  generation,
  title,
  accepted,
  format = "markdown",
}: {
  noteId: string;
  generation: number;
  title: string;
  accepted: NativeBinding;
  format?: "markdown" | "latex";
}) {
  const { params } = useLocation(),
    id = params.get("assistantDraft"),
    receipt = params.get("assistantReceipt");
  const [closed, setClosed] = useState<string | null>(null);
  const data = useData<ProposalDraft>(
    id && receipt && closed !== id
      ? `assistant/proposals/${id}/draft?receipt=${encodeURIComponent(receipt)}`
      : null,
  );
  const [ready, setReady] = useState("");
  const vector = data.data?.assistantStateVector;
  const identity = `${id}:${generation}:${vector}`;
  useEffect(() => {
    const check = () => {
      if (vector && hasSuggestionBase(accepted.doc, vector)) setReady(identity);
    };
    check();
    accepted.doc.on("update", check);
    return () => {
      accepted.doc.off("update", check);
    };
  }, [accepted, identity, vector]);
  if (!id || closed === id) return null;
  const mismatch = data.data && data.data.generation !== generation;
  if (data.error || mismatch)
    return (
      <div className="assistant-seed-error">
        <ErrorNotice
          message={
            data.error ||
            "This proposal belongs to an earlier document generation. Review a fresh proposal."
          }
        />
        <button onClick={() => setClosed(id)}>Dismiss draft request</button>
      </div>
    );
  if (data.data?.noteId !== noteId) return null;
  if (ready !== identity)
    return (
      <div className="assistant-seed-error" role="status">
        <p>
          Waiting for the collaborative document before opening this private
          proposal…
        </p>
        <button onClick={() => setClosed(id)}>Close draft request</button>
      </div>
    );
  return (
    <SuggestionEditor
      noteId={noteId}
      generation={generation}
      title={title}
      accepted={accepted}
      format={format}
      seed={{ ...data.data, manualPublish: true }}
      onClose={() => setClosed(id)}
    />
  );
}
