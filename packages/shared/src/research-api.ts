import { z } from "zod";
import type pg from "pg";
import { query, transaction } from "./db";
import {
  HttpError,
  memberAccess,
  noteAccess,
  fileAccess,
  spaceAccess,
} from "./access";
import { notifyWorkspace } from "./documents";
import { updateBibtexEntry, parseBibtex } from "./bibliography";
import {
  annotationDataSchema,
  readingInputSchema,
  referenceDetailsSchema,
  normalizeIdentifier,
} from "./research";
import { lookupReference } from "./reference-lookup";
import { requireScope, assertGroupActive } from "./workspace-service";
const uuid = z.uuid();
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
const conflict = (current: unknown) =>
  json(
    {
      error:
        "This item changed elsewhere. Your local changes have been retained.",
      current,
    },
    409,
  );
async function attachmentAccess(user: string, id: string, pdfOnly = true) {
  const { file, space } = await fileAccess(user, uuid.parse(id));
  const note = {
    id: file.note_id as string | null,
    group_id: space.group_id ?? space.id,
    visibility: space.kind === "personal" ? "private" : "shared",
    space_id: space.id,
    role: space.role,
  };
  if (pdfOnly && file.mime !== "application/pdf")
    throw new HttpError(400, "Choose a PDF attachment.");
  return { file, note, space };
}
async function referenceAccess(user: string, id: string) {
  const [reference] = await query("SELECT * FROM bibliography WHERE id=$1", [
    uuid.parse(id),
  ]);
  if (!reference) throw new HttpError(404, "This reference is unavailable.");
  await memberAccess(user, reference.group_id);
  return reference;
}
export async function requireLibraryEditor(userId: string, groupId: string) {
  const member = await memberAccess(userId, groupId);
  if (member.content_role !== "editor")
    throw new HttpError(
      403,
      "Editor access to the group library is required to change shared references.",
    );
}
export async function libraryMutation<T>(
  userId: string,
  groupId: string,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return transaction(async (client) => {
    await assertGroupActive(client, groupId);
    const {
      rows: [member],
    } = await client.query(
      "SELECT content_role FROM members WHERE group_id=$1 AND user_id=$2",
      [groupId, userId],
    );
    if (member?.content_role !== "editor")
      throw new HttpError(
        403,
        "Editor access to the active group library is required.",
      );
    // Reference creation and removal serialize against file/workspace purges.
    await client.query(
      "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
    );
    return work(client);
  });
}
export async function libraryQuery(
  userId: string,
  groupId: string,
  sql: string,
  values: unknown[],
) {
  return libraryMutation(
    userId,
    groupId,
    async (client) => (await client.query(sql, values)).rows,
  );
}
export async function referenceLibrary(userId: string, groupId: string) {
  await memberAccess(userId, groupId);
  const rows = await query(
    `SELECT b.*,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'project_id',n.project_id,'tags',n.tags)) FROM reference_notes l JOIN notes n ON n.id=l.note_id WHERE l.reference_id=b.id AND n.group_id=b.group_id AND n.deleted_at IS NULL AND axiom_can_read_note($2,n.id)),'[]'::jsonb) AS linked_notes,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',r.name,'note_id',a.note_id)) FROM reference_attachments l JOIN attachments a ON a.id=l.attachment_id JOIN file_versions v ON v.id=a.id JOIN resources r ON r.id=v.resource_id JOIN spaces s ON s.id=r.space_id WHERE l.reference_id=b.id AND s.group_id=b.group_id AND r.deleted_at IS NULL AND axiom_space_role($2,s.id) IS NOT NULL),'[]'::jsonb) AS linked_papers
    FROM bibliography b WHERE b.group_id=$1 ORDER BY b.cite_key`,
    [groupId, userId],
  );
  return rows.map((r) => {
    let parsed;
    try {
      parsed = parseBibtex(r.bibtex)[0];
    } catch {
      /* Retain malformed imported source unchanged. */
    }
    return {
      ...r,
      doi: r.doi || parsed?.doi || "",
      arxiv: r.arxiv || parsed?.arxiv || "",
      venue: r.venue || parsed?.venue || "",
    };
  });
}
export async function researchApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [resource, id, action, childId] = path,
    method = request.method,
    url = new URL(request.url);
  if (resource === "attachments" && ["meta", "annotations"].includes(action)) {
    // Metadata also resolves image versions for the visual viewer. Paper
    // annotations and reading actions still require PDF attachments.
    const { file, note, space } = await attachmentAccess(
      userId,
      id,
      action !== "meta",
    );
    if (action === "meta" && method === "GET") {
      return json({
        id: file.id,
        note_id: file.note_id,
        resource_id: file.resource_id,
        name: file.name,
        mime: file.mime,
        bytes: Number(file.bytes),
        sha256: file.sha256,
        group_id: space.kind === "personal" ? space.id : note.group_id,
        space_id: space.id,
        visibility: note.visibility,
        role: space.can_manage ? "admin" : "member",
        content_role: space.role,
      });
    }
    if (action === "annotations" && method === "GET")
      return json(
        await query(
          'SELECT a.*,u.name AS author_name FROM paper_annotations a JOIN "user" u ON u.id=a.author_id WHERE a.attachment_id=$1 AND (a.author_id=$2 OR a.shared) ORDER BY a.created_at',
          [id, userId],
        ),
      );
    if (action === "annotations" && method === "PUT") {
      const input = z
        .object({
          id: uuid,
          version: z.number().int().nonnegative(),
          mutation_id: uuid,
          data: annotationDataSchema,
          shared: z.boolean().default(false),
          deleted: z.boolean().default(false),
        })
        .strict()
        .parse(await request.json());
      if (childId && childId !== input.id)
        throw new HttpError(400, "Annotation identity mismatch.");
      if (input.data.sha256 !== file.sha256)
        throw new HttpError(
          409,
          "The paper contents do not match this annotation.",
        );
      if (input.shared && note.visibility !== "shared")
        throw new HttpError(
          400,
          "Annotations on private papers cannot be shared.",
        );
      if (input.shared && space.role === "viewer")
        throw new HttpError(
          403,
          "Shared annotations require commenter or editor access.",
        );
      const result = await transaction(async (client) => {
        await requireScope(
          client,
          userId,
          space.id,
          input.shared ? "comment" : "read",
        );
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          input.id,
        ]);
        const {
          rows: [current],
        } = await client.query("SELECT * FROM paper_annotations WHERE id=$1", [
          input.id,
        ]);
        if (
          current &&
          (current.attachment_id !== id ||
            (!current.shared && current.author_id !== userId))
        )
          throw new HttpError(404, "Annotation unavailable.");
        if (current && current.author_id !== userId) {
          if (!input.deleted)
            throw new HttpError(403, "Only the author can edit an annotation.");
          await spaceAccess(userId, space.id, "manage");
        }
        if (current?.mutation_id === input.mutation_id)
          return { record: current };
        if ((current?.version ?? 0) !== input.version) return { current };
        if (!current) {
          const {
            rows: [record],
          } = await client.query(
            "INSERT INTO paper_annotations(id,attachment_id,author_id,data,shared,mutation_id,deleted) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [
              input.id,
              id,
              userId,
              input.data,
              input.shared,
              input.mutation_id,
              input.deleted,
            ],
          );
          return { record };
        }
        const {
          rows: [record],
        } = await client.query(
          "UPDATE paper_annotations SET data=$2,shared=$3,deleted=$4,mutation_id=$5,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [
            input.id,
            current.author_id === userId ? input.data : current.data,
            current.author_id === userId ? input.shared : current.shared,
            input.deleted,
            input.mutation_id,
          ],
        );
        return { record };
      });
      return result.record ? json(result.record) : conflict(result.current);
    }
    return json({ error: "Method not allowed." }, 405);
  }
  if (resource === "me" && id === "reading") {
    if (method === "GET") {
      const groupId = uuid.parse(url.searchParams.get("groupId"));
      return json(
        await query(
          `SELECT r.* FROM reading_items r LEFT JOIN file_versions v ON r.target_type='attachment' AND v.id=r.target_id LEFT JOIN resources target ON target.id=CASE WHEN r.target_type='note' THEN r.target_id WHEN r.target_type='attachment' THEN v.resource_id END WHERE r.user_id=$1 AND (r.group_id=$2 OR target.space_id=$2) AND ((r.target_type='group' AND r.target_id=$2 AND (EXISTS(SELECT 1 FROM members WHERE user_id=$1 AND group_id=$2) OR axiom_space_role($1,$2) IS NOT NULL)) OR (r.target_type='reference' AND EXISTS(SELECT 1 FROM bibliography b JOIN members m ON m.group_id=b.group_id AND m.user_id=$1 WHERE b.id=r.target_id)) OR (target.deleted_at IS NULL AND axiom_space_role($1,target.space_id) IS NOT NULL)) ORDER BY r.updated_at`,
          [userId, groupId],
        ),
      );
    }
    if (method === "PUT") {
      const input = readingInputSchema.parse(await request.json());
      let contexts: (string | null | undefined)[];
      if (input.target_type === "note") {
        const note = await noteAccess(userId, input.target_id);
        contexts = [note.group_id, note.space_id];
      } else if (input.target_type === "attachment") {
        const { note, file } = await attachmentAccess(userId, input.target_id);
        contexts = [note.group_id, note.space_id];
        if (file.note_id)
          contexts.push(
            (await noteAccess(userId, file.note_id, true)).group_id,
          );
      } else if (input.target_type === "reference")
        contexts = [(await referenceAccess(userId, input.target_id)).group_id];
      else {
        contexts = [input.target_id];
        if (
          !(
            await query(
              "SELECT 1 FROM members WHERE user_id=$1 AND group_id=$2",
              [userId, input.target_id],
            )
          ).length
        )
          await spaceAccess(userId, input.target_id);
      }
      if (!contexts.includes(input.group_id))
        throw new HttpError(400, "The item belongs to a different group.");
      const group = input.group_id;
      const result = await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          userId + input.kind + input.target_id,
        ]);
        const {
          rows: [current],
        } = await client.query("SELECT * FROM reading_items WHERE id=$1", [
          input.id,
        ]);
        if (
          current &&
          (current.user_id !== userId ||
            !contexts.includes(current.group_id) ||
            current.target_type !== input.target_type ||
            current.target_id !== input.target_id ||
            current.kind !== input.kind)
        )
          throw new HttpError(404, "Reading item unavailable.");
        if (current?.mutation_id === input.mutation_id)
          return { record: current };
        if ((current?.version ?? 0) !== input.version) return { current };
        if (!current && ["progress", "reading"].includes(input.kind)) {
          const {
            rows: [existing],
          } = await client.query(
            "SELECT * FROM reading_items WHERE user_id=$1 AND kind=$2 AND target_type=$3 AND target_id=$4 AND NOT deleted",
            [userId, input.kind, input.target_type, input.target_id],
          );
          if (existing) return { current: existing };
        }
        const {
          rows: [record],
        } = current
          ? await client.query(
              "UPDATE reading_items SET data=$2,deleted=$3,version=version+1,mutation_id=$4,updated_at=now() WHERE id=$1 RETURNING *",
              [input.id, input.data, input.deleted, input.mutation_id],
            )
          : await client.query(
              "INSERT INTO reading_items(id,user_id,group_id,kind,target_type,target_id,data,mutation_id,deleted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
              [
                input.id,
                userId,
                group,
                input.kind,
                input.target_type,
                input.target_id,
                input.data,
                input.mutation_id,
                input.deleted,
              ],
            );
        return { record };
      });
      return result.record ? json(result.record) : conflict(result.current);
    }
    return json({ error: "Method not allowed." }, 405);
  }
  if (resource === "references" && id === "lookup" && method === "POST") {
    const input = z
      .object({ groupId: uuid, identifier: z.string().min(1).max(500) })
      .strict()
      .parse(await request.json());
    await memberAccess(userId, input.groupId);
    let identifier: ReturnType<typeof normalizeIdentifier>;
    try {
      identifier = normalizeIdentifier(input.identifier);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(17012027)");
      if (
        identifier.provider === "arxiv" &&
        (
          await client.query(
            "SELECT 1 FROM metadata_requests WHERE requested_at>now()-interval '3 seconds' LIMIT 1",
          )
        ).rowCount
      )
        throw new HttpError(
          429,
          "Please wait three seconds before another lookup.",
        );
      const result = await client.query(
        "INSERT INTO metadata_requests(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET requested_at=now() WHERE metadata_requests.requested_at<now()-interval '3 seconds' RETURNING user_id",
        [userId],
      );
      if (!result.rowCount)
        throw new HttpError(
          429,
          "Please wait three seconds before another lookup.",
        );
    });
    // arXiv permits one active request; keep this lock through the network call.
    if (identifier.provider === "arxiv")
      return transaction(async (client) => {
        const { rows } = await client.query(
          "SELECT pg_try_advisory_xact_lock(17012028) AS acquired",
        );
        if (!rows[0]?.acquired)
          throw new HttpError(
            429,
            "An arXiv lookup is running. Please try again shortly.",
          );
        return json(await lookupReference(input.identifier));
      });
    return json(await lookupReference(input.identifier));
  }
  if (
    resource === "references" &&
    id &&
    id !== "lookup" &&
    (method === "PATCH" || action === "links")
  ) {
    const reference = await referenceAccess(userId, id);
    if (method !== "GET")
      await requireLibraryEditor(userId, reference.group_id);
    if (action === "links" && method === "GET") {
      const attachments = await query(
        "SELECT a.id,r.name,a.note_id,a.sha256,a.bytes,n.title AS note_title FROM reference_attachments l JOIN attachments a ON a.id=l.attachment_id JOIN file_versions v ON v.id=a.id JOIN resources r ON r.id=v.resource_id LEFT JOIN notes n ON n.id=a.note_id WHERE l.reference_id=$1 AND r.deleted_at IS NULL AND axiom_space_role($2,r.space_id) IS NOT NULL",
        [id, userId],
      );
      const notes = await query(
        "SELECT n.id,n.title,n.project_id,n.tags FROM reference_notes l JOIN notes n ON n.id=l.note_id WHERE l.reference_id=$1 AND n.deleted_at IS NULL AND axiom_can_read_note($2,n.id)",
        [id, userId],
      );
      return json({ attachments, notes });
    }
    if (action === "links" && (method === "POST" || method === "DELETE")) {
      const input = z
        .object({ kind: z.enum(["note", "attachment"]), targetId: uuid })
        .strict()
        .parse(await request.json());
      const note =
        input.kind === "note"
          ? await noteAccess(userId, input.targetId)
          : (await attachmentAccess(userId, input.targetId)).note;
      if (note.group_id !== reference.group_id)
        throw new HttpError(400, "Choose an item from this group.");
      const table =
          input.kind === "note" ? "reference_notes" : "reference_attachments",
        column = input.kind === "note" ? "note_id" : "attachment_id";
      await libraryMutation(userId, reference.group_id, async (client) => {
        if (method === "POST") {
          await client.query(
            `INSERT INTO ${table}(reference_id,${column}) VALUES($1,$2) ON CONFLICT DO NOTHING`,
            [id, input.targetId],
          );
          if (input.kind === "attachment" && note.id)
            await client.query(
              "INSERT INTO reference_notes(reference_id,note_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
              [id, note.id],
            );
        } else
          await client.query(
            `DELETE FROM ${table} WHERE reference_id=$1 AND ${column}=$2`,
            [id, input.targetId],
          );
      });
      await notifyWorkspace();
      return json({ ok: true });
    }
    if (method === "PATCH" && !action) {
      const input = referenceDetailsSchema
        .extend({ version: z.number().int().positive() })
        .strict()
        .parse(await request.json());
      const mapping = {
        title: "title",
        authors: "author",
        year: "year",
        url: "url",
        doi: "doi",
        arxiv: "eprint",
        venue: "journal",
      } as const;
      const changed = Object.fromEntries(
        Object.entries(mapping)
          .filter(
            ([key]) => input[key as keyof typeof mapping] !== reference[key],
          )
          .map(([key, field]) => [field, input[key as keyof typeof mapping]]),
      );
      const bibtex = updateBibtexEntry(
        reference.bibtex,
        reference.cite_key,
        reference.bibtex
          ? changed
          : {
              title: input.title,
              author: input.authors,
              year: input.year,
              url: input.url,
              doi: input.doi,
              eprint: input.arxiv,
              journal: input.venue,
            },
      );
      const [updated] = await libraryQuery(
        userId,
        reference.group_id,
        "UPDATE bibliography SET title=$2,authors=$3,year=$4,url=$5,doi=$6,arxiv=$7,venue=$8,bibtex=$9,version=version+1 WHERE id=$1 AND version=$10 RETURNING *",
        [
          id,
          input.title,
          input.authors,
          input.year,
          input.url,
          input.doi.trim().toLowerCase(),
          input.arxiv.trim(),
          input.venue,
          bibtex,
          input.version,
        ],
      );
      if (!updated)
        return conflict(
          (await query("SELECT * FROM bibliography WHERE id=$1", [id]))[0],
        );
      await notifyWorkspace();
      return json(updated);
    }
    return json({ error: "Method not allowed." }, 405);
  }
  return null;
}
