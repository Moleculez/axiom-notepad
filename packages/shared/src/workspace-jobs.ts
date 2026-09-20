import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { query, transaction } from "./db";
import { finishUpload } from "./uploads-api";
import { getAttachment, putAttachment } from "./storage";
import { clearUploadStaging } from "./storage-streams";
import {
  recurrenceSchema,
  recurrenceOccursOn,
  nextCalendarDate,
} from "./workspace";
import { deliverEvent, recordActivity, enqueueJob } from "./workspace-service";
import { sendMail, appUrl } from "./auth";
import { notifyWorkspace } from "./documents";
import { assistantMaintenance } from "./assistant-service";
import { deleteUnusedBlob } from "./resource-operations";
import { buildWorkspaceExport } from "./workspace-exports";
import { purgeSpace } from "./space-lifecycle";
import { processTrashOperation } from "./trash-api";
import { processFileOperation } from "./file-workflows-api";
import { withAuditContext } from "./audit-context";
import { activeConnection } from "./integration-security";
import { pruneImageDraftAssets } from "./image-cloud-api";
import { HttpError } from "./access";

export async function processRecurrences() {
  const rules = await query(
    "SELECT r.id,s.id AS space_id,s.timezone FROM task_recurrences r JOIN spaces s ON s.id=r.space_id WHERE r.enabled AND axiom_space_state(s.id)='active' ORDER BY r.id LIMIT 500",
  );
  for (const entry of rules)
    await transaction(async (client) => {
      // Match lifecycle's scope-before-recurrence locking order.
      const {
        rows: [scope],
      } = await client.query("SELECT id FROM spaces WHERE id=$1 FOR UPDATE", [
        entry.space_id,
      ]);
      if (
        !scope ||
        (
          await client.query("SELECT axiom_space_state($1) AS state", [
            entry.space_id,
          ])
        ).rows[0].state !== "active"
      )
        return;
      const {
        rows: [row],
      } = await client.query(
        "SELECT r.*,s.id AS space_id FROM task_recurrences r JOIN spaces s ON s.id=r.space_id WHERE r.id=$1 AND r.enabled FOR UPDATE OF r SKIP LOCKED",
        [entry.id],
      );
      if (!row) return;
      const rule = recurrenceSchema.parse(row.rule);
      const today = new Intl.DateTimeFormat("sv-SE", {
        timeZone: entry.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      let date = row.last_date
        ? nextCalendarDate(
            typeof row.last_date === "string"
              ? row.last_date
              : row.last_date.toISOString().slice(0, 10),
          )
        : rule.start;
      for (
        let i = 0;
        i < 62 && date <= today && (!rule.until || date <= rule.until);
        i++, date = nextCalendarDate(date)
      ) {
        if (recurrenceOccursOn(rule, date)) {
          const {
            rows: [prior],
          } = await client.query(
            "SELECT task_id FROM task_occurrences WHERE recurrence_id=$1 AND occurs_on=$2",
            [row.id, date],
          );
          if (!prior) {
            const t = row.template;
            const {
              rows: [member],
            } = await client.query("SELECT axiom_space_role($1,$2) AS role", [
              t.assigneeId ?? row.created_by,
              row.space_id,
            ]);
            const assignee = t.assigneeId && member.role ? t.assigneeId : null;
            const {
              rows: [task],
            } = await client.query(
              "INSERT INTO tasks(project_id,created_by,title,body,priority,assignee_id,due_on,estimate_hours,labels,space_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
              [
                row.project_id,
                row.created_by,
                t.title,
                t.body ?? "",
                t.priority ?? "normal",
                assignee,
                date,
                t.estimateHours ?? null,
                t.labels ?? [],
                row.space_id,
              ],
            );
            await client.query(
              "INSERT INTO task_occurrences(recurrence_id,occurs_on,task_id) VALUES($1,$2,$3)",
              [row.id, date, task.id],
            );
            const evidence = [
              ...new Set([
                ...(Array.isArray(t.resourceIds) ? t.resourceIds : []),
                ...(t.noteId ? [t.noteId] : []),
              ]),
            ];
            if (evidence.length)
              await client.query(
                "INSERT INTO task_resources(task_id,resource_id) SELECT $1,id FROM resources WHERE id=ANY($2::uuid[]) AND space_id=$3 AND deleted_at IS NULL ON CONFLICT DO NOTHING",
                [task.id, evidence, row.space_id],
              );
            await recordActivity(client, {
              userId: row.created_by,
              spaceId: row.space_id,
              kind: "recurrence",
              title: `Scheduled ${t.title}`,
              taskId: task.id,
            });
            if (assignee)
              await deliverEvent(client, {
                userId: assignee,
                spaceId: row.space_id,
                kind: "assignments",
                title: `Recurring task: ${t.title}`,
                taskId: task.id,
                dedupe: `recurrence:${row.id}:${date}:${assignee}`,
              });
          }
        }
        await client.query(
          "UPDATE task_recurrences SET last_date=$2 WHERE id=$1",
          [row.id, date],
        );
      }
    });
}
async function thumbnail(versionId: string) {
  const [file] = await query(
    "SELECT a.* FROM attachments a JOIN file_versions v ON v.id=a.id WHERE a.id=$1",
    [versionId],
  );
  if (
    !file ||
    !file.mime.startsWith("image/") ||
    Number(file.bytes) > 25 * 1024 * 1024
  )
    return;
  if (
    (
      await query(
        "SELECT 1 FROM file_derivatives WHERE version_id=$1 AND kind='thumbnail'",
        [versionId],
      )
    ).length
  )
    return;
  const data = await sharp(await getAttachment(file.storage_key), {
    limitInputPixels: 32_000_000,
    animated: false,
  })
    .rotate()
    .resize({
      width: 512,
      height: 512,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();
  const key = randomUUID();
  await putAttachment(key, data, "image/webp");
  await query(
    "INSERT INTO file_derivatives(version_id,kind,storage_key,mime,bytes) VALUES($1,'thumbnail',$2,'image/webp',$3) ON CONFLICT DO NOTHING",
    [versionId, key, data.length],
  );
}
async function notification(id: string) {
  const [event] = await query(
    `SELECT e.*,u.email,p.data FROM inbox_events e JOIN "user" u ON u.id=e.user_id JOIN notification_preferences p ON p.user_id=e.user_id WHERE e.id=$1 AND axiom_space_role(e.user_id,e.space_id) IS NOT NULL AND axiom_space_state(e.space_id)='active'`,
    [id],
  );
  if (!event || event.data.email !== true || event.data[event.kind] === false)
    return;
  if (
    !(await sendMail(
      event.email,
      "Axiom — " + event.title,
      `${event.title}\n\nOpen your workspace: ${appUrl}/workbench/inbox\n\nManage email preferences in your account settings.`,
    ))
  )
    throw new Error("Email delivery is not configured.");
}
export async function processWorkspaceJob() {
  const job = await transaction(async (client) => {
    const {
      rows: [row],
    } = await client.query(
      "SELECT * FROM workspace_jobs WHERE (status='queued' AND available_at<=now()) OR (status='running' AND leased_until<now()) ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED",
    );
    if (!row) return null;
    const lease = randomUUID();
    await client.query(
      "UPDATE workspace_jobs SET status='running',attempts=attempts+1,lease_id=$2,leased_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1",
      [row.id, lease],
    );
    return { ...row, lease, attempts: row.attempts + 1 };
  });
  if (!job) return false;
  const heartbeat = setInterval(() => {
    void query(
      "UPDATE workspace_jobs SET leased_until=now()+interval '2 minutes' WHERE id=$1 AND lease_id=$2 AND status='running'",
      [job.id, job.lease],
    ).catch(() => {});
  }, 20_000);
  try {
    const integration = job.payload.integrationAudit;
    if (integration?.integrationId)
      await activeConnection(
        integration.integrationId,
        integration.actorId,
        integration.integrationScope,
        undefined,
        integration.integrationVersion,
      );
    const [attribution] = await query(
      `SELECT user_id FROM file_operations WHERE id=$1 AND $2='file-operation'
       UNION ALL SELECT user_id FROM trash_operations WHERE id=$1 AND $2='trash-operation'
       UNION ALL SELECT owner_id AS user_id FROM upload_sessions WHERE id=$1 AND $2='complete-upload'`,
      [job.payload.id ?? null, job.kind],
    );
    await withAuditContext(
      {
        ...job.payload.integrationAudit,
        actorId:
          job.payload.userId ??
          attribution?.user_id ??
          job.payload.integrationAudit?.actorId,
        operationId: job.payload.id ?? job.id,
      },
      async () => {
        if (job.kind === "complete-upload") await finishUpload(job.payload.id);
        else if (job.kind === "thumbnail")
          await thumbnail(job.payload.versionId);
        else if (job.kind === "notification")
          await notification(job.payload.id);
        else if (job.kind === "delete-blob")
          await deleteUnusedBlob(job.payload.key);
        else if (job.kind === "export")
          await buildWorkspaceExport(job.payload.id);
        else if (job.kind === "trash-operation")
          await processTrashOperation(job.payload.id, job);
        else if (job.kind === "file-operation")
          await processFileOperation(job.payload.id);
        else if (job.kind === "purge-space")
          await purgeSpace(
            job.payload.spaceId,
            job.payload.userId,
            job.payload.version,
          );
        else throw new Error("Unsupported background job type.");
      },
    );
    await query(
      "UPDATE workspace_jobs SET status='done',leased_until=NULL,error=NULL,updated_at=now() WHERE id=$1 AND lease_id=$2",
      [job.id, job.lease],
    );
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : "Background processing failed."
    ).slice(0, 500);
    const exhausted =
      job.attempts >= 5 ||
      (job.kind === "complete-upload" &&
        error instanceof HttpError &&
        [400, 403, 404, 409, 413].includes(error.status));
    const updated = await query(
      "UPDATE workspace_jobs SET status=$2,error=$3,available_at=now()+($4::int*interval '1 second'),leased_until=NULL,updated_at=now() WHERE id=$1 AND lease_id=$5 RETURNING id",
      [
        job.id,
        exhausted ? "failed" : "queued",
        message,
        Math.min(300, 2 ** job.attempts),
        job.lease,
      ],
    );
    if (updated.length && job.kind === "complete-upload")
      await query(
        "UPDATE upload_sessions SET error=$2,status=CASE WHEN $3 THEN 'failed' ELSE status END,updated_at=now() WHERE id=$1 AND status<>'complete'",
        [job.payload.id, message, exhausted],
      );
    if (updated.length && exhausted && job.kind === "trash-operation")
      await transaction(async (client) => {
        const {
          rows: [operation],
        } = await client.query(
          "SELECT status FROM trash_operations WHERE id=$1 FOR UPDATE",
          [job.payload.id],
        );
        if (!operation || !["queued", "running"].includes(operation.status))
          return;
        await client.query(
          "UPDATE trash_operation_items SET status='blocked',reason='Background processing stopped. Completed items are safe; retry the remaining items.' WHERE operation_id=$1 AND status='pending'",
          [job.payload.id],
        );
        await client.query(
          "UPDATE trash_operations SET status='completed',updated_at=now() WHERE id=$1",
          [job.payload.id],
        );
      });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
export async function workspaceMaintenance() {
  await assistantMaintenance();
  await query("DELETE FROM pdf_ocr_jobs WHERE expires_at<now()");
  await pruneImageDraftAssets();
  await processRecurrences();
  const expired = await query(
    "UPDATE upload_sessions SET status='cancelled',error='The upload expired after seven days.' WHERE status IN ('uploading','failed') AND expires_at<now() RETURNING *",
  );
  for (const item of expired) {
    await clearUploadStaging(
      item as Parameters<typeof clearUploadStaging>[0],
      true,
    );
    await enqueueJob("delete-blob", "expired-upload:" + item.id, {
      key: item.storage_key,
    });
  }
  const tasks = await query(
    "SELECT t.*,s.id AS space_id,s.timezone FROM tasks t JOIN spaces s ON s.id=t.space_id WHERE t.deleted_at IS NULL AND t.status NOT IN ('done','cancelled') AND t.assignee_id IS NOT NULL AND t.due_on BETWEEN CURRENT_DATE-1 AND CURRENT_DATE+1 AND axiom_space_state(s.id)='active'",
  );
  for (const task of tasks) {
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: task.timezone,
    }).format(new Date());
    const due =
      typeof task.due_on === "string"
        ? task.due_on
        : task.due_on.toISOString().slice(0, 10);
    if (due !== today) continue;
    await transaction((client) =>
      deliverEvent(client, {
        userId: task.assignee_id,
        spaceId: task.space_id,
        kind: "reminders",
        title: `Due today: ${task.title}`,
        taskId: task.id,
        dedupe: createHash("sha256")
          .update(`due:${task.id}:${today}`)
          .digest("hex"),
      }),
    );
  }
  await notifyWorkspace();
}
