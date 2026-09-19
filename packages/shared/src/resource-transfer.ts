import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "./db";
import { HttpError, resourceAccess, spaceAccess } from "./access";
import { createNote, flushNote, indexNote, notifyWorkspace } from "./documents";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
  assertRevision,
  recordActivity,
  enqueueJob,
} from "./workspace-service";
import { reserveCapacity } from "./uploads-api";
import { rewriteLinks } from "./archive";
import { parseCanvas } from "./canvas";

const treeSql =
  "WITH RECURSIVE tree AS (SELECT id FROM resources WHERE id=$1 UNION SELECT r.id FROM resources r JOIN tree t ON r.parent_id=t.id)";
/** Copies deliberately omit comments/history. Moves retain IDs and CRDT state. */
export async function resourceTransferApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action] = path;
  if (
    endpoint !== "resources" ||
    !id ||
    !["copy", "transfer"].includes(action) ||
    request.method !== "POST"
  )
    return null;
  const input = z
    .object({
      mutationId: z.uuid().default(() => randomUUID()),
      version: z.number().int().positive(),
      destinationSpaceId: z.uuid(),
      parentId: z.uuid().nullable().default(null),
      confirmAudience: z.boolean().default(false),
    })
    .parse(await request.json());
  const moving = action === "transfer";
  const { resource: root, space: source } = await resourceAccess(
    userId,
    z.uuid().parse(id),
    moving ? "manage" : "read",
  );
  const destination = await spaceAccess(
      userId,
      input.destinationSpaceId,
      "edit",
    ),
    crossing = source.id !== destination.id;
  if (crossing && !input.confirmAudience)
    throw new HttpError(
      409,
      "Confirm the destination audience before copying or moving between spaces.",
    );
  if (moving && !crossing)
    throw new HttpError(
      400,
      "Use Move to a folder for moves within this space.",
    );
  const initial = await query<{ id: string; generation: number }>(
    `${treeSql} SELECT n.id,n.generation FROM notes n JOIN tree t ON t.id=n.id LIMIT 201`,
    [id],
  );
  if (initial.length > 200)
    throw new HttpError(413, "Transfer up to 200 notes at a time.");
  for (const note of initial) await flushNote(note);
  const result = await workspaceMutation(
    userId,
    input.mutationId,
    action + ":" + id,
    input,
    async (client) => {
      // Same ordering as note persistence/manual cleanup: references before rows.
      await client.query(
        "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
      );
      for (const spaceId of [...new Set([source.id, destination.id])].sort())
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          spaceId,
        ]);
      await requireScope(client, userId, source.id, moving ? "manage" : "read");
      await requireScope(client, userId, destination.id, "edit");
      const {
        rows: [current],
      } = await client.query("SELECT * FROM resources WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      if (!current || current.deleted_at || current.space_id !== source.id)
        throw new HttpError(
          409,
          "The source moved or was deleted. Refresh before retrying.",
        );
      assertRevision(current.version, input.version);
      const { rows: items } = await client.query(
        `${treeSql} SELECT r.*,n.body,n.generation,n.author_id,n.source_format,n.parent_id AS legacy_parent_id FROM tree t JOIN resources r ON r.id=t.id LEFT JOIN notes n ON n.id=r.note_id LIMIT 1001`,
        [id],
      );
      if (
        items.length > 1000 ||
        items.filter((item) => item.kind === "note").length > 200
      )
        throw new HttpError(
          413,
          "Choose a smaller selection (up to 1,000 items and 200 notes).",
        );
      if (items.some((item) => item.deleted_at))
        throw new HttpError(
          409,
          "This hierarchy contains trashed items. Restore them or move them out first.",
        );
      if (
        items.reduce(
          (total, item) => total + Buffer.byteLength(item.body ?? ""),
          0,
        ) > 10_000_000
      )
        throw new HttpError(
          413,
          "Choose a smaller selection (up to 10 MB of Markdown per transfer).",
        );
      const ids = items.map((item) => item.id),
        noteIds = items
          .filter((item) => item.kind === "note")
          .map((item) => item.id);
      if (input.parentId) {
        const {
          rows: [parent],
        } = await client.query("SELECT * FROM resources WHERE id=$1", [
          input.parentId,
        ]);
        if (
          !parent ||
          parent.space_id !== destination.id ||
          parent.kind === "file" ||
          parent.deleted_at ||
          ids.includes(parent.id)
        )
          throw new HttpError(
            400,
            "Choose an available folder outside the source hierarchy in the destination space.",
          );
      }
      if (
        (
          await client.query(
            "SELECT 1 FROM upload_sessions WHERE (parent_id=ANY($1::uuid[]) OR resource_id=ANY($1::uuid[])) AND status IN ('uploading','verifying','failed') LIMIT 1",
            [ids],
          )
        ).rowCount
      )
        throw new HttpError(
          409,
          "Finish or cancel transfers targeting this selection first.",
        );
      const { rows: linkedFiles } = await client.query(
        "SELECT DISTINCT rr.version_id,v.resource_id FROM resource_references rr JOIN file_versions v ON v.id=rr.version_id WHERE rr.source_id=ANY($1::uuid[]) AND ($2 OR rr.snapshot_id IS NULL)",
        [noteIds, moving],
      );
      const { rows: citations } = await client.query(
        "SELECT n.id,b.cite_key,jsonb_build_object('cite_key',b.cite_key,'title',b.title,'authors',b.authors,'year',b.year,'url',b.url,'bibtex',b.bibtex) AS data FROM notes n JOIN bibliography b ON b.group_id=n.group_id WHERE n.id=ANY($1::uuid[]) AND n.body LIKE '%@'||b.cite_key||'%' UNION SELECT note_id,cite_key,data FROM personal_citations WHERE note_id=ANY($1::uuid[])",
        [noteIds],
      );
      if (moving) {
        if (linkedFiles.some((file) => !ids.includes(file.resource_id)))
          throw new HttpError(
            409,
            "A note or saved revision uses a file outside this hierarchy. Copy instead to include linked evidence, or move the files into this folder first.",
          );
        if (
          (
            await client.query(
              "SELECT 1 FROM tasks WHERE note_id=ANY($1::uuid[]) UNION SELECT 1 FROM review_requests WHERE note_id=ANY($1::uuid[]) UNION SELECT 1 FROM task_resources WHERE resource_id=ANY($2::uuid[]) LIMIT 1",
              [noteIds, ids],
            )
          ).rowCount
        )
          throw new HttpError(
            409,
            "A task or formal review uses a note in this selection. Copy it to preserve the original project evidence.",
          );
        if (
          destination.kind === "personal" &&
          items.some(
            (item) => item.kind === "note" && item.author_id !== userId,
          )
        )
          throw new HttpError(
            409,
            "Copy other researchers’ notes into your personal space to preserve their original authorship and history.",
          );
        const {
          rows: [total],
        } = await client.query(
          "SELECT coalesce(sum(a.bytes+coalesce((SELECT sum(d.bytes) FROM file_derivatives d WHERE d.version_id=v.id),0)),0) AS bytes FROM file_versions v JOIN attachments a ON a.id=v.id WHERE v.resource_id=ANY($1::uuid[])",
          [ids],
        );
        if (source.group_id !== destination.group_id || !source.group_id)
          await reserveCapacity(
            client,
            destination.id,
            Number(total.bytes),
            false,
          );
        await client.query(
          "SELECT set_config('axiom.resource_write','1',true)",
        );
        await client.query(
          "UPDATE resources SET parent_id=NULL WHERE id=ANY($1::uuid[])",
          [ids],
        );
        await client.query(
          "UPDATE notes SET parent_id=NULL WHERE id=ANY($1::uuid[])",
          [noteIds],
        );
        await client.query(
          "UPDATE notes SET group_id=$2,project_id=$3,visibility=$4,version=version+1 WHERE id=ANY($1::uuid[])",
          [
            noteIds,
            destination.group_id,
            destination.project_id,
            destination.kind === "personal" ? "private" : "shared",
          ],
        );
        await client.query(
          "UPDATE resources SET space_id=$2,owner_id=CASE WHEN $3 THEN $4 ELSE owner_id END,version=version+1,updated_at=now() WHERE id=ANY($1::uuid[])",
          [ids, destination.id, destination.kind === "personal", userId],
        );
        for (const item of items)
          await client.query("UPDATE resources SET parent_id=$2 WHERE id=$1", [
            item.id,
            item.id === id ? input.parentId : item.parent_id,
          ]);
        for (const item of items.filter((item) => item.kind === "note"))
          await indexNote(item.id + ":" + item.generation, item.body, client);
        for (const citation of citations)
          await client.query(
            "INSERT INTO personal_citations(note_id,cite_key,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [citation.id, citation.cite_key, JSON.stringify(citation.data)],
          );
        // Legacy attachment provenance must not keep a file owned by its old note.
        await client.query(
          "UPDATE attachments SET note_id=NULL WHERE id IN (SELECT id FROM file_versions WHERE resource_id=ANY($1::uuid[])) AND note_id IS NOT NULL",
          [ids],
        );
        await recordActivity(client, {
          spaceId: source.id,
          userId,
          kind: "moved-out",
          title: `Moved ${root.name} to another space`,
        });
        await recordActivity(client, {
          spaceId: destination.id,
          userId,
          kind: "moved-in",
          title: `Moved ${root.name} into this space`,
          resourceId: id,
        });
        return (await client.query("SELECT * FROM resources WHERE id=$1", [id]))
          .rows[0];
      }
      const fileIds = [
        ...new Set([
          ...items
            .filter((item) => item.kind === "file")
            .map((item) => item.current_version_id),
          ...linkedFiles.map((file) => file.version_id),
        ]),
      ].filter(Boolean);
      const { rows: files } = await client.query(
        "SELECT a.*,v.resource_id,axiom_space_role($2,r.space_id) AS role FROM attachments a JOIN file_versions v ON v.id=a.id JOIN resources r ON r.id=v.resource_id WHERE a.id=ANY($1::uuid[]) ORDER BY v.resource_id,v.ordinal",
        [fileIds, userId],
      );
      if (files.some((file) => !file.role) || files.length !== fileIds.length)
        throw new HttpError(
          403,
          "A linked file is unavailable. Resolve inaccessible file links before copying this selection.",
        );
      if (files.length > 1000)
        throw new HttpError(
          413,
          "This selection has too many linked file versions. Choose a smaller folder.",
        );
      const { rows: derivatives } = await client.query(
        "SELECT * FROM file_derivatives WHERE version_id=ANY($1::uuid[])",
        [fileIds],
      );
      await reserveCapacity(
        client,
        destination.id,
        files.reduce((total, file) => total + Number(file.bytes), 0) +
          derivatives.reduce((total, d) => total + Number(d.bytes), 0),
        false,
      );
      const idMap = new Map<string, string>(
        ids.map((oldId) => [oldId, randomUUID()]),
      );
      for (const file of files)
        if (!idMap.has(file.resource_id))
          idMap.set(file.resource_id, randomUUID());
      const versionMap = new Map<string, string>(
        files.map((file) => [file.id, randomUUID()]),
      );
      const rootId = idMap.get(id)!;
      // Create folders and file resources before notes so reference triggers can
      // resolve their immutable version IDs while note bodies are inserted.
      for (const item of items.filter((item) => item.kind !== "note"))
        await client.query(
          "INSERT INTO resources(id,space_id,kind,name,description,owner_id,tags) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            idMap.get(item.id),
            destination.id,
            item.kind,
            item.name,
            item.description,
            userId,
            item.tags,
          ],
        );
      for (const file of files)
        if (
          !ids.includes(file.resource_id) &&
          !files.some(
            (previous) =>
              previous.resource_id === file.resource_id &&
              files.indexOf(previous) < files.indexOf(file),
          )
        )
          await client.query(
            "INSERT INTO resources(id,space_id,kind,name,owner_id) VALUES($1,$2,'file',$3,$4)",
            [idMap.get(file.resource_id), destination.id, file.name, userId],
          );
      const ordinals = new Map<string, number>();
      for (const file of files) {
        const versionId = versionMap.get(file.id)!,
          resourceId = idMap.get(file.resource_id)!,
          ordinal = (ordinals.get(resourceId) ?? 0) + 1;
        ordinals.set(resourceId, ordinal);
        await client.query(
          "INSERT INTO attachments(id,name,mime,bytes,storage_key,sha256) VALUES($1,$2,$3,$4,$5,$6)",
          [
            versionId,
            file.name,
            file.mime,
            file.bytes,
            file.storage_key,
            file.sha256,
          ],
        );
        await client.query(
          "INSERT INTO file_versions(id,resource_id,ordinal,created_by) VALUES($1,$2,$3,$4)",
          [versionId, resourceId, ordinal, userId],
        );
        for (const derivative of derivatives.filter(
          (d) => d.version_id === file.id,
        ))
          await client.query(
            "INSERT INTO file_derivatives(version_id,kind,storage_key,mime,bytes) VALUES($1,$2,$3,$4,$5)",
            [
              versionId,
              derivative.kind,
              derivative.storage_key,
              derivative.mime,
              derivative.bytes,
            ],
          );
        const original = items.find((item) => item.id === file.resource_id);
        if (!original || original.current_version_id === file.id)
          await client.query(
            "UPDATE resources SET current_version_id=$2 WHERE id=$1",
            [resourceId, versionId],
          );
        if (file.mime.startsWith("image/"))
          await enqueueJob(
            "thumbnail",
            "thumbnail:" + versionId,
            { versionId },
            client,
          );
      }
      for (const item of items.filter((item) => item.kind === "note")) {
        const body =
          item.source_format === "canvas"
            ? JSON.stringify(
                {
                  ...parseCanvas(item.body),
                  nodes: parseCanvas(item.body).nodes.map((node) => {
                    if (node.type !== "file") return node;
                    const resourceId =
                        node.resourceId && idMap.get(node.resourceId),
                      versionId =
                        node.versionId && versionMap.get(node.versionId);
                    // Copied references point to copied resources. Do not leak an
                    // original private resource identifier into a new audience.
                    return {
                      ...node,
                      ...(resourceId
                        ? { resourceId }
                        : crossing
                          ? { resourceId: undefined }
                          : {}),
                      ...(versionId
                        ? { versionId }
                        : crossing
                          ? { versionId: undefined }
                          : {}),
                    };
                  }),
                },
                null,
                2,
              )
            : item.source_format && item.source_format !== "markdown"
              ? item.body
              : rewriteLinks(item.body, (node) => {
                  const href = node.href ?? "",
                    version = /^\/api\/v1\/attachments\/([\da-f-]{36})/i.exec(
                      href,
                    )?.[1];
                  if (version && versionMap.has(version))
                    return href.replace(version, versionMap.get(version)!);
                  const [target, fragment] = href.split("#");
                  const matches = items.filter(
                    (note) =>
                      note.kind === "note" &&
                      (note.id === target ||
                        note.name.toLowerCase() === target.toLowerCase()),
                  );
                  if (matches.length === 1)
                    return {
                      noteId: idMap.get(matches[0].id)!,
                      fragment: fragment ? "#" + fragment : "",
                    };
                });
        const note = await createNote(
          {
            id: idMap.get(item.id),
            groupId: destination.group_id,
            projectId: destination.project_id,
            userId,
            title:
              item.id === id && !crossing
                ? item.name.slice(0, 193) + " (copy)"
                : item.name,
            visibility: destination.kind === "personal" ? "private" : "shared",
            body,
            sourceFormat: item.source_format,
            tags: item.tags,
          },
          client,
        );
        await client.query("UPDATE resources SET description=$2 WHERE id=$1", [
          note.id,
          item.description,
        ]);
        for (const citation of citations.filter((c) => c.id === item.id))
          await client.query(
            "INSERT INTO personal_citations(note_id,cite_key,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [note.id, citation.cite_key, JSON.stringify(citation.data)],
          );
      }
      // Tool configuration belongs to the copied resource, not to its original
      // author. Never clone an edit lease, discussion, checkpoint or AI job.
      for (const [originalId, copiedId] of idMap)
        await client.query(
          "INSERT INTO tool_projects(resource_id,kind,settings) SELECT $2,kind,settings FROM tool_projects WHERE resource_id=$1",
          [originalId, copiedId],
        );
      for (const item of items)
        await client.query("UPDATE resources SET parent_id=$2 WHERE id=$1", [
          idMap.get(item.id),
          item.id === id ? input.parentId : idMap.get(item.parent_id),
        ]);
      for (const item of items.filter(
        (r) => r.kind === "shortcut" && r.shortcut_target_id,
      )) {
        const targetId =
          idMap.get(item.shortcut_target_id) ??
          (!crossing ? item.shortcut_target_id : null);
        if (targetId)
          await client.query(
            "UPDATE resources SET shortcut_target_id=$2 WHERE id=$1",
            [idMap.get(item.id), targetId],
          );
      }
      for (const originalId of idMap.keys())
        if (!ids.includes(originalId))
          await client.query("UPDATE resources SET parent_id=$2 WHERE id=$1", [
            idMap.get(originalId),
            root.kind === "file" ? input.parentId : rootId,
          ]);
      for (const item of items.filter((item) => item.kind === "note")) {
        const {
          rows: [note],
        } = await client.query("SELECT body FROM notes WHERE id=$1", [
          idMap.get(item.id),
        ]);
        await indexNote(idMap.get(item.id) + ":1", note.body, client);
      }
      await recordActivity(client, {
        spaceId: destination.id,
        userId,
        kind: "copied",
        title: `Copied ${root.name} with linked evidence`,
        resourceId: rootId,
      });
      return (
        await client.query("SELECT * FROM resources WHERE id=$1", [rootId])
      ).rows[0];
    },
  );
  await notifyWorkspace(moving);
  return json(result, moving ? 200 : 201);
}
