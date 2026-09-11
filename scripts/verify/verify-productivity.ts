import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import * as Y from "yjs";
import { pool, query } from "../../packages/shared/src/db";
import { processTrashOperation } from "../../packages/shared/src/trash-api";
import { deleteUnusedBlob } from "../../packages/shared/src/resource-operations";
import { getAttachment } from "../../packages/shared/src/storage";

const database = new URL(process.env.DATABASE_URL!),
  origin = process.env.TEST_APP_URL!;
assert(
  /(?:test|verification)/.test(database.pathname),
  "An isolated test database is required.",
);
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(new URL(origin).port === "3002", "Use the isolated staging service.");
assert(
  (process.env.STORAGE_PATH ?? "").includes("test"),
  "Use isolated test storage.",
);
if (process.argv[2] === "worker") {
  try {
    await processTrashOperation(process.argv[3], {
      id: process.argv[4],
      lease: process.argv[5],
    });
  } finally {
    await pool.end();
  }
} else {
  let cookie = "";
  async function api(path: string, data?: unknown) {
    const response = await fetch(origin + path, {
      method: data === undefined ? "GET" : "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (response.headers.getSetCookie().length)
      cookie = response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
    const result = await response.json();
    assert(response.ok, `${path}: ${result.error ?? response.status}`);
    return result;
  }
  const lock = await pool.connect();
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const login = await api("/api/auth/sign-in/email", {
      email: "researcher@axiom.local",
      password: "AxiomResearch2026!",
    });
    const group = await api("/api/v1/groups", {
      name: "Productivity safety " + randomUUID().slice(0, 8),
    });
    const team = (await api("/api/v1/spaces")).find(
      (s: any) => s.group_id === group.id && s.kind === "team",
    );
    const create = (name: string, body = "Fixture research.") =>
      api("/api/v1/resources", { kind: "note", name, body, spaceId: team.id });
    const anchor = await create("Evidence anchor");
    async function upload(name: string) {
      const form = new FormData();
      form.append(
        "file",
        new File(["Isolated evidence " + name], name, { type: "text/plain" }),
      );
      const response = await fetch(
        `${origin}/api/v1/notes/${anchor.id}/attachments`,
        { method: "POST", headers: { origin, cookie }, body: form },
      );
      assert(response.ok);
      const attachment = await response.json();
      return (
        await query(
          "SELECT a.*,v.resource_id,r.version FROM attachments a JOIN file_versions v ON v.id=a.id JOIN resources r ON r.id=v.resource_id WHERE a.id=$1",
          [attachment.id],
        )
      )[0];
    }
    const snapshotFile = await upload("snapshot-evidence.txt"),
      annotated = await upload("annotated-evidence.txt"),
      reading = await upload("reading-evidence.txt"),
      cited = await upload("cited-evidence.txt"),
      disposable = await upload("eligible-evidence.txt");
    const snapshotOwner = await create(
      "Retained snapshot owner",
      "Current source no longer includes the old file.",
    );
    const snapshotBody = `[Historical evidence](/api/v1/attachments/${snapshotFile.id})`,
      doc = new Y.Doc();
    doc.getText("markdown").insert(0, snapshotBody);
    await query(
      "INSERT INTO snapshots(note_id,title,body,state,generation,label,author_id) VALUES($1,'Evidence history',$2,$3,1,'Retained fixture',$4)",
      [
        snapshotOwner.id,
        snapshotBody,
        Buffer.from(Y.encodeStateAsUpdate(doc)),
        login.user.id,
      ],
    );
    doc.destroy();
    await query(
      "INSERT INTO paper_annotations(id,attachment_id,author_id,shared,data,mutation_id) VALUES($1,$2,$3,false,$4,$5)",
      [
        randomUUID(),
        annotated.id,
        login.user.id,
        JSON.stringify({
          kind: "note",
          page: 1,
          body: "Retain this evidence",
          quote: "",
          rects: [],
          sha256: annotated.sha256,
          color: "yellow",
        }),
        randomUUID(),
      ],
    );
    await query(
      "INSERT INTO reading_items(id,user_id,group_id,kind,target_type,target_id,data,mutation_id) VALUES($1,$2,$3,'bookmark','attachment',$4,$5,$6)",
      [
        randomUUID(),
        login.user.id,
        group.id,
        reading.id,
        JSON.stringify({ label: "Retain reading evidence", fraction: 0.5 }),
        randomUUID(),
      ],
    );
    const reference = await api("/api/v1/references", {
      groupId: group.id,
      citeKey: "preserved" + randomUUID().slice(0, 6),
      title: "Evidence reference",
    });
    await query(
      "INSERT INTO reference_attachments(reference_id,attachment_id) VALUES($1,$2)",
      [reference.id, cited.id],
    );
    const trash = async (id: string) => {
      const current = await api(`/api/v1/resources/${id}`);
      await api(`/api/v1/resources/${id}/trash`, { version: current.version });
    };
    for (const item of [snapshotFile, annotated, reading, cited, disposable])
      await trash(item.resource_id);
    const preview = await api("/api/v1/trash/preview", {
      mutationId: randomUUID(),
      action: "purge",
      spaceIds: [team.id],
      ids: [snapshotFile, annotated, reading, cited, disposable].map(
        (f) => f.resource_id,
      ),
    });
    assert.equal(preview.operation.blocked, 4);
    assert.equal(preview.operation.pending, 1);
    await api(`/api/v1/trash/${preview.operation.id}/confirm`, {
      mutationId: randomUUID(),
      confirmation: "DELETE FOREVER",
    });
    await processTrashOperation(preview.operation.id);
    const result = await api(`/api/v1/trash/${preview.operation.id}`);
    assert.equal(result.operation.done, 1);
    assert.equal(result.operation.blocked, 4);
    for (const item of [snapshotFile, annotated, reading, cited]) {
      await deleteUnusedBlob(item.storage_key);
      assert.equal(
        (await getAttachment(item.storage_key)).toString(),
        "Isolated evidence " + item.name,
      );
    }
    await deleteUnusedBlob(disposable.storage_key);
    await assert.rejects(() => getAttachment(disposable.storage_key));
    console.log(
      "PASS: snapshots, annotations, reading records and citations survive; only unused eligible blobs are cleaned up.",
    );
    const project = await api("/api/v1/projects", {
      groupId: group.id,
      name: "Review evidence fixture",
    });
    const projectSpace = (await api("/api/v1/spaces")).find(
      (s: any) => s.project_id === project.id,
    );
    const reviewFile = await upload("formal-review-evidence.txt");
    const reviewed = await api("/api/v1/resources", {
      spaceId: projectSpace.id,
      kind: "note",
      name: "Formal review fixture",
      body: `[Evidence](/api/v1/attachments/${reviewFile.id})`,
    });
    await api(`/api/v1/projects/${project.id}/reviews`, {
      noteId: reviewed.id,
      reviewerId: login.user.id,
    });
    await trash(reviewed.id);
    await trash(reviewFile.resource_id);
    const reviewedPreview = await api("/api/v1/trash/preview", {
      mutationId: randomUUID(),
      action: "purge",
      spaceIds: [team.id, projectSpace.id],
      ids: [reviewed.id, reviewFile.resource_id],
    });
    assert.equal(reviewedPreview.operation.pending, 0);
    assert.equal(reviewedPreview.operation.blocked, 2);
    assert(
      reviewedPreview.items.some((i: any) => /Formal review/.test(i.reason)),
    );
    assert(
      reviewedPreview.items.some((i: any) => /retained note/.test(i.reason)),
    );
    const destination = await api("/api/v1/resources", {
      spaceId: team.id,
      kind: "folder",
      name: "Active upload target",
    });
    const uploadId = randomUUID();
    await api("/api/v1/uploads", {
      id: uploadId,
      spaceId: team.id,
      parentId: destination.id,
      name: "pending.txt",
      bytes: 100,
    });
    await trash(destination.id);
    const uploadPreview = await api("/api/v1/trash/preview", {
      mutationId: randomUUID(),
      action: "purge",
      spaceIds: [team.id],
      ids: [destination.id],
    });
    assert.equal(uploadPreview.operation.pending, 0);
    assert.match(uploadPreview.items[0].reason, /transfers/);
    await api(`/api/v1/uploads/${uploadId}/cancel`, {});
    const newlyReferenced = await upload("new-reference-after-preview.txt");
    await trash(newlyReferenced.resource_id);
    const newPreview = await api("/api/v1/trash/preview", {
      mutationId: randomUUID(),
      action: "purge",
      spaceIds: [team.id],
      ids: [newlyReferenced.resource_id],
    });
    assert.equal(newPreview.operation.pending, 1);
    await create(
      "Late reference fixture",
      `[New evidence link](/api/v1/attachments/${newlyReferenced.id})`,
    );
    await api(`/api/v1/trash/${newPreview.operation.id}/confirm`, {
      mutationId: randomUUID(),
      confirmation: "DELETE FOREVER",
    });
    await processTrashOperation(newPreview.operation.id);
    assert.equal(
      (await api(`/api/v1/trash/${newPreview.operation.id}`)).operation.blocked,
      1,
    );
    console.log(
      "PASS: formal reviews retain their file dependencies across workspaces; uploads and references added after preview prevent deletion.",
    );

    const synchronizing = await create("Journal protection");
    await trash(synchronizing.id);
    const room = randomUUID() + ":1",
      empty = new Y.Doc();
    await query("INSERT INTO document_updates(room,data) VALUES($1,$2)", [
      room,
      Buffer.from(Y.encodeStateAsUpdate(empty)),
    ]);
    empty.destroy();
    try {
      const blocked = await api("/api/v1/trash/preview", {
        mutationId: randomUUID(),
        action: "purge",
        spaceIds: [team.id],
        ids: [synchronizing.id],
      });
      assert.equal(blocked.operation.pending, 0);
      assert.match(blocked.items[0].reason, /synchronizing/);
    } finally {
      await query("DELETE FROM document_updates WHERE room=$1", [room]);
    }
    console.log(
      "PASS: pending CRDT journals prevent unsafe reference cleanup.",
    );

    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const note = await create(`Restart item ${i}`);
      await trash(note.id);
      ids.push(note.id);
    }
    const frozen = await api("/api/v1/trash/preview", {
      mutationId: randomUUID(),
      action: "purge",
      spaceIds: [team.id],
      ids,
    });
    const job = { id: randomUUID(), lease: randomUUID() };
    await query("UPDATE trash_operations SET status='queued' WHERE id=$1", [
      frozen.operation.id,
    ]);
    await query(
      "INSERT INTO workspace_jobs(id,kind,dedupe_key,payload,status,lease_id,leased_until) VALUES($1,'trash-operation',$2,$3,'running',$4,now()+interval '10 minutes')",
      [
        job.id,
        "verify-trash:" + job.id,
        JSON.stringify({ id: frozen.operation.id }),
        job.lease,
      ],
    );
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM resources WHERE id=$1 FOR UPDATE", [
      [...ids].sort().at(-1),
    ]);
    child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/verify/verify-productivity.ts",
        "worker",
        frozen.operation.id,
        job.id,
        job.lease,
      ],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let interrupted = false;
    for (let i = 0; i < 200; i++) {
      const [counts] = await query(
        "SELECT count(*) FILTER(WHERE status='done')::int AS done,count(*) FILTER(WHERE status='pending')::int AS pending FROM trash_operation_items WHERE operation_id=$1",
        [frozen.operation.id],
      );
      if (counts.done > 0 && counts.pending > 0) {
        interrupted = true;
        break;
      }
      await delay(50);
    }
    assert(
      interrupted,
      "The fault-injection worker should commit some work before interruption.",
    );
    const exited = new Promise((done) => child!.once("exit", done));
    child.kill("SIGKILL");
    await exited;
    child = undefined;
    await lock.query("ROLLBACK");
    const freshLease = randomUUID();
    await query(
      "UPDATE workspace_jobs SET lease_id=$2,leased_until=now()+interval '10 minutes' WHERE id=$1",
      [job.id, freshLease],
    );
    await assert.rejects(
      () => processTrashOperation(frozen.operation.id, job),
      /lease changed/,
    );
    await processTrashOperation(frozen.operation.id, {
      id: job.id,
      lease: freshLease,
    });
    await processTrashOperation(frozen.operation.id, {
      id: job.id,
      lease: freshLease,
    });
    assert.equal(
      (await api(`/api/v1/trash/${frozen.operation.id}`)).operation.done,
      20,
    );
    await query("UPDATE workspace_jobs SET status='done' WHERE id=$1", [
      job.id,
    ]);
    console.log(
      "PASS: worker kill and lease rotation resume the exact frozen targets without replaying completed work.",
    );
  } finally {
    child?.kill("SIGKILL");
    await lock.query("ROLLBACK").catch(() => {});
    lock.release();
    await pool.end();
  }
}
