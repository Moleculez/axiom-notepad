import { posix } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { Readable } from "node:stream";
import JSZip from "jszip";
import { z } from "zod";
import * as Y from "yjs";
import {
  parseMarkdown,
  plainText,
  type MarkdownNode,
  type TextChange,
} from "@axiom/markdown";
import { parseBibtex, type ReferenceInput } from "./bibliography";
import { requireScope } from "./workspace-service";
import { transaction } from "./db";
import { HttpError, type Note } from "./access";
import { putAttachment, removeAttachment, attachmentMime } from "./storage";

const noteMeta = z.object({
  id: z.string().max(100),
  file: z.string().max(1000),
  title: z.string().trim().min(1).max(200),
  parentId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).default([]),
});
const manifestSchema = z.object({
  format: z.literal("axiom-notebook"),
  version: z.literal(1),
  notes: z.array(noteMeta).max(1000),
  projects: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(200),
        description: z.string().max(2000).default(""),
        color: z.enum(["blue", "green", "purple", "orange"]).default("blue"),
      }),
    )
    .default([]),
  attachments: z
    .array(
      z.object({
        file: z.string(),
        noteId: z.string(),
        name: z.string().max(200),
        sha256: z.string().optional(),
      }),
    )
    .default([]),
});
export type ImportNote = z.infer<typeof noteMeta> & {
  body: string;
  newId: string;
};
export type ImportPlan = {
  notes: ImportNote[];
  references: ReferenceInput[];
  attachments: {
    file: string;
    name: string;
    noteId: string;
    newId: string;
    data: Uint8Array;
    mime: string;
    hash: string;
  }[];
  projects: z.infer<typeof manifestSchema>["projects"];
  warnings: string[];
};
const bad = (message: string): never => {
  throw new HttpError(400, message);
};
function safePath(value: string) {
  if (
    !value ||
    value.startsWith("/") ||
    /[\\\x00-\x1f]/.test(value) ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").includes("..")
  )
    bad("Unsafe archive path.");
  return value;
}
export function localTarget(file: string, target: string) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target)) return null;
  const [path, fragment] = target.split("#");
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  const resolved = posix.normalize(posix.join(posix.dirname(file), decoded));
  if (
    resolved.startsWith("../") ||
    resolved.startsWith("/") ||
    resolved.includes("\\")
  )
    return null;
  return { path: resolved, fragment: fragment ? "#" + fragment : "" };
}

// Transform only parsed link nodes; literal examples and fenced code are untouched.
export function rewriteLinks(
  source: string,
  resolve: (
    node: MarkdownNode,
  ) => string | { noteId: string; fragment: string } | undefined,
  citations?: Map<string, string>,
) {
  const changes: TextChange[] = [],
    parsed = parseMarkdown(source);
  const visit = (n: MarkdownNode) => {
    if (["wikiLink", "link", "image"].includes(n.type)) {
      const href = resolve(n);
      if (href !== undefined) {
        const label =
          n.type === "wikiLink"
            ? (n.text ?? "").replace(/([\[\]\\])/g, "\\$1")
            : source.slice(n.contentFrom, n.contentTo);
        changes.push({
          from: n.from,
          to: n.to,
          insert:
            typeof href === "string"
              ? `${n.type === "image" ? "!" : ""}[${label}](<${href.replace(/>/g, "%3E")}>)`
              : `[[${href.noteId}${href.fragment}|${plainText(n).replace(/[\[\]|]/g, "")}]]`,
        });
        return;
      }
    }
    if (n.type === "citation" && citations)
      changes.push({
        from: n.from,
        to: n.to,
        insert:
          "[" +
          n
            .key!.split(";")
            .map((key) => "@" + (citations.get(key) ?? key))
            .join("; ") +
          "]",
      });
    n.children?.forEach(visit);
  };
  visit(parsed.ast);
  Object.values(parsed.footnotes).forEach((nodes) => nodes.forEach(visit));
  for (const change of changes.sort((a, b) => b.from - a.from))
    source =
      source.slice(0, change.from) + change.insert + source.slice(change.to);
  return source;
}

