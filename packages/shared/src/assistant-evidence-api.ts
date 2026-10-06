import { z } from "zod";
import { query } from "./db";
import { HttpError, resourceAccess } from "./access";
import { assistantContext, assertAssistantAccess } from "./assistant-service";
import { assistantAllEvidence } from "./assistant-run-review";
import { currentRevisionDoc } from "./revision-api";
import { documentSource } from "./document-format";
import { sourceHash } from "./document-commands";

export async function assistantCapturedEvidence(
  user: string,
  conversationId: string,
  turnId: string,
  key: string,
) {
  z.string()
    .regex(/^E[a-zA-Z0-9_-]+$/)
    .parse(key);
  const [job] = await query(
    "SELECT assistant_context_id FROM tool_jobs WHERE id=$1 AND owner_id=$2 AND kind='assistant'",
    [z.uuid().parse(turnId), user],
  );
  if (!job) throw new HttpError(404, "Private evidence unavailable.");
  const c = await assistantContext(job.assistant_context_id, user);
  if (c.conversation_id !== conversationId)
    throw new HttpError(404, "Private evidence unavailable.");
  await assertAssistantAccess(c);
  const evidence = (await assistantAllEvidence(c)).find((e) => e.key === key);
  if (!evidence)
    throw new HttpError(
      404,
      "This source was not submitted in the turn's context.",
    );
  let freshness: "current" | "changed" | "snapshot-only" = "snapshot-only";
  if (evidence.kind === "document" || evidence.kind === "canvas") {
    const { resource } = await resourceAccess(user, evidence.id);
    if (resource.note_id && evidence.excerptHash) {
      const current = await currentRevisionDoc(resource.note_id);
      try {
        freshness =
          current.generation === evidence.generation &&
          sourceHash(documentSource(current.doc, current.format)) ===
            evidence.hash
            ? "current"
            : "changed";
      } finally {
        current.doc.destroy();
      }
    }
  } else if (evidence.kind === "task") {
    const [task] = await query(
      "SELECT version FROM tasks WHERE id=$1 AND deleted_at IS NULL",
      [evidence.id],
    );
    freshness = task?.version === evidence.version ? "current" : "changed";
  } else if (evidence.versionId) {
    const { resource } = await resourceAccess(user, evidence.id);
    freshness =
      resource.current_version_id === evidence.versionId
        ? "current"
        : "changed";
  }
  await assertAssistantAccess(c);
  return { evidence, freshness };
}
