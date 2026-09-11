import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { posix } from "node:path";
import { ZipFile } from "yazl";
import { z } from "zod";
import { pool, query, transaction } from "./db";
import { HttpError, spaceAccess } from "./access";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
  enqueueJob,
} from "./workspace-service";
import {
  attachmentStream,
  availableStorageBytes,
  fileResponse,
  putGeneratedStream,
} from "./storage-streams";
import { flushNote } from "./documents";
import { rewriteLinks } from "./archive";
import { documentExtension } from "./document-format";
import { canvasSchema, parseCanvas } from "./canvas";
import { buildCanvasBundle } from "./canvas-bundle";

const uuid = z.uuid();
const safeName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 100) || "Untitled";
async function authorizeExport(userId: string, record: any) {
  await spaceAccess(userId, record.space_id);
  const [denied] = await query(
    "SELECT EXISTS(SELECT 1 FROM unnest($2::uuid[]) AS wanted(id) LEFT JOIN resources r ON r.id=wanted.id WHERE r.id IS NULL OR r.deleted_at IS NOT NULL OR axiom_space_role($1,r.space_id) IS NULL) AS denied",
    [userId, record.resource_ids],
  );
  if (denied.denied)
    throw new HttpError(
      403,
      "Some exported items are no longer accessible. Create a new export of the items you can access.",
    );
}
export async function workspaceExportsApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action] = path;
  if (endpoint !== "exports") return null;
  if (!id && request.method === "GET")
    return json(
      await query(
        "SELECT id,space_id,status,bytes,error,created_at,cardinality(resource_ids) AS items FROM workspace_exports WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
        [userId],
      ),
    );
  if (!id && request.method === "POST") {
    const input = z
      .object({
        mutationId: uuid.default(() => randomUUID()),
        spaceId: uuid,
        resourceIds: z.array(uuid).min(1).max(1000),
        canvasSnapshot: canvasSchema.optional(),
      })
      .parse(await request.json());
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "export",
      input,
      async (client) => {
        await requireScope(client, userId, input.spaceId);
        await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
          userId,
        ]);
        if (
          (
            await client.query(
              "SELECT 1 FROM workspace_exports WHERE user_id=$1 AND status IN ('queued','running') LIMIT 2",
              [userId],
            )
          ).rowCount! >= 2
        )
          throw new HttpError(
            429,
            "Wait for your running exports to finish before starting another.",
          );
        const { rows: roots } = await client.query(
          "SELECT id FROM resources WHERE id=ANY($1::uuid[]) AND space_id=$2 AND deleted_at IS NULL",
          [input.resourceIds, input.spaceId],
        );
        if (roots.length !== new Set(input.resourceIds).size)
          throw new HttpError(404, "Choose available items from one space.");
        if (input.canvasSnapshot) {
          parseCanvas(JSON.stringify(input.canvasSnapshot));
          if (
            input.resourceIds.length !== 1 ||
            !(
              await client.query(
                "SELECT 1 FROM notes WHERE id=$1 AND source_format='canvas'",
                [input.resourceIds[0]],
              )
            ).rowCount
          )
            throw new HttpError(
              400,
              "A portable canvas bundle must start from one canvas project.",
            );
        }
        const { rows: resources } = await client.query(
          "WITH RECURSIVE tree AS (SELECT id FROM resources WHERE id=ANY($1::uuid[]) UNION SELECT r.id FROM resources r JOIN tree t ON r.parent_id=t.id WHERE r.deleted_at IS NULL) SELECT id FROM tree LIMIT 1001",
          [input.resourceIds],
        );
        if (resources.length > 1000)
          throw new HttpError(
            413,
            "Export up to 1,000 items at a time. Choose a smaller folder or selection.",
          );
        const {
          rows: [row],
        } = await client.query(
          "INSERT INTO workspace_exports(user_id,space_id,resource_ids,options) VALUES($1,$2,$3,$4) RETURNING id,status",
          [
            userId,
            input.spaceId,
            input.canvasSnapshot
              ? input.resourceIds
              : resources.map((r) => r.id),
            JSON.stringify(
              input.canvasSnapshot
                ? { canvasSnapshot: input.canvasSnapshot }
                : {},
            ),
          ],
        );
        await enqueueJob("export", "export:" + row.id, { id: row.id }, client);
        return row;
      },
    );
    return json(result, 202);
  }
  if (id) {
    const [record] = await query(
      "SELECT * FROM workspace_exports WHERE id=$1 AND user_id=$2",
      [uuid.parse(id), userId],
    );
    if (!record) throw new HttpError(404, "Export unavailable.");
    if (action === "download" && ["GET", "HEAD"].includes(request.method)) {
      await authorizeExport(userId, record);
      if (record.status !== "ready")
        throw new HttpError(409, "The export is not ready yet.");
      return fileResponse(
        request,
        {
          storage_key: record.storage_key,
          bytes: Number(record.bytes),
          sha256: record.sha256,
          mime: "application/zip",
          name: `axiom-workspace-${record.id.slice(0, 8)}.zip`,
        },
        true,
      );
    }
    if (action === "remove" && request.method === "POST") {
      await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "export:" + id,
        ]);
        const {
          rows: [current],
        } = await client.query(
          "SELECT * FROM workspace_exports WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [id, userId],
        );
        if (!current) return;
        if (["queued", "running"].includes(current.status))
          throw new HttpError(
            409,
            "Wait for this export to finish before removing it.",
          );
        await client.query("DELETE FROM workspace_exports WHERE id=$1", [id]);
        if (current.storage_key)
          await enqueueJob(
            "delete-blob",
            "export-delete:" + id,
            { key: current.storage_key },
            client,
          );
      });
      return json({ ok: true });
    }
  }
  return null;
}