export async function readArchive(
  name: string,
  bytes: Uint8Array,
): Promise<ImportPlan> {
  if (bytes.length > 50 * 1048576)
    bad("Choose a Markdown file or ZIP smaller than 50 MB.");
  const plan: ImportPlan = {
    notes: [],
    attachments: [],
    references: [],
    projects: [],
    warnings: [],
  };
  const files = new Map<string, Uint8Array>();
  if (/\.md$/i.test(name)) files.set(safePath(posix.basename(name)), bytes);
  else if (/\.zip$/i.test(name)) {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      return bad("The ZIP archive could not be read.");
    }
    const entries = Object.values(zip.files);
    if (entries.length > 1000) bad("Archive contains more than 1,000 files.");
    let total = 0;
    for (const entry of entries) {
      safePath(
        (entry as JSZip.JSZipObject & { unsafeOriginalName?: string })
          .unsafeOriginalName ?? entry.name,
      );
      if (entry.dir) continue;
      const limit = /\.md$/i.test(entry.name)
        ? 4 * 1000000
        : entry.name === "manifest.json"
          ? 2 * 1048576
          : 50 * 1048576;
      const stream = entry.nodeStream() as Readable,
        chunks: Buffer[] = [];
      let size = 0;
      try {
        await new Promise<void>((resolve, reject) => {
          stream.on("data", (chunk: Buffer) => {
            size += chunk.length;
            total += chunk.length;
            if (size > limit || total > 100 * 1048576) {
              stream.pause();
              stream.destroy();
              reject(
                new HttpError(
                  400,
                  "Expanded archive exceeds import limits (100 MB total).",
                ),
              );
            } else chunks.push(chunk);
          });
          stream.on("end", resolve);
          stream.on("error", reject);
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        return bad("A compressed archive entry could not be read.");
      }
      files.set(entry.name, Buffer.concat(chunks));
    }
  } else bad("Supported formats are .md and .zip.");
  const decode = (data: Uint8Array) => {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      return bad("Markdown and metadata must use UTF-8 encoding.");
    }
  };
  let manifest: z.infer<typeof manifestSchema> | undefined;
  if (files.has("manifest.json")) {
    try {
      manifest = manifestSchema.parse(
        JSON.parse(decode(files.get("manifest.json")!)),
      );
    } catch {
      bad("The Axiom manifest is invalid or uses an unsupported version.");
    }
  }
  const seen = new Set<string>();
  for (const [file, data] of files) {
    if (!/\.md$/i.test(file)) continue;
    const body = decode(data);
    if (body.length > 1000000) bad("A note exceeds one million characters.");
    const meta = manifest?.notes.find((n) => n.file === file) ?? {
      id: file,
      file,
      title:
        posix.basename(file).replace(/\.md$/i, "").slice(0, 200) || "Untitled",
      tags: [],
    };
    if (seen.has(meta.id))
      bad("The archive contains duplicate note identifiers.");
    seen.add(meta.id);
    plan.notes.push({ ...meta, body, newId: randomUUID() });
  }
  if (!plan.notes.length) bad("No Markdown notes found.");
  if (
    manifest &&
    manifest.notes.some(
      (n) => !plan.notes.some((p) => p.id === n.id && p.file === n.file),
    )
  )
    bad("A note listed in the manifest is missing.");
  plan.projects = manifest?.projects ?? [];
  for (const note of plan.notes) {
    const parents = new Set([note.id]);
    let parentId = note.parentId;
    while (parentId) {
      const parent = plan.notes.find((n) => n.id === parentId);
      if (!parent || parents.has(parentId))
        bad("Invalid or cyclic note hierarchy.");
      if ((parent!.projectId ?? null) !== (note.projectId ?? null))
        bad("Nested notes must share their parent project.");
      parents.add(parentId);
      parentId = parent!.parentId;
    }
    if (note.projectId && !plan.projects.some((p) => p.id === note.projectId))
      bad("A note refers to a missing project.");
  }
  for (const [file, data] of files)
    if (/\.bib$/i.test(file)) {
      try {
        plan.references.push(...parseBibtex(decode(data)));
      } catch {
        bad("An imported BibTeX file is malformed.");
      }
    }
  if (
    plan.references.some((r) => !/^[\w:./-]{1,100}$/.test(r.citeKey)) ||
    new Set(plan.references.map((r) => r.citeKey)).size !==
      plan.references.length
  )
    bad(
      "Bibliography keys must be unique and use letters, numbers, or : . / - _.",
    );
  const owners = new Map<
    string,
    { noteId: string; name: string; hash?: string }
  >();
  for (const item of manifest?.attachments ?? []) {
    safePath(item.file);
    if (!files.has(item.file) || !seen.has(item.noteId))
      bad("An attachment or its owning note is missing.");
    owners.set(item.file, {
      noteId: item.noteId,
      name: item.name,
      hash: item.sha256,
    });
  }
  for (const note of plan.notes)
    rewriteLinks(note.body, (n) => {
      const target = localTarget(note.file, n.href ?? "");
      if (!target) return;
      if (
        files.has(target.path) &&
        !/\.(md|bib)$/i.test(target.path) &&
        target.path !== "manifest.json"
      ) {
        if (!owners.has(target.path))
          owners.set(target.path, {
            noteId: note.id,
            name: posix.basename(target.path),
          });
      } else if (!files.has(target.path) && n.type !== "wikiLink")
        plan.warnings.push(`Unresolved local link in ${note.title}: ${n.href}`);
      return undefined;
    });
  for (const [file, owner] of owners) {
    const data = files.get(file)!,
      hash = createHash("sha256").update(data).digest("hex");
    if (owner.hash && owner.hash !== hash)
      bad("Attachment checksum mismatch: " + owner.name);
    plan.attachments.push({
      file,
      name: owner.name.replace(/[\r\n/\\]/g, "_"),
      noteId: owner.noteId,
      newId: randomUUID(),
      data,
      mime: attachmentMime(data),
      hash,
    });
  }
  return plan;
}

