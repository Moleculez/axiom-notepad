import * as Y from "yjs";
import { isDeepStrictEqual } from "node:util";
import { revisionAudit } from "./revision-audit";
import type pg from "pg";
import { HttpError } from "./access";
import { sourceHash } from "./document-commands";
import {
  documentSource,
  initializeDocument,
  validateDocument,
  type DocumentFormat,
} from "./document-format";
import { installAuditContext } from "./audit-context";
import { indexNote } from "./documents";
import { requireNoteScope } from "./workspace-service";
import {
  applyHunks,
  assertDisjointChanges,
  captureHunks,
  resolveHunks,
} from "./suggestion-hunks";
import type { RevisionCommand, SuggestionHunk } from "./revisions";

/** Caller owns the room gate and transaction. No live Y.Doc is mutated here. */
export async function executeRevisionCommand(
  client: pg.PoolClient,
  loaded: Y.Doc | undefined,
  actorId: string,
  sessionId: string,
  command: RevisionCommand,
) {
  const session = await client.query(
    "SELECT 1 FROM session WHERE id=$1 AND user_id=$2 AND expires_at>now() FOR SHARE",
    [sessionId, actorId],
  );
  if (!session.rowCount)
    throw new HttpError(401, "Sign in again before applying this change.");
  const capability =
    command.kind === "decision" && command.action === "withdraw"
      ? "comment"
      : "edit";
  await requireNoteScope(client, actorId, command.noteId, capability);
  await installAuditContext(client, {
    actorId,
    operationId: command.mutationId,
  });
  await client.query(
    "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
  );
  const {
    rows: [note],
  } = await client.query(
    "SELECT n.* FROM notes n WHERE n.id=$1 AND n.deleted_at IS NULL FOR UPDATE",
    [command.noteId],
  );
  if (!note || !["markdown", "latex", "text"].includes(note.source_format))
    throw new HttpError(400, "This action requires a text document.");
  // Settings writes take the same note lock; read AFTER acquiring it, not from
  // a pre-wait outer-join snapshot that could contain obsolete rendering data.
  note.settings =
    (
      await client.query(
        "SELECT settings FROM tool_projects WHERE resource_id=$1",
        [note.id],
      )
    ).rows[0]?.settings ?? null;
  const fingerprint = sourceHash(
    JSON.stringify({ type: "user-revision", actorId, command }),
  );
  const {
    rows: [receipt],
  } = await client.query(
    "SELECT * FROM document_command_receipts WHERE id=$1",
    [command.mutationId],
  );
  if (receipt) {
    if (receipt.actor_id !== actorId || receipt.request_hash !== fingerprint)
      throw new HttpError(409, "This retry belongs to another action.");
    return { result: receipt.result, update: null, restore: false };
  }
  if (note.generation !== command.generation)
    throw new HttpError(
      409,
      "Document generation changed. Reopen it before reviewing.",
    );
  const room = note.id + ":" + note.generation,
    doc = new Y.Doc();
  try {
    const {
      rows: [saved],
    } = await client.query(
      "SELECT state,revision FROM documents WHERE room=$1",
      [room],
    );
    if (!saved) throw new HttpError(409, "Document state is unavailable.");
    Y.applyUpdate(doc, new Uint8Array(saved.state));
    const { rows: journals } = await client.query(
      "SELECT id,data FROM document_updates WHERE room=$1 ORDER BY id",
      [room],
    );
    for (const journal of journals)
      Y.applyUpdate(doc, new Uint8Array(journal.data));
    if (loaded) Y.applyUpdate(doc, Y.encodeStateAsUpdate(loaded));
    const vector = Y.encodeStateVector(doc),
      before = documentSource(doc, note.source_format);
    const snapshot = async (label: string) =>
      (
        await client.query(
          "INSERT INTO snapshots(note_id,title,body,state,generation,label,author_id,settings,source_format) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
          [
            note.id,
            note.title,
            documentSource(doc, note.source_format),
            Buffer.from(Y.encodeStateAsUpdate(doc)),
            note.generation,
            label,
            actorId,
            note.settings,
            note.source_format,
          ],
        )
      ).rows[0].id as string;
    let result: Record<string, unknown>,
      restored = false;
    if (command.kind === "snapshot") {
      result = { id: "snapshot:" + (await snapshot(command.label)) };
    } else if (command.kind === "restore") {
      if (
        command.expectedSettings !== undefined &&
        !isDeepStrictEqual(note.settings ?? null, command.expectedSettings)
      )
        throw new HttpError(
          409,
          "Project settings changed after comparison. Save local settings or refresh before restoring.",
        );
      if (sourceHash(before) !== command.expectedHash)
        throw new HttpError(
          409,
          "The document changed after comparison. Refresh before restoring.",
        );
      const {
        rows: [target],
      } = await client.query(
        "SELECT * FROM snapshots WHERE id=$1 AND note_id=$2",
        [command.snapshotId, note.id],
      );
      if (!target)
        throw new HttpError(404, "This revision is no longer available.");
      await snapshot("Before restore");
      const replacement = new Y.Doc(),
        generation = note.generation + 1;
      initializeDocument(replacement, target.body, target.source_format);
      validateDocument(replacement, target.source_format);
      await client.query(
        "INSERT INTO documents(room,note_id,state) VALUES($1,$2,$3)",
        [
          note.id + ":" + generation,
          note.id,
          Buffer.from(Y.encodeStateAsUpdate(replacement)),
        ],
      );
      replacement.destroy();
      await client.query(
        "UPDATE notes SET title=$2,generation=$3,version=version+1 WHERE id=$1",
        [note.id, target.title, generation],
      );
      if (target.settings)
        await client.query(
          "UPDATE tool_projects SET settings=$2,version=version+1 WHERE resource_id=$1",
          [note.id, target.settings],
        );
      await indexNote(note.id + ":" + generation, target.body, client);
      restored = true;
      result = { generation, body: target.body, title: target.title };
    } else if (command.kind === "decision") {
      const unique = new Set(command.items.map((x) => x.id));
      if (unique.size !== command.items.length)
        throw new HttpError(400, "Select each proposal once.");
      const { rows } = await client.query(
        "SELECT * FROM revision_suggestions WHERE note_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
        [note.id, [...unique]],
      );
      if (rows.length !== unique.size)
        throw new HttpError(404, "A proposal is unavailable.");
      const edits: {
        from: number;
        to: number;
        insert: string;
        proposalId: string;
        hunkIndex: number;
      }[] = [];
      for (const proposal of rows) {
        if (
          proposal.status !== "pending" ||
          proposal.version !==
            command.items.find((x) => x.id === proposal.id)!.version
        )
          throw new HttpError(
            409,
            "A selected proposal changed. Refresh the review.",
          );
        if (command.action === "withdraw" && proposal.author_id !== actorId)
          throw new HttpError(
            403,
            "Only the author can withdraw this proposal.",
          );
        if (command.action === "accept") {
          if (proposal.generation !== note.generation)
            throw new HttpError(
              409,
              "This proposal belongs to a restored document generation.",
            );
          // Stored hunks are in source order. Keep their identities for inverse
          // decisions; repeated identical text must never be located by search.
          edits.push(
            ...(proposal.hunks as SuggestionHunk[]).map((h, hunkIndex) => ({
              ...resolveHunks(doc, [h])[0],
              proposalId: proposal.id,
              hunkIndex,
            })),
          );
        }
      }
      edits.sort((a, b) => a.from - b.from || a.to - b.to);
      assertDisjointChanges(edits);
      applyHunks(doc, edits, "review");
      validateDocument(doc, note.source_format);
      let offset = 0;
      const inverse = edits.map((c) => {
        const from = c.from + offset;
        offset += c.insert.length - (c.to - c.from);
        return {
          from,
          to: from + c.insert.length,
          insert: before.slice(c.from, c.to),
        };
      });
      const inverseHunks = captureHunks(doc, inverse).map((hunk, index) => ({
        hunk,
        proposalId: edits[index].proposalId,
        hunkIndex: edits[index].hunkIndex,
      }));
      await client.query(
        "INSERT INTO revision_decisions(id,note_id,generation,actor_id,action,suggestions,inverse_hunks) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          command.mutationId,
          note.id,
          note.generation,
          actorId,
          command.action,
          JSON.stringify(
            rows.map((p) => ({
              id: p.id,
              version: p.version,
              status: p.status,
              hunks: p.hunks,
            })),
          ),
          JSON.stringify(inverseHunks),
        ],
      );
      await client.query(
        "UPDATE revision_suggestions SET status=$3,version=version+1,decided_by=$4,decision_id=$5,decided_at=now(),updated_at=now() WHERE note_id=$1 AND id=ANY($2::uuid[])",
        [
          note.id,
          [...unique],
          command.action === "accept"
            ? "accepted"
            : command.action === "reject"
              ? "rejected"
              : "withdrawn",
          actorId,
          command.mutationId,
        ],
      );
      result = { decisionId: command.mutationId, count: rows.length };
    } else {
      const {
        rows: [decision],
      } = await client.query(
        "SELECT * FROM revision_decisions WHERE id=$1 AND note_id=$2 FOR UPDATE",
        [command.decisionId, note.id],
      );
      if (
        !decision ||
        decision.actor_id !== actorId ||
        decision.undone ||
        decision.generation !== note.generation
      )
        throw new HttpError(
          409,
          "This decision cannot be undone in the current document.",
        );
      const { rows } = await client.query(
        "SELECT * FROM revision_suggestions WHERE decision_id=$1 ORDER BY id FOR UPDATE",
        [decision.id],
      );
      if (
        rows.length !== decision.suggestions.length ||
        rows.some(
          (p) =>
            p.version !==
            decision.suggestions.find((x: { id: string }) => x.id === p.id)
              .version +
              1,
        )
      )
        throw new HttpError(409, "The proposals changed after that decision.");
      const inverseEntries = decision.inverse_hunks as {
        hunk: SuggestionHunk;
        proposalId: string;
        hunkIndex: number;
      }[];
      const edits = inverseEntries
        .map((e) => ({ ...resolveHunks(doc, [e.hunk])[0], entry: e }))
        .sort((a, b) => a.from - b.from || a.to - b.to);
      assertDisjointChanges(edits);
      applyHunks(doc, edits, "review-undo");
      validateDocument(doc, note.source_format);
      // Accepted replacements have new CRDT identities after an inverse. Reanchor
      // each original proposal to the restored range, never reuse deleted items.
      let offset = 0;
      const restoredRanges = edits.map((c) => {
        const from = c.from + offset;
        offset += c.insert.length - (c.to - c.from);
        return { from, to: from + c.insert.length, ...c.entry };
      });
      for (const row of rows) {
        const original = decision.suggestions.find(
          (x: { id: string }) => x.id === row.id,
        );
        let hunks: SuggestionHunk[] = original.hunks;
        if (decision.action === "accept") {
          hunks = original.hunks.map((h: SuggestionHunk, index: number) => {
            const range = restoredRanges.find(
              (r) => r.proposalId === row.id && r.hunkIndex === index,
            );
            if (!range) return h;
            return captureHunks(doc, [
              { from: range.from, to: range.to, insert: h.insert },
            ])[0];
          });
        }
        await client.query(
          "UPDATE revision_suggestions SET status='pending',hunks=$2,version=version+1,decision_id=NULL,decided_by=NULL,decided_at=NULL,updated_at=now() WHERE id=$1",
          [row.id, JSON.stringify(hunks)],
        );
      }
      await client.query(
        "UPDATE revision_decisions SET undone=true WHERE id=$1",
        [decision.id],
      );
      result = { undone: true };
    }
    const after = documentSource(doc, note.source_format as DocumentFormat);
    if (command.kind === "decision" || command.kind === "undo-decision")
      await revisionAudit(
        client,
        actorId,
        note.id,
        command.kind === "decision"
          ? "suggestion-" + command.action
          : "suggestion-decision-undone",
        result,
        command.mutationId,
      );
    const update = after === before ? null : Y.encodeStateAsUpdate(doc, vector);
    let revision = String(saved.revision ?? 0);
    if (journals.length) revision = String(journals.at(-1).id);
    if (update) {
      const row = await client.query(
        "INSERT INTO document_updates(room,data) VALUES($1,$2) RETURNING id",
        [room, Buffer.from(update)],
      );
      revision = String(row.rows[0].id);
    }
    await client.query(
      "UPDATE documents SET state=$2,revision=greatest(revision,$3),updated_at=now() WHERE room=$1",
      [room, Buffer.from(Y.encodeStateAsUpdate(doc)), revision],
    );
    await client.query(
      "DELETE FROM document_updates WHERE room=$1 AND id<=$2",
      [room, revision],
    );
    if (!restored && after !== note.body) await indexNote(room, after, client);
    await client.query(
      "INSERT INTO document_command_receipts(id,actor_id,note_id,request_hash,result) VALUES($1,$2,$3,$4,$5)",
      [
        command.mutationId,
        actorId,
        note.id,
        fingerprint,
        JSON.stringify(result),
      ],
    );
    await client.query("SELECT pg_notify('axiom_refresh','changed')");
    if (restored)
      await client.query("SELECT pg_notify('axiom_access','changed')");
    return { result, update, restore: restored };
  } finally {
    doc.destroy();
  }
}