export async function buildWorkspaceExport(id: string) {
  const client = await pool.connect();
  let key: string | null = null;
  try {
    // Session locks prevent a delayed old lease and a retry from building twice.
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [
      "export:" + id,
    ]);
    const {
      rows: [record],
    } = await client.query("SELECT * FROM workspace_exports WHERE id=$1", [id]);
    if (!record || record.status === "ready") return;
    await authorizeExport(record.user_id, record);
    await client.query(
      "UPDATE workspace_exports SET status='running',error=NULL WHERE id=$1",
      [id],
    );
    const notesToFlush = await query<{ id: string; generation: number }>(
      "SELECT id,generation FROM notes WHERE id=ANY($1::uuid[])",
      [record.resource_ids],
    );
    for (const note of notesToFlush) await flushNote(note);
    await client.query(
      "SELECT pg_advisory_lock_shared(hashtext('axiom:blob-backup'))",
    );
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (record.options?.canvasSnapshot) {
      const bundle = await buildCanvasBundle(client, record);
      key = randomUUID();
      const stored = await putGeneratedStream(
        key,
        bundle.output,
        "application/zip",
      );
      await client.query("COMMIT");
      await authorizeExport(record.user_id, {
        ...record,
        resource_ids: bundle.requiredIds,
      });
      await client.query(
        "UPDATE workspace_exports SET status='ready',resource_ids=$2,storage_key=$3,bytes=$4,sha256=$5,error=NULL WHERE id=$1",
        [id, bundle.requiredIds, key, stored.bytes, stored.sha256],
      );
      key = null;
      return;
    }
    const {
      rows: [size],
    } = await client.query(
      "SELECT coalesce(sum(octet_length(body)),0) AS bytes FROM notes WHERE id=ANY($1::uuid[])",
      [record.resource_ids],
    );
    if (Number(size.bytes) > 25_000_000)
      throw new Error(
        "This selection contains more than 25 MB of Markdown. Export smaller note selections.",
      );
    const { rows: resources } = await client.query(
      "SELECT r.*,n.body,n.generation,n.source_format FROM resources r LEFT JOIN notes n ON n.id=r.note_id WHERE r.id=ANY($1::uuid[]) AND r.deleted_at IS NULL AND axiom_space_role($2,r.space_id) IS NOT NULL",
      [record.resource_ids, record.user_id],
    );
    if (resources.length !== record.resource_ids.length)
      throw new Error(
        "The selection changed or its access was revoked. Start a new export.",
      );
    // Include exact file versions referenced by current exported notes. No
    // private dependency is pulled into a shared archive without read access.
    const { rows: files } = await client.query(
      "SELECT DISTINCT a.*,v.resource_id FROM attachments a JOIN file_versions v ON v.id=a.id JOIN resources r ON r.id=v.resource_id WHERE axiom_space_role($2,r.space_id) IS NOT NULL AND (r.id=ANY($1::uuid[]) AND r.current_version_id=a.id OR a.id IN (SELECT version_id FROM resource_references WHERE source_id=ANY($1::uuid[]) AND snapshot_id IS NULL))",
      [record.resource_ids, record.user_id],
    );
    const requiredIds = [
      ...new Set([...record.resource_ids, ...files.map((f) => f.resource_id)]),
    ];
    const estimate = files.reduce(
      (total, file) => total + Number(file.bytes),
      Number(size.bytes),
    );
    if (estimate > 100_000_000_000)
      throw new Error(
        "Export up to 100 GB per archive. Choose a smaller selection.",
      );
    const free = await availableStorageBytes();
    if (free !== null && free < estimate + 256 * 1024 * 1024)
      throw new Error("Not enough disk space to safely prepare this archive.");
    const byId = new Map(resources.map((r) => [r.id, r]));
    const paths = new Map<string, string>();
    const resourcePath = (item: any, depth = 0): string => {
      if (depth > 100)
        throw new Error("Folder hierarchy is too deep to export.");
      if (paths.has(item.id)) return paths.get(item.id)!;
      const parent = byId.get(item.parent_id);
      // A note can own nested resources; its directory is distinct from .md.
      const prefix = parent
        ? resourcePath(parent, depth + 1).replace(
            /\.(md|canvas|tex|txt)$/,
            "",
          ) + "/"
        : "";
      const value =
        prefix +
        safeName(item.name) +
        "--" +
        item.id.slice(0, 8) +
        (item.kind === "note"
          ? "." + documentExtension(item.source_format)
          : "");
      paths.set(item.id, value);
      return value;
    };
    for (const item of resources) resourcePath(item);
    const filePaths = new Map(
      files.map((file) => [
        file.id,
        "_files/" + file.id + "/" + safeName(file.name),
      ]),
    );
    const { rows: citations } = await client.query(
      "SELECT n.id,c.cite_key,c.data->>'bibtex' AS bibtex FROM personal_citations c JOIN notes n ON n.id=c.note_id WHERE n.id=ANY($1::uuid[]) UNION SELECT n.id,b.cite_key,b.bibtex FROM notes n JOIN bibliography b ON b.group_id=n.group_id WHERE n.id=ANY($1::uuid[]) AND n.body LIKE '%@'||b.cite_key||'%'",
      [record.resource_ids],
    );
    const zip = new ZipFile();
    const output = zip.outputStream as Readable;
    zip.on("error", (error) => output.destroy(error));
    for (const item of resources) {
      const name = paths.get(item.id)!;
      if (item.kind === "folder") zip.addEmptyDirectory(name);
      if (item.kind === "note") {
        const body =
          item.source_format === "canvas"
            ? JSON.stringify(
                {
                  ...parseCanvas(item.body),
                  nodes: parseCanvas(item.body).nodes.map((node) =>
                    node.type === "file"
                      ? {
                          ...node,
                          file:
                            node.versionId && filePaths.has(node.versionId)
                              ? posix.relative(
                                  posix.dirname(name),
                                  filePaths.get(node.versionId)!,
                                )
                              : node.resourceId && paths.has(node.resourceId)
                                ? posix.relative(
                                    posix.dirname(name),
                                    paths.get(node.resourceId)!,
                                  )
                                : node.file,
                        }
                      : node,
                  ),
                },
                null,
                2,
              )
            : item.source_format && item.source_format !== "markdown"
              ? item.body
              : rewriteLinks(item.body, (node) => {
                  const href = node.href ?? "";
                  const fileId = /\/api\/v1\/attachments\/([\da-f-]{36})/i.exec(
                    href,
                  )?.[1];
                  if (fileId && filePaths.has(fileId))
                    return (
                      posix.relative(
                        posix.dirname(name),
                        filePaths.get(fileId)!,
                      ) + (href.includes("#") ? "#" + href.split("#")[1] : "")
                    );
                  const target = href.split("#")[0];
                  const matches = resources.filter(
                    (r) =>
                      r.kind === "note" &&
                      (r.id === target ||
                        r.name.toLowerCase() === target.toLowerCase()),
                  );
                  if (matches.length === 1)
                    return (
                      posix.relative(
                        posix.dirname(name),
                        paths.get(matches[0].id)!,
                      ) + (href.includes("#") ? "#" + href.split("#")[1] : "")
                    );
                });
        zip.addBuffer(Buffer.from(body), name);
        const refs = citations
          .filter((ref) => ref.id === item.id)
          .map((ref) => ref.bibtex)
          .filter(Boolean);
        if (refs.length)
          zip.addBuffer(
            Buffer.from([...new Set(refs)].join("\n\n")),
            name.replace(/\.md$/, ".bib"),
          );
      }
    }
    for (const file of files)
      zip.addReadStreamLazy(
        filePaths.get(file.id)!,
        { size: Number(file.bytes), compress: false },
        (callback) => {
          void attachmentStream(file.storage_key).then(
            (stream) => callback(null, stream),
            (error) => callback(error, Readable.from([])),
          );
        },
      );
    zip.addBuffer(
      Buffer.from(
        JSON.stringify(
          {
            format: "axiom-workspace-export",
            version: 1,
            createdAt: new Date().toISOString(),
            scope:
              "Selected current notes and exact linked file versions; not an account backup",
            resources: resources.map((r) => ({
              id: r.id,
              parentId: r.parent_id,
              kind: r.kind,
              name: r.name,
              path:
                r.kind === "file"
                  ? filePaths.get(r.current_version_id)
                  : paths.get(r.id),
              description: r.description,
              tags: r.tags,
              generation: r.generation,
              currentVersionId: r.current_version_id,
              shortcutTargetId:
                r.kind === "shortcut" ? r.shortcut_target_id : undefined,
            })),
            files: files.map((f) => ({
              id: f.id,
              resourceId: f.resource_id,
              path: filePaths.get(f.id),
              name: f.name,
              bytes: Number(f.bytes),
              sha256: f.sha256,
            })),
          },
          null,
          2,
        ),
      ),
      "workspace-manifest.json",
    );
    zip.end({
      forceZip64Format: true,
      comment: "Axiom portable research export",
    });
    key = randomUUID();
    const stored = await putGeneratedStream(key, output, "application/zip");
    await client.query("COMMIT");
    await authorizeExport(record.user_id, {
      ...record,
      resource_ids: requiredIds,
    });
    await client.query(
      "UPDATE workspace_exports SET status='ready',resource_ids=$2,storage_key=$3,bytes=$4,sha256=$5,error=NULL WHERE id=$1",
      [id, requiredIds, key, stored.bytes, stored.sha256],
    );
    key = null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await client.query(
      "UPDATE workspace_exports SET status='failed',error=$2 WHERE id=$1",
      [
        id,
        (error instanceof Error ? error.message : "Export failed.").slice(
          0,
          500,
        ),
      ],
    );
    if (key) await enqueueJob("delete-blob", "failed-export:" + key, { key });
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock_all()");
    client.release();
  }
}
