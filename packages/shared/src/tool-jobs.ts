import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { resourceAccess, fileAccess, HttpError } from "./access";
import { requireScope } from "./workspace-service";
import { callMathProvider } from "./tool-providers";
import { getAttachment, putAttachment, removeAttachment } from "./storage";
import { reserveCapacity } from "./uploads-api";

export async function processToolJob() {
  // Never replay an externally submitted request after a crash or unknown outcome.
  await query(
    "UPDATE tool_jobs SET status=CASE WHEN kind='office-preview' THEN 'failed' ELSE 'uncertain' END,error='Processing stopped before its outcome was confirmed. Review before explicitly submitting again.',input='{}',updated_at=now() WHERE status='running' AND lease_until<now()",
  );
  const job = await transaction(async (client) => {
    const {
      rows: [pending],
    } = await client.query(
      "SELECT * FROM tool_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    if (!pending) return null;
    await client.query(
      "UPDATE tool_jobs SET status='running',attempts=attempts+1,lease_until=now()+interval '3 minutes',updated_at=now() WHERE id=$1",
      [pending.id],
    );
    return pending;
  });
  if (!job) return false;
  const abort = new AbortController(),
    deadline = setTimeout(
      () =>
        abort.abort(
          new Error("Processing timed out; provider outcome may be unknown."),
        ),
      100000,
    );
  const cancelled = setInterval(() => {
    void query("SELECT status FROM tool_jobs WHERE id=$1", [job.id])
      .then(([row]) => {
        if (row?.status !== "running") abort.abort();
      })
      .catch(() => abort.abort());
  }, 1500);
  let submitted = false;
  try {
    const { resource, space } = await resourceAccess(
      job.owner_id,
      job.resource_id,
      job.kind === "office-preview" ? "read" : "edit",
    );
    let result: unknown;
    if (job.kind === "office-preview") {
      if (!process.env.OFFICE_CONVERTER_URL)
        throw new Error("Private Office conversion is not configured.");
      const { file } = await fileAccess(job.owner_id, job.version_id);
      if (file.resource_id !== resource.id)
        throw new HttpError(
          404,
          "Source version does not belong to this resource.",
        );
      if (Number(file.bytes) > 50_000_000)
        throw new Error(
          "Office preview is limited to files smaller than 50 MB.",
        );
      const response = await fetch(
        new URL("/convert", process.env.OFFICE_CONVERTER_URL),
        {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-file-kind": job.input.extension,
            authorization: `Bearer ${process.env.OFFICE_CONVERTER_TOKEN ?? ""}`,
          },
          body: new Uint8Array(
            await getAttachment(file.storage_key),
          ) as Uint8Array<ArrayBuffer>,
          redirect: "error",
          signal: abort.signal,
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `Private conversion failed (${response.status}). The original file is unchanged.`,
        );
      }
      const reader = response.body!.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const c = await reader.read();
        if (c.done) break;
        size += c.value.length;
        if (size > 80_000_000) {
          await reader.cancel();
          throw new Error("Converted preview exceeds its size limit.");
        }
        chunks.push(c.value);
      }
      const bytes = Buffer.concat(chunks);
      if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
        throw new Error("Converter did not produce a valid PDF.");
      const key = randomUUID();
      await putAttachment(key, bytes, "application/pdf");
      let stored = false;
      try {
        stored = await transaction(async (client) => {
          await requireScope(client, job.owner_id, resource.space_id, "read");
          const {
            rows: [target],
          } = await client.query(
            "SELECT space_id,deleted_at FROM resources WHERE id=$1 FOR SHARE",
            [resource.id],
          );
          if (
            !target ||
            target.deleted_at ||
            target.space_id !== resource.space_id
          )
            throw new Error(
              "The source moved or was deleted before the preview was ready.",
            );
          const {
            rows: [current],
          } = await client.query(
            "SELECT status FROM tool_jobs WHERE id=$1 FOR UPDATE",
            [job.id],
          );
          if (current?.status !== "running")
            throw new Error("Conversion was cancelled.");
          await reserveCapacity(client, resource.space_id, bytes.length);
          const saved = await client.query(
            "INSERT INTO file_derivatives(version_id,kind,storage_key,mime,bytes) VALUES($1,'office-pdf-v1',$2,'application/pdf',$3) ON CONFLICT DO NOTHING RETURNING version_id",
            [file.id, key, bytes.length],
          );
          await client.query(
            "UPDATE tool_jobs SET status='complete',result=$2,input='{}',updated_at=now() WHERE id=$1",
            [job.id, JSON.stringify({ kind: "pdf" })],
          );
          return !!saved.rowCount;
        });
      } finally {
        if (!stored) await removeAttachment(key).catch(() => {});
      }
      return true;
    } else {
      const [provider] = await query(
        "SELECT p.* FROM tool_providers p JOIN members m ON m.group_id=p.group_id AND m.user_id=$2 WHERE p.id=$1 AND p.enabled AND ($3::uuid IS NULL OR p.group_id=$3)",
        [job.provider_id, job.owner_id, space.group_id],
      );
      if (!provider)
        throw new Error("Provider access changed before processing began.");
      submitted = true;
      result = await callMathProvider(
        {
          kind: provider.kind,
          endpoint: provider.endpoint,
          model: provider.model,
          credential: provider.credential,
        },
        { kind: job.kind, ...job.input },
        abort.signal,
      );
    }
    // Access is checked again before publishing generated research material.
    await resourceAccess(job.owner_id, job.resource_id, "edit");
    await query(
      "UPDATE tool_jobs SET status='complete',result=$2,input='{}',updated_at=now() WHERE id=$1 AND status='running'",
      [
        job.id,
        JSON.stringify({
          ...(result as Record<string, unknown>),
          source: job.input.source,
        }),
      ],
    );
  } catch (e) {
    await query(
      "UPDATE tool_jobs SET status=$2,error=$3,input='{}',updated_at=now() WHERE id=$1 AND status='running'",
      [
        job.id,
        submitted ? "uncertain" : "failed",
        e instanceof HttpError
          ? e.message
          : e instanceof Error
            ? e.message.slice(0, 400)
            : "Tool processing failed.",
      ],
    );
  } finally {
    clearTimeout(deadline);
    clearInterval(cancelled);
  }
  return true;
}