export async function importArchive(
  plan: ImportPlan,
  groupId: string,
  userId: string,
) {
  const storageKeys = new Map<string, string>(),
    projectIds = new Map(plan.projects.map((p) => [p.id, randomUUID()]));
  try {
    for (const file of plan.attachments) {
      const key = randomUUID();
      await putAttachment(key, file.data, file.mime);
      storageKeys.set(file.newId, key);
    }
    return await transaction(async (client) => {
      const {
        rows: [scope],
      } = await client.query(
        "SELECT id FROM spaces WHERE group_id=$1 AND kind='team'",
        [groupId],
      );
      if (!scope) throw new Error("The destination workspace is unavailable.");
      await requireScope(client, userId, scope.id, "edit");
      // Serializes simultaneous imports so citation conflict decisions are stable.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        groupId,
      ]);
      const existing = (
        await client.query("SELECT * FROM bibliography WHERE group_id=$1", [
          groupId,
        ])
      ).rows;
      const citationKeys = new Map<string, string>();
      for (const ref of plan.references) {
        const match = existing.find((r) => r.cite_key === ref.citeKey);
        if (
          match &&
          match.title === ref.title &&
          match.authors === ref.authors &&
          match.year === ref.year &&
          match.url === ref.url
        )
          continue;
        const key = match
          ? ref.citeKey.slice(0, 80) + "-import-" + randomUUID().slice(0, 8)
          : ref.citeKey;
        citationKeys.set(ref.citeKey, key);
        await client.query(
          "INSERT INTO bibliography(group_id,cite_key,title,authors,year,url,bibtex) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            groupId,
            key,
            ref.title,
            ref.authors,
            ref.year,
            ref.url,
            ref.bibtex.replace(/^(@\w+\s*\{\s*)[^,]+/, "$1" + key),
          ],
        );
      }
      for (const p of plan.projects)
        await client.query(
          "INSERT INTO projects(id,group_id,name,description,color,created_by,audience) VALUES($1,$2,$3,$4,$5,$6,'group')",
          [
            projectIds.get(p.id),
            groupId,
            p.name,
            p.description,
            p.color,
            userId,
          ],
        );
      const created: Note[] = [];
      for (const note of plan.notes) {
        const body = rewriteLinks(
          note.body,
          (node) => {
            const local = localTarget(note.file, node.href ?? "");
            const target = plan.notes.find(
              (n) =>
                n.file === local?.path ||
                (node.type === "wikiLink" &&
                  (n.id === node.href || n.title === node.href)),
            );
            if (target)
              return { noteId: target.newId, fragment: local?.fragment ?? "" };
            const attachment = plan.attachments.find(
              (a) => a.file === local?.path,
            );
            if (attachment)
              return `/api/v1/attachments/${attachment.newId}${local?.fragment ?? ""}`;
          },
          citationKeys,
        );
        const doc = new Y.Doc();
        doc.getText("markdown").insert(0, body);
        const state = Buffer.from(Y.encodeStateAsUpdate(doc));
        doc.destroy();
        const {
          rows: [row],
        } = await client.query<Note>(
          "INSERT INTO notes(id,group_id,project_id,author_id,title,body,plain_text,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            note.newId,
            groupId,
            note.projectId ? projectIds.get(note.projectId) : null,
            userId,
            note.title,
            body,
            plainText(parseMarkdown(body).ast),
            note.tags,
          ],
        );
        created.push(row);
        await client.query(
          "INSERT INTO documents(room,note_id,state) VALUES($1,$2,$3)",
          [`${note.newId}:1`, note.newId, state],
        );
      }
      for (const note of plan.notes)
        if (note.parentId)
          await client.query("UPDATE notes SET parent_id=$1 WHERE id=$2", [
            plan.notes.find((n) => n.id === note.parentId)!.newId,
            note.newId,
          ]);
      for (const file of plan.attachments)
        await client.query(
          "INSERT INTO attachments(id,note_id,name,mime,bytes,storage_key,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            file.newId,
            plan.notes.find((n) => n.id === file.noteId)!.newId,
            file.name,
            file.mime,
            file.data.length,
            storageKeys.get(file.newId),
            file.hash,
          ],
        );
      return created;
    });
  } catch (error) {
    // Only objects allocated by this failed import are removed; existing data is untouched.
    await Promise.allSettled(
      [...storageKeys.values()].map((key) => removeAttachment(key)),
    );
    throw error;
  }
}
