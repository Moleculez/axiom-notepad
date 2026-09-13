import * as Y from "yjs";
import { isDeepStrictEqual } from "node:util";
import { lockRevisionResource, revisionAudit } from "./revision-audit";
import { z } from "zod";
import { query, transaction } from "./db";
import { resourceAccess, noteAccess, HttpError } from "./access";
import { sourceHash } from "./document-commands";
import { documentSource } from "./document-format";
import { notifyWorkspace } from "./documents";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
  assertRevision,
} from "./workspace-service";
import {
  revisionCommandSchema,
  suggestionWriteSchema,
  type RevisionContent,
  type RevisionFormat,
  type RevisionSummary,
  type Suggestion,
} from "./revisions";
import { resolveHunks } from "./suggestion-hunks";
import { fileCreateApi } from "./file-create-api";

export async function currentRevisionDoc(noteId: string) {
  // Read state and the uncompacted journal in ONE database snapshot.
  const [row] = await query(
    "SELECT n.generation,n.source_format,p.settings,d.state,coalesce((SELECT array_agg(u.data ORDER BY u.id) FROM document_updates u WHERE u.room=d.room),'{}'::bytea[]) AS updates FROM notes n JOIN documents d ON d.room=n.id::text||':'||n.generation::text LEFT JOIN tool_projects p ON p.resource_id=n.id WHERE n.id=$1",
    [noteId],
  );
  if (!row) throw new HttpError(404, "Document state is unavailable.");
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, new Uint8Array(row.state));
    for (const update of row.updates)
      Y.applyUpdate(doc, new Uint8Array(update));
    return {
      doc,
      generation: Number(row.generation),
      format: row.source_format,
      settings: row.settings ?? null,
    };
  } catch (e) {
    doc.destroy();
    throw e;
  }
}
const reference = (value: string) => {
  const [kind, id, ...extra] = value.split(":");
  if (!["snapshot", "file", "legacy"].includes(kind) || extra.length)
    throw new HttpError(400, "Invalid revision reference.");
  return { kind, id: z.uuid().parse(id) };
};
export async function readResourceRevision(
  userId: string,
  resourceId: string,
  ref: string,
): Promise<RevisionContent> {
  const { resource } = await resourceAccess(userId, resourceId);
  const [note] = resource.note_id
    ? await query("SELECT * FROM notes WHERE id=$1", [resource.note_id])
    : [];
  const [tool] = await query(
    "SELECT kind,settings FROM tool_projects WHERE resource_id=$1",
    [resourceId],
  );
  const format: RevisionFormat =
    note?.source_format ?? (tool?.kind === "image" ? "image" : "text");
  const base: RevisionContent = {
    id: ref,
    title: resource.name,
    label: null,
    kind: "current",
    format,
    createdAt: resource.updated_at,
    author: null,
    contributors: [],
    generation: note?.generation ?? null,
    metadataVersion: 1,
    body: null,
    settings: tool?.settings ?? null,
    preview: null,
    download: null,
    fileVersion: null,
    hash: "",
  };
  if (ref === "seen") {
    const [seen] = await query(
      "SELECT * FROM revision_read_cursors WHERE resource_id=$1 AND user_id=$2 AND seen_at>now()-interval '30 days'",
      [resourceId, userId],
    );
    if (!seen)
      throw new HttpError(
        404,
        "No retained previous visit. Mark this revision reviewed to establish a baseline.",
      );
    if (seen.version_id) {
      const file = await readResourceRevision(
        userId,
        resourceId,
        "file:" + seen.version_id,
      );
      return {
        ...file,
        id: "seen",
        kind: "seen",
        label: "Previous visit",
        createdAt: seen.seen_at,
      };
    }
    return {
      ...base,
      kind: "seen",
      label: "Previous visit",
      body: seen.body,
      settings: seen.settings,
      generation: seen.generation,
      createdAt: seen.seen_at,
      hash: sourceHash(seen.body ?? ""),
    };
  }
  if (ref === "current" && note) {
    const current = await currentRevisionDoc(note.id);
    try {
      const body = documentSource(current.doc, current.format);
      return {
        ...base,
        body,
        generation: current.generation,
        settings: current.settings,
        hash: sourceHash(body),
        label: "Current document",
      };
    } finally {
      current.doc.destroy();
    }
  }
  if (ref === "current") {
    if (tool?.kind === "image") {
      const [head] = await query(
        "SELECT * FROM image_cloud_drafts WHERE resource_id=$1",
        [resourceId],
      );
      if (head && head.base_version === resource.current_version_id)
        return {
          ...base,
          kind: "current",
          label: "Current cloud working draft",
          createdAt: head.updated_at,
          fileVersion: head.base_version,
          cloudRevision: Number(head.revision),
          hash: sourceHash(JSON.stringify(head.manifest)),
          image: {
            width: head.manifest.project.width,
            height: head.manifest.project.height,
            layers: head.manifest.project.layers.length,
          },
          preview:
            "/api/v1/tools/" +
            resourceId +
            "/draft/assets/" +
            head.manifest.preview,
          download:
            "/api/v1/tools/" +
            resourceId +
            "/draft/download?revision=" +
            head.revision,
        };
    }
    if (!resource.current_version_id)
      throw new HttpError(404, "No saved version yet.");
    return {
      ...(await readResourceRevision(
        userId,
        resourceId,
        "file:" + resource.current_version_id,
      )),
      id: "current",
      kind: "current",
      label: "Current saved version",
    };
  }
  const target = reference(ref);
  if (target.kind === "snapshot" && note) {
    const [s] = await query(
      'SELECT s.*,u.name AS author FROM snapshots s LEFT JOIN "user" u ON u.id=s.author_id WHERE s.id=$1 AND s.note_id=$2',
      [target.id, note.id],
    );
    if (s)
      return {
        ...base,
        kind: "snapshot",
        title: s.title,
        label: s.label,
        body: s.body,
        generation: s.generation,
        settings: s.settings,
        author: s.author,
        contributors: s.contributors,
        createdAt: s.created_at,
        metadataVersion: s.metadata_version,
        hash: sourceHash(s.body),
      };
  }
  if (target.kind === "legacy") {
    const [s] = await query(
      'SELECT h.*,u.name AS author FROM tool_history h LEFT JOIN "user" u ON u.id=h.author_id WHERE h.id=$1 AND h.resource_id=$2',
      [target.id, resourceId],
    );
    if (s)
      return {
        ...base,
        kind: "legacy",
        label: s.label,
        body: s.source,
        settings: null,
        generation: null,
        author: s.author,
        createdAt: s.created_at,
        metadataVersion: s.metadata_version,
        hash: sourceHash(s.source),
      };
  }
  if (target.kind === "file") {
    const [s] = await query(
      'SELECT v.*,a.sha256,u.name AS author FROM file_versions v JOIN attachments a ON a.id=v.id LEFT JOIN "user" u ON u.id=v.created_by WHERE v.id=$1 AND v.resource_id=$2',
      [target.id, resourceId],
    );
    if (s)
      return {
        ...base,
        kind: "file",
        label: s.label ?? "Version " + s.ordinal,
        author: s.author,
        createdAt: s.created_at,
        metadataVersion: s.metadata_version,
        fileVersion: s.id,
        hash: s.sha256,
        settings: null,
        preview:
          "/api/v1/files/" + resourceId + "/preview-content?version=" + s.id,
        download: "/api/v1/files/" + resourceId + "/download?version=" + s.id,
      };
  }
  throw new HttpError(404, "This revision expired or is unavailable.");
}
export async function callRevisionCommand(
  actorId: string,
  sessionId: string,
  value: unknown,
) {
  const command = revisionCommandSchema.parse(value);
  const response = await fetch(
    (process.env.SYNC_INTERNAL_URL ?? "http://127.0.0.1:1234") +
      "/internal/revision-command",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + process.env.SYNC_SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify({ actorId, sessionId, command }),
      signal: AbortSignal.timeout(20000),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new HttpError(
      response.status,
      result.error ?? "The server could not confirm the revision action.",
    );
  return result;
}
export async function revisionApi(
  request: Request,
  path: string[],
  userId: string,
  sessionId: string,
): Promise<Response | null> {
  const [endpoint, id, action, ref, command] = path,
    method = request.method;
  if (
    endpoint !== "resources" ||
    !id ||
    !["history", "suggestions", "review-baseline", "review-visit"].includes(
      action,
    )
  )
    return null;
  const { resource } = await resourceAccess(userId, z.uuid().parse(id));
  const noteId = resource.note_id;
  if (action === "review-visit" && method === "POST") {
    const input = z
      .object({ mutationId: z.uuid() })
      .parse(await request.json());
    const value = await readResourceRevision(userId, id, "current");
    // Image baselines reference immutable milestones, never an expiring asset head.
    const captured =
      value.cloudRevision && value.fileVersion
        ? await readResourceRevision(userId, id, "file:" + value.fileVersion)
        : value;
    const previous = await transaction(async (client) => {
      await requireScope(client, userId, resource.space_id, "read");
      await lockRevisionResource(client, id, resource.space_id);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "revision-visit:" + userId + ":" + id,
      ]);
      const {
        rows: [existing],
      } = await client.query(
        "SELECT visit_id,previous FROM revision_read_cursors WHERE user_id=$1 AND resource_id=$2",
        [userId, id],
      );
      if (existing?.visit_id === input.mutationId)
        return existing.previous as RevisionContent | null;
      let previous: RevisionContent | null = null;
      try {
        previous = await readResourceRevision(userId, id, "seen");
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
      await client.query(
        "INSERT INTO revision_read_cursors(user_id,resource_id,body,settings,generation,version_id,visit_id,previous) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,resource_id) DO UPDATE SET body=excluded.body,settings=excluded.settings,generation=excluded.generation,version_id=excluded.version_id,seen_at=now(),visit_id=excluded.visit_id,previous=excluded.previous",
        [
          userId,
          id,
          captured.body,
          captured.settings,
          captured.generation,
          captured.fileVersion,
          input.mutationId,
          previous ? JSON.stringify(previous) : null,
        ],
      );
      return previous;
    });
    return json(previous);
  }
  if (action === "review-baseline") {
    if (method === "GET") {
      try {
        return json(await readResourceRevision(userId, id, "seen"));
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return json(null);
        throw e;
      }
    }
    if (method === "POST") {
      const {
        reference: selected,
        expectedHash,
        expectedSettings,
      } = z
        .object({
          reference: z.string().max(100).default("current"),
          expectedHash: z.string().optional(),
          expectedSettings: z
            .record(z.string(), z.unknown())
            .nullable()
            .optional(),
        })
        .parse(await request.json());
      const value = await readResourceRevision(userId, id, selected);
      if (
        (expectedHash !== undefined && value.hash !== expectedHash) ||
        (expectedSettings !== undefined &&
          !isDeepStrictEqual(value.settings, expectedSettings))
      )
        throw new HttpError(
          409,
          "This comparison is out of date. Refresh before marking the current revision reviewed.",
        );
      await transaction(async (client) => {
        await requireScope(client, userId, resource.space_id, "read");
        await lockRevisionResource(client, id, resource.space_id);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "revision-visit:" + userId + ":" + id,
        ]);
        await client.query(
          "INSERT INTO revision_read_cursors(user_id,resource_id,body,settings,generation,version_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,resource_id) DO UPDATE SET body=excluded.body,settings=excluded.settings,generation=excluded.generation,version_id=excluded.version_id,seen_at=now()",
          [
            userId,
            id,
            value.body,
            value.settings,
            value.generation,
            value.fileVersion,
          ],
        );
      });
      return json({ ok: true });
    }
  }
  if (action === "history") {
    if (method === "GET" && ref)
      return json(await readResourceRevision(userId, id, ref));
    if (method === "GET") {
      const url = new URL(request.url),
        cursor = url.searchParams.get("cursor");
      const parsedCursor = cursor
        ? z
            .tuple([z.string().datetime(), z.string().max(100)])
            .parse(JSON.parse(Buffer.from(cursor, "base64url").toString()))
        : null;
      const rows = await query(
        "SELECT * FROM (" +
          "SELECT 'snapshot:'||s.id::text AS id,s.title,s.label,'snapshot' AS kind,s.source_format AS format,s.created_at,u.name AS author,s.contributors,s.generation,s.metadata_version FROM snapshots s LEFT JOIN \"user\" u ON u.id=s.author_id WHERE s.note_id=$1 " +
          "UNION ALL SELECT 'legacy:'||h.id::text,r.name,h.label,'legacy',coalesce(n.source_format,'latex'),h.created_at,u.name,'{}'::text[],NULL,h.metadata_version FROM tool_history h JOIN resources r ON r.id=h.resource_id LEFT JOIN notes n ON n.id=r.note_id LEFT JOIN \"user\" u ON u.id=h.author_id WHERE h.resource_id=$2 " +
          "UNION ALL SELECT 'file:'||v.id::text,r.name,v.label,'file','image',v.created_at,u.name,'{}'::text[],NULL,v.metadata_version FROM file_versions v JOIN resources r ON r.id=v.resource_id LEFT JOIN \"user\" u ON u.id=v.created_by WHERE v.resource_id=$2" +
          ") h WHERE ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::text)) ORDER BY created_at DESC,id DESC LIMIT 101",
        [noteId, id, parsedCursor?.[0] ?? null, parsedCursor?.[1] ?? null],
      );
      const items: RevisionSummary[] = rows.slice(0, 100).map((r) => ({
        id: r.id,
        title: r.title,
        label: r.label,
        kind: r.kind,
        format: r.format,
        createdAt: new Date(r.created_at).toISOString(),
        author: r.author,
        contributors: r.contributors,
        generation: r.generation,
        metadataVersion: r.metadata_version,
      }));
      const last = items.at(-1);
      return json({
        items,
        nextCursor:
          rows.length > 100 && last
            ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString(
                "base64url",
              )
            : null,
      });
    }
    if (method === "POST" && !ref && noteId) {
      const input = z
        .object({
          label: z.string().trim().min(1).max(120),
          mutationId: z.uuid(),
        })
        .parse(await request.json());
      const note = await noteAccess(userId, noteId);
      return json(
        await callRevisionCommand(userId, sessionId, {
          ...input,
          kind: "snapshot",
          noteId,
          generation: note.generation,
        }),
        201,
      );
    }
    if (method === "PATCH" && ref) {
      const target = reference(ref);
      const input = z
        .object({
          label: z.string().trim().min(1).max(120),
          version: z.number().int().positive(),
          mutationId: z.uuid(),
        })
        .parse(await request.json());
      const value = await workspaceMutation(
        userId,
        input.mutationId,
        "revision-label",
        { id, ref, ...input },
        async (client) => {
          await requireScope(client, userId, resource.space_id, "edit");
          await lockRevisionResource(client, id, resource.space_id);
          const table =
            target.kind === "snapshot"
              ? "snapshots"
              : target.kind === "file"
                ? "file_versions"
                : "tool_history";
          const column = target.kind === "snapshot" ? "note_id" : "resource_id";
          const saved = await client.query(
            "UPDATE " +
              table +
              " SET label=$3,metadata_version=metadata_version+1 WHERE id=$1 AND " +
              column +
              "=$2 AND metadata_version=$4 RETURNING metadata_version",
            [
              target.id,
              target.kind === "snapshot" ? noteId : id,
              input.label,
              input.version,
            ],
          );
          if (!saved.rowCount)
            throw new HttpError(
              409,
              "This revision changed. Refresh before renaming.",
            );
          return { version: saved.rows[0].metadata_version };
        },
      );
      await notifyWorkspace();
      return json(value);
    }
    if (method === "POST" && command === "restore" && noteId) {
      const target = reference(ref);
      if (target.kind !== "snapshot")
        throw new HttpError(400, "Legacy checkpoints can be opened as copies.");
      const input = z
        .object({
          mutationId: z.uuid(),
          generation: z.number().int().positive(),
          expectedHash: z.string(),
          expectedSettings: z
            .record(z.string(), z.unknown())
            .nullable()
            .optional(),
        })
        .parse(await request.json());
      return json(
        await callRevisionCommand(userId, sessionId, {
          ...input,
          kind: "restore",
          noteId,
          snapshotId: target.id,
        }),
      );
    }
    if (method === "POST" && command === "copy") {
      const value = await readResourceRevision(userId, id, ref);
      if (value.body === null)
        throw new HttpError(400, "Open this image revision and use Save copy.");
      const input = z
        .object({
          mutationId: z.uuid(),
          name: z.string().trim().min(1).max(240),
        })
        .parse(await request.json());
      return fileCreateApi(
        new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify({
            ...input,
            type: value.format === "latex" ? "math" : value.format,
            source: value.body,
            settings: value.settings ?? undefined,
            spaceId: resource.space_id,
            parentId: resource.parent_id,
          }),
        }),
        ["files", "new"],
        userId,
      );
    }
  }
  if (action === "suggestions" && noteId) {
    const note = await noteAccess(userId, noteId);
    if (!["markdown", "latex"].includes(note.source_format ?? "markdown"))
      throw new HttpError(
        400,
        "Suggestions support Markdown and math documents.",
      );
    if (method === "GET") {
      const rows = await query(
        "SELECT s.*,u.name AS author,coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'author',p.name,'body',r.body,'createdAt',r.created_at) ORDER BY r.created_at,r.id) FROM revision_suggestion_replies r JOIN \"user\" p ON p.id=r.author_id WHERE r.suggestion_id=s.id),'[]'::jsonb) AS replies FROM revision_suggestions s JOIN \"user\" u ON u.id=s.author_id WHERE s.note_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 500",
        [noteId],
      );
      const current = await currentRevisionDoc(noteId);
      try {
        const values: Suggestion[] = rows.map((s) => {
          let ranges: Suggestion["ranges"],
            reason = "";
          if (s.status === "pending") {
            try {
              if (s.generation !== current.generation)
                throw new Error("Document generation changed.");
              ranges = resolveHunks(current.doc, s.hunks);
            } catch (e) {
              reason = (e as Error).message;
            }
          }
          return {
            id: s.id,
            noteId,
            generation: s.generation,
            authorId: s.author_id,
            author: s.author,
            version: s.version,
            status: s.status,
            hunks: s.hunks,
            message: s.message,
            createdAt: s.created_at,
            updatedAt: s.updated_at,
            replies: s.replies,
            ranges,
            conflicted: !!reason,
            reason,
            decidedBy: s.decided_by,
          };
        });
        return json(values);
      } finally {
        current.doc.destroy();
      }
    }
    if (method === "POST" && !ref) {
      const input = suggestionWriteSchema.parse(await request.json());
      const value = await workspaceMutation(
        userId,
        input.mutationId,
        "suggestion-write",
        { noteId, ...input },
        async (client) => {
          await requireScope(client, userId, resource.space_id, "comment");
          await lockRevisionResource(client, id, resource.space_id);
          const {
            rows: [previous],
          } = await client.query(
            "SELECT * FROM revision_suggestions WHERE id=$1 FOR UPDATE",
            [input.id],
          );
          if (
            previous &&
            (previous.note_id !== noteId ||
              previous.author_id !== userId ||
              (previous.status !== "pending" &&
                !(
                  previous.status === "withdrawn" &&
                  previous.decision_id === null
                )))
          )
            throw new HttpError(
              403,
              "Only the author may revise a pending proposal.",
            );
          assertRevision(previous?.version ?? 0, input.version);
          const result = await client.query(
            "INSERT INTO revision_suggestions(id,note_id,generation,author_id,hunks,message,status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET hunks=excluded.hunks,message=excluded.message,generation=excluded.generation,status=excluded.status,version=revision_suggestions.version+1,updated_at=now() RETURNING version",
            [
              input.id,
              noteId,
              input.generation,
              userId,
              JSON.stringify(input.hunks),
              input.message,
              input.hunks.length ? "pending" : "withdrawn",
            ],
          );
          await revisionAudit(
            client,
            userId,
            id,
            input.hunks.length ? "suggestion-proposed" : "suggestion-cleared",
            {
              proposalId: input.id,
              version: result.rows[0].version,
              regions: input.hunks.length,
            },
            input.mutationId,
          );
          return { id: input.id, version: result.rows[0].version };
        },
      );
      await notifyWorkspace();
      return json(value);
    }
    if (method === "POST" && ref === "decision") {
      const input = await request.json();
      return json(
        await callRevisionCommand(userId, sessionId, {
          ...input,
          kind: "decision",
          noteId,
        }),
      );
    }
    if (method === "POST" && ref === "undo") {
      const input = await request.json();
      return json(
        await callRevisionCommand(userId, sessionId, {
          ...input,
          kind: "undo-decision",
          noteId,
        }),
      );
    }
    if (method === "POST" && command === "reply") {
      const input = z
        .object({
          id: z.uuid(),
          body: z.string().trim().min(1).max(10000),
          mutationId: z.uuid(),
        })
        .parse(await request.json());
      const result = await workspaceMutation(
        userId,
        input.mutationId,
        "suggestion-reply",
        { noteId, ref, ...input },
        async (client) => {
          await requireScope(client, userId, resource.space_id, "comment");
          await lockRevisionResource(client, id, resource.space_id);
          const target = await client.query(
            "SELECT 1 FROM revision_suggestions WHERE id=$1 AND note_id=$2 FOR SHARE",
            [z.uuid().parse(ref), noteId],
          );
          if (!target.rowCount)
            throw new HttpError(404, "Proposal unavailable.");
          await client.query(
            "INSERT INTO revision_suggestion_replies(id,suggestion_id,author_id,body) VALUES($1,$2,$3,$4)",
            [input.id, ref, userId, input.body],
          );
          return { id: input.id };
        },
      );
      await notifyWorkspace();
      return json(result, 201);
    }
  }
  throw new HttpError(405, "This revision action is not supported.");
}
