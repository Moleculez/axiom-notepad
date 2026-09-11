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
  const parsed = parseMarkdown(source);
  const index = async (client: import("pg").PoolClient) => {
    const {
      rows: [previous],
    } = await client.query(
      "SELECT body,source_format FROM notes WHERE id=$1 AND generation=$2 FOR NO KEY UPDATE",
      [id, generation],
    );
    if (!previous) return;
    const result = await client.query(
      "UPDATE notes SET updated_at=CASE WHEN body IS DISTINCT FROM $1 THEN now() ELSE updated_at END,body=$1,plain_text=$2 WHERE id=$3 AND generation=$4 RETURNING group_id",
      [
        source,
        previous.source_format === "canvas"
          ? parseCanvas(source)
              .nodes.map((n) =>
                [
                  canvasTitle(n),
                  ...(n.tags ?? []),
                  n.type === "text" ? n.text : n.type === "link" ? n.url : "",
                ].join("\n"),
              )
              .join("\n")
          : previous.source_format !== "markdown"
            ? source
            : plainText(parsed.ast),
        id,
        generation,
      ],
    );
    if (!result.rowCount) return;
    if (previous.body !== source)
      await client.query(
        "UPDATE resources SET updated_at=now() WHERE note_id=$1",
        [id],
      );
    await client.query("DELETE FROM note_links WHERE source_id=$1", [id]);
    for (const link of previous.source_format === "canvas"
      ? parseCanvas(source)
          .nodes.filter((n) => n.type === "file" && n.resourceId)
          .map((n) => ({ target: String(n.resourceId) }))
      : previous.source_format !== "markdown"
        ? []
        : parsed.links) {
      if (/^(?:https?:|mailto:|\/|#)/.test(link.target)) continue;
      const target = link.target.split("#")[0];
      const { rows } = await client.query(
        "SELECT n.id FROM notes n JOIN resources r ON r.note_id=n.id WHERE r.space_id=(SELECT space_id FROM resources WHERE note_id=$1) AND n.deleted_at IS NULL AND (n.id::text=$2 OR lower(n.title)=lower($2)) LIMIT 2",
        [id, target],
      );
      await client.query(
        "INSERT INTO note_links(source_id,target,target_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, link.target, rows.length === 1 ? rows[0].id : null],
      );
    }
    if (previous.body !== source)
      await client.query("SELECT pg_notify('axiom_refresh','changed')");
  };
  if (existingClient) await index(existingClient);
  else await transaction(index);
}
