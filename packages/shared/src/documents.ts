import * as Y from "yjs";
import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { parseMarkdown, plainText } from "@axiom/markdown";
import type { Note } from "./access";
import type pg from "pg";
import { requireScope } from "./workspace-service";
import {
  documentSource,
  initializeDocument,
  validateDocument,
  type DocumentFormat,
} from "./document-format";
import { canvasTitle, parseCanvas } from "./canvas";
export async function createNote(
  input: {
    id?: string;
    groupId: string | null;
    projectId?: string | null;
    parentId?: string | null;
    userId: string;
    title: string;
    visibility?: string;
    body?: string;
    tags?: string[];
    sourceFormat?: DocumentFormat;
    initialState?: string;
  },
  existingClient?: pg.PoolClient,
) {
  const id = input.id ?? randomUUID();
  let body = input.body ?? "";
  const doc = new Y.Doc();
  if (input.initialState) {
    Y.applyUpdate(doc, Buffer.from(input.initialState, "base64"));
    validateDocument(doc, input.sourceFormat);
    body = documentSource(doc, input.sourceFormat);
  } else initializeDocument(doc, body, input.sourceFormat);
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  const insert = async (client: pg.PoolClient) => {
    const {
      rows: [scope],
    } = await client.query(
      "SELECT id FROM spaces WHERE CASE WHEN $1='private' THEN kind='personal' AND owner_id=$2 WHEN $3::uuid IS NOT NULL THEN project_id=$3 ELSE kind='team' AND group_id=$4 END",
      [
        input.visibility ?? "shared",
        input.userId,
        input.projectId ?? null,
        input.groupId,
      ],
    );
    if (scope) await requireScope(client, input.userId, scope.id, "edit");
    const { rows } = await client.query<Note>(
      "INSERT INTO notes (id,group_id,project_id,parent_id,author_id,title,visibility,body,plain_text,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [
        id,
        input.groupId,
        input.projectId ?? null,
        input.parentId ?? null,
        input.userId,
        input.title,
        input.visibility ?? "shared",
        body,
        plainText(parseMarkdown(body).ast),
        input.tags ?? [],
      ],
    );
    await client.query(
      "INSERT INTO documents(room,note_id,state) VALUES($1,$2,$3)",
      [`${id}:1`, id, state],
    );
    if (input.sourceFormat && input.sourceFormat !== "markdown") {
      await client.query("UPDATE notes SET source_format=$2 WHERE id=$1", [
        id,
        input.sourceFormat,
      ]);
      await indexNote(`${id}:1`, body, client);
    }
    return rows[0];
  };
  return existingClient ? insert(existingClient) : transaction(insert);
}
export async function flushNote(note: Pick<Note, "id" | "generation">) {
  const response = await fetch(
    `${process.env.SYNC_INTERNAL_URL ?? "http://127.0.0.1:1234"}/internal/flush?room=${note.id}:${note.generation}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.SYNC_SECRET}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new Error(
      "Cannot confirm the latest saved version. Please try again once synchronization reconnects.",
    );
}
export async function notifyWorkspace(invalidate = false) {
  await query("SELECT pg_notify($1,$2)", [
    invalidate ? "axiom_access" : "axiom_refresh",
    "changed",
  ]);
}
/** Drain bounded pending reference journals without exposing private room names. */
export async function flushPendingReferenceIndex() {
  const notes = await query<{ id: string; generation: number }>(
    "SELECT DISTINCT n.id,n.generation FROM document_updates u JOIN notes n ON u.room=n.id::text||':'||n.generation::text LIMIT 50",
  );
  for (let i = 0; i < notes.length; i += 4)
    await Promise.all(notes.slice(i, i + 4).map((note) => flushNote(note)));
}
export async function indexNote(
  room: string,
  source: string,
  existingClient?: import("pg").PoolClient,
) {
  const id = room.split(":")[0],
    generation = Number(room.split(":")[1]);
  const index = async (client: import("pg").PoolClient) => {
    const {
      rows: [previous],
    } = await client.query(
      "SELECT body,source_format FROM notes WHERE id=$1 AND generation=$2 FOR NO KEY UPDATE",
      [id, generation],
    );
    if (!previous) return;
    // A canvas or raw document is not Markdown. Parse once per snapshot, and
    // retain reindexing even for unchanged source after a workspace transfer.
    const parsed =
      previous.source_format === "markdown" ? parseMarkdown(source) : null;
    const canvas =
      previous.source_format === "canvas" ? parseCanvas(source) : null;
    const result = await client.query(
      "UPDATE notes SET updated_at=CASE WHEN body IS DISTINCT FROM $1 THEN now() ELSE updated_at END,body=$1,plain_text=$2 WHERE id=$3 AND generation=$4 RETURNING group_id",
      [
        source,
        previous.source_format === "canvas"
          ? canvas!.nodes
              .map((n) =>
                [
                  canvasTitle(n),
                  ...(n.tags ?? []),
                  n.type === "text" ? n.text : n.type === "link" ? n.url : "",
                ].join("\n"),
              )
              .join("\n")
          : previous.source_format !== "markdown"
            ? source
            : plainText(parsed!.ast),
        id,
        generation,
      ],
    );
    if (!result.rowCount) return;
    await client.query("DELETE FROM note_citations WHERE note_id=$1", [id]);
    if (parsed?.citations.length)
      await client.query(
        "INSERT INTO note_citations(note_id,cite_key) SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING",
        [id, parsed.citations],
      );
    await client.query("DELETE FROM research_index_queue WHERE note_id=$1", [
      id,
    ]);
    if (previous.body !== source)
      await client.query(
        "UPDATE resources SET updated_at=now() WHERE note_id=$1",
        [id],
      );
    await client.query("DELETE FROM note_links WHERE source_id=$1", [id]);
    const targets = [
      ...new Set(
        (canvas
          ? canvas.nodes
              .filter((n) => n.type === "file" && n.resourceId)
              .map((n) => String(n.resourceId))
          : (parsed?.links.map((link) => link.target) ?? [])
        ).filter((target) => !/^(?:https?:|mailto:|\/|#)/.test(target)),
      ),
    ];
    if (targets.length) {
      // Limit each candidate set to two: UUID and title matches have always
      // been equally valid, and an ambiguous target must remain unresolved.
      const { rows: resolved } = await client.query<{
        target: string;
        target_id: string | null;
      }>(
        `SELECT input.target,CASE WHEN count(candidate.id)=1 THEN (array_agg(candidate.id))[1] END AS target_id
         FROM unnest($2::text[]) input(target)
         LEFT JOIN LATERAL (
           SELECT n.id FROM notes n JOIN resources r ON r.note_id=n.id
           WHERE r.space_id=(SELECT space_id FROM resources WHERE note_id=$1)
             AND n.deleted_at IS NULL AND (n.id::text=input.target OR lower(n.title)=lower(input.target)) LIMIT 2
         ) candidate ON true GROUP BY input.target`,
        [id, [...new Set(targets.map((target) => target.split("#")[0]))]],
      );
      const byTarget = new Map(
        resolved.map((row) => [row.target, row.target_id]),
      );
      await client.query(
        "INSERT INTO note_links(source_id,target,target_id) SELECT $1,input.target,input.target_id FROM unnest($2::text[],$3::uuid[]) input(target,target_id) ON CONFLICT DO NOTHING",
        [
          id,
          targets,
          targets.map((target) => byTarget.get(target.split("#")[0]) ?? null),
        ],
      );
    }
    if (previous.body !== source)
      await client.query("SELECT pg_notify('axiom_refresh','changed')");
  };
  if (existingClient) await index(existingClient);
  else await transaction(index);
}
/** Resumable derived-index backfill. Lock the current note before parsing so old
 * backfill work cannot overwrite a newer collaborative edit. */
export async function backfillResearchIndex() {
  return transaction(async (client) => {
    const { rows } = await client.query(
      "SELECT n.id AS note_id,n.body,n.source_format FROM notes n JOIN research_index_queue q ON q.note_id=n.id ORDER BY n.id LIMIT 25 FOR NO KEY UPDATE OF n SKIP LOCKED",
    );
    for (const row of rows) {
      const n = row;
      if (n) {
        await client.query("DELETE FROM note_citations WHERE note_id=$1", [
          row.note_id,
        ]);
        const keys =
          n.source_format === "markdown" ? parseMarkdown(n.body).citations : [];
        if (keys.length)
          await client.query(
            "INSERT INTO note_citations(note_id,cite_key) SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING",
            [row.note_id, keys],
          );
      }
      await client.query("DELETE FROM research_index_queue WHERE note_id=$1", [
        row.note_id,
      ]);
    }
    if (
      rows.length &&
      !(await client.query("SELECT 1 FROM research_index_queue LIMIT 1"))
        .rowCount
    )
      await client.query(
        "SELECT pg_notify('axiom_refresh','research-index-ready')",
      );
    return rows.length > 0;
  });
}
