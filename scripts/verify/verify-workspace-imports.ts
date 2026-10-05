import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import * as Y from "yjs";
import { query, pool } from "../../packages/shared/src/db";
import { auth } from "../../packages/shared/src/auth";
import {
  finishWorkspaceImport,
  expireWorkspaceImports,
} from "../../packages/shared/src/workspace-import-api";
import {
  canonicalImportJson,
  IMPORT_LIMITS,
  type ImportManifest,
  type ImportManifestEntry,
  type WorkspaceImportBatch,
  type WorkspaceImportPreview,
} from "../../packages/shared/src/workspace-import";
import { UPLOAD_CHUNK_BYTES } from "../../packages/shared/src/workspace";
import { purgeSpace } from "../../packages/shared/src/space-lifecycle";

const database = new URL(process.env.DATABASE_URL!),
  origin = process.env.APP_URL!;
assert.equal(
  database.pathname,
  "/axiom_plugins_test",
  "Only isolated staging data is allowed.",
);
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(new URL(origin).port, "3004");
assert((process.env.STORAGE_PATH ?? "").includes("plugins-test"));
const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
function file(
  path: string,
  data: Uint8Array | string = "",
  kind: "note" | "file" = "note",
) {
  const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data),
    parts: string[] = [];
  for (let from = 0; from < body.length; from += UPLOAD_CHUNK_BYTES)
    parts.push(digest(body.subarray(from, from + UPLOAD_CHUNK_BYTES)));
  return {
    entry: {
      id: randomUUID(),
      path,
      kind,
      bytes: body.length,
      digest: digest(parts.join("")),
    } satisfies ImportManifestEntry,
    body,
  };
}
const folder = (path: string): ImportManifestEntry => ({
  id: randomUUID(),
  path,
  kind: "folder",
  bytes: 0,
  digest: null,
});
function client(cookie = "") {
  const request = async <T = Record<string, any>>(
    path: string,
    method = "GET",
    data?: unknown,
    status = 200,
  ): Promise<T> => {
    const response = await fetch(origin + path, {
      method,
      headers: {
        origin,
        cookie,
        "content-type": Buffer.isBuffer(data)
          ? "application/octet-stream"
          : "application/json",
        ...(Buffer.isBuffer(data) ? { "x-content-sha256": digest(data) } : {}),
      },
      body:
        data === undefined
          ? undefined
          : Buffer.isBuffer(data)
            ? new Uint8Array(data)
            : JSON.stringify(data),
    });
    if (response.headers.getSetCookie().length)
      cookie = response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
    const result = await response.json();
    assert.equal(
      response.status,
      status,
      `${path}: ${result.error ?? response.status}`,
    );
    return result;
  };
  return Object.assign(request, { fork: () => client(cookie) });
}
const api = client(),
  other = client();
async function state(batch: WorkspaceImportBatch) {
  return api<WorkspaceImportBatch>(
    `/api/v1/spaces/${batch.spaceId}/imports/${batch.id}`,
  );
}
async function wait(
  batch: WorkspaceImportBatch,
  predicate: (b: WorkspaceImportBatch) => boolean,
  label: string,
) {
  for (let tries = 0; tries < 120; tries++) {
    const current = await state(batch);
    if (predicate(current)) return current;
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `Timed out waiting for ${label}: ${(await state(batch)).status}`,
  );
}
async function begin(
  spaceId: string,
  entries: ImportManifestEntry[],
  source: ImportManifest["source"] = "folder",
  conflict: ImportManifest["conflict"] = "keepBoth",
  parentId: string | null = null,
) {
  const manifest: ImportManifest = { entries, source, conflict, parentId };
  const before = Number(
    (await query("SELECT count(*) AS count FROM workspace_imports"))[0].count,
  );
  const preview = await api<WorkspaceImportPreview>(
    `/api/v1/spaces/${spaceId}/imports/preview`,
    "POST",
    manifest,
  );
  assert.equal(
    Number(
      (await query("SELECT count(*) AS count FROM workspace_imports"))[0].count,
    ),
    before,
    "Preview must not create a batch.",
  );
  const input = {
    id: randomUUID(),
    manifest,
    fingerprint: preview.fingerprint,
  };
  const batch = await api<WorkspaceImportBatch>(
    `/api/v1/spaces/${spaceId}/imports`,
    "POST",
    input,
    201,
  );
  const retry = await api<WorkspaceImportBatch>(
    `/api/v1/spaces/${spaceId}/imports`,
    "POST",
    input,
    201,
  );
  assert.equal(batch.id, retry.id);
  assert.deepEqual(batch.entries, retry.entries);
  return { batch, manifest, preview, input };
}
async function transfer(
  batch: WorkspaceImportBatch,
  incoming: ReturnType<typeof file>,
  onlyPart?: number,
) {
  const base = `/api/v1/spaces/${batch.spaceId}/imports/${batch.id}/entries/${incoming.entry.id}`;
  await api(base + "/prepare", "POST", {});
  for (
    let part = 1;
    part <= Math.ceil(incoming.body.length / UPLOAD_CHUNK_BYTES);
    part++
  ) {
    if (onlyPart !== undefined && part !== onlyPart) continue;
    const body = incoming.body.subarray(
      (part - 1) * UPLOAD_CHUNK_BYTES,
      part * UPLOAD_CHUNK_BYTES,
    );
    await api(base + "/chunks/" + part, "PUT", body);
    await api(base + "/chunks/" + part, "PUT", body); // Exact part retries are harmless.
  }
  if (onlyPart === undefined) await api(base + "/complete", "POST", {}, 202);
  return base;
}
async function published(ids: string[]) {
  return Number(
    (
      await query(
        "SELECT count(*) AS count FROM resources WHERE id=ANY($1::uuid[])",
        [ids],
      )
    )[0].count,
  );
}
async function cancel(batch: WorkspaceImportBatch) {
  return api<WorkspaceImportBatch>(
    `/api/v1/spaces/${batch.spaceId}/imports/${batch.id}/cancel`,
    "POST",
    {},
  );
}

try {
  const login = await api("/api/auth/sign-in/email", "POST", {
    email: "extensions@axiom.local",
    password: "ExtensionsTest2026!",
  });
  const ownerId = login.user.id as string;
  const personal = (
    await api<{ id: string; kind: string }[]>("/api/v1/spaces")
  ).find((s) => s.kind === "personal")!;
  const group = await api(
    "/api/v1/groups",
    "POST",
    { name: "Import acceptance " + randomUUID().slice(0, 8) },
    201,
  );
  const workspace = await api(
    "/api/v1/spaces",
    "POST",
    { groupId: group.id, name: "Import laboratory", audience: "group" },
    201,
  );
  const restricted = await api(
    "/api/v1/spaces",
    "POST",
    {
      groupId: group.id,
      name: "Restricted import laboratory",
      audience: "restricted",
    },
    201,
  );
  const spaces =
    await api<{ id: string; kind: string; group_id: string }[]>(
      "/api/v1/spaces",
    );
  const teamId = spaces.find(
    (s) => s.kind === "team" && s.group_id === group.id,
  )!.id;
  let [member] = await query('SELECT id FROM "user" WHERE email=$1', [
    "extension-member@axiom.local",
  ]);
  if (!member)
    member = (
      await auth.api.signUpEmail({
        body: {
          email: "extension-member@axiom.local",
          name: "Import fixture member",
          password: "ExtensionsTest2026!",
        },
        headers: new Headers({ "x-axiom-internal": process.env.SYNC_SECRET! }),
      })
    ).user;
  await query(
    "INSERT INTO members(group_id,user_id,role,content_role) VALUES($1,$2,'member','editor')",
    [group.id, member.id],
  );
  await other("/api/auth/sign-in/email", "POST", {
    email: "extension-member@axiom.local",
    password: "ExtensionsTest2026!",
  });

  const main = file(
      "Lab/main.md",
      '# Research\r\n\r\n[**Other**](Other.md#Methods "Title")\r\n\r\n![plot](data/plot.png)\r\n\r\nFootnote[^n]\r\n\r\n[^n]: [other](Other.md)\r\n',
    ),
    otherNote = file("Lab/Other.md", "# Methods\n\n$$E=mc^2$$\n"),
    empty = file("Lab/empty.md"),
    image = file(
      "Lab/data/plot.png",
      Buffer.from("not an actual PNG; never executed"),
      "file",
    );
  const entries = [
    folder("Lab"),
    folder("Lab/data"),
    folder("Lab/Empty"),
    main.entry,
    otherNote.entry,
    empty.entry,
    image.entry,
  ];
  const atomic = await begin(workspace.space_id, entries);
  await other(
    `/api/v1/spaces/${workspace.space_id}/imports/${atomic.batch.id}`,
    "GET",
    undefined,
    404,
  );
  await other(
    `/api/v1/spaces/${restricted.space_id}/imports/preview`,
    "POST",
    { source: "markdown", entries: [file("x.md").entry] },
    404,
  );
  await transfer(atomic.batch, main);
  await wait(
    atomic.batch,
    (b) => b.entries.find((e) => e.id === main.entry.id)?.status === "staged",
    "private note verification",
  );
  assert.equal(await published(entries.map((e) => e.id)), 0);
  for (const suffix of ["", "/complete", "/save-copy", "/cancel"])
    await api(
      `/api/v1/uploads/${main.entry.id}${suffix}`,
      suffix ? "POST" : "GET",
      suffix === "/save-copy"
        ? { name: "Bypass", parentId: null }
        : suffix
          ? {}
          : undefined,
      404,
    );
  await api(
    "/api/v1/uploads",
    "POST",
    {
      id: main.entry.id,
      name: "main.md",
      bytes: main.body.length,
      spaceId: workspace.space_id,
      parentId: null,
    },
    409,
  );
  await transfer(atomic.batch, otherNote);
  await transfer(atomic.batch, empty);
  await transfer(atomic.batch, image);
  const result = await wait(
    atomic.batch,
    (b) => ["complete", "blocked"].includes(b.status),
    "atomic publication",
  );
  assert.equal(
    result.status,
    "complete",
    result.error ?? "Publication failed.",
  );
  assert.equal(await published(entries.map((e) => e.id)), entries.length);
  const [{ body, state: saved }] = await query(
    "SELECT n.body,d.state FROM notes n JOIN documents d ON d.note_id=n.id WHERE n.id=$1",
    [main.entry.id],
  );
  const expected = main.body
    .toString()
    .replace("Other.md#Methods", otherNote.entry.id + "#Methods")
    .replace("data/plot.png", "/api/v1/attachments/" + image.entry.id)
    .replace("(Other.md)", "(" + otherNote.entry.id + ")");
  assert.equal(body, expected);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, saved);
  assert.equal(doc.getText("markdown").toString(), expected);
  doc.destroy();
  assert.equal(
    (
      await query(
        "SELECT count(*)::int AS count FROM note_links WHERE source_id=$1 AND target_id=$2",
        [main.entry.id, otherNote.entry.id],
      )
    )[0].count,
    2,
  );
  assert.equal(
    (await query("SELECT body FROM notes WHERE id=$1", [empty.entry.id]))[0]
      .body,
    "",
  );
  assert.equal((await cancel(result)).status, "complete");
  assert.equal(await published(entries.map((e) => e.id)), entries.length);
  const receipt = await api<WorkspaceImportBatch>(
    `/api/v1/spaces/${workspace.space_id}/imports/${result.id}/finalize`,
    "POST",
    {},
    202,
  );
  assert.deepEqual(receipt.result, result.result);
  const download = await fetch(
    `${origin}/api/v1/files/${image.entry.id}/download`,
    { headers: { cookie: "" } },
  );
  assert.equal(download.status, 401);
  console.log(
    "PASS: SELECT-only preview, private preparation, no ordinary-upload bypass, native Yjs/empty notes, hierarchy, source-preserving links/indexes, exact receipt and completed-cancel safety.",
  );

  for (const spaceId of [personal.id, restricted.space_id]) {
    const source = file("Private.md", "# Native\n"),
      fixture = await begin(spaceId, [source.entry], "markdown");
    await transfer(fixture.batch, source);
    const done = await wait(
      fixture.batch,
      (b) => ["complete", "blocked"].includes(b.status),
      "personal/restricted import",
    );
    assert.equal(done.status, "complete", done.error ?? "Failed");
    assert.equal(
      (
        await query("SELECT visibility FROM notes WHERE id=$1", [
          source.entry.id,
        ])
      )[0].visibility,
      spaceId === personal.id ? "private" : "shared",
    );
  }
  console.log("PASS: personal and restricted-workspace native publication.");

  const large = file(
      "big.bin",
      Buffer.alloc(UPLOAD_CHUNK_BYTES + 19, 0x31),
      "file",
    ),
    small = file("small.md", "# Resume\n"),
    resumable = await begin(workspace.space_id, [large.entry, small.entry]);
  const base = await transfer(resumable.batch, large, 1);
  const accepted = await api<{ chunks: { part: number; sha256: string }[] }>(
    base,
  );
  assert.equal(accepted.chunks.length, 1);
  await api(base + "/complete", "POST", {}, 409);
  assert.equal(await published([large.entry.id, small.entry.id]), 0);
  const chunk = large.body.subarray(0, UPLOAD_CHUNK_BYTES);
  await api(base + "/chunks/1", "PUT", Buffer.alloc(chunk.length, 0x32), 409);
  // A new client owns no transfer memory; only the authenticated cookie survives.
  const restarted = api.fork();
  assert.equal(
    (
      await restarted<WorkspaceImportBatch>(
        `/api/v1/spaces/${workspace.space_id}/imports/${resumable.batch.id}`,
      )
    ).entries.find((e) => e.id === large.entry.id)!.received,
    UPLOAD_CHUNK_BYTES,
  );
  await transfer(resumable.batch, large);
  await transfer(resumable.batch, small);
  assert.equal(
    (
      await wait(
        resumable.batch,
        (b) => b.status === "complete",
        "resumed publication",
      )
    ).status,
    "complete",
  );
  console.log(
    "PASS: interrupted multi-part transfer, receipt persistence across a new client, exact retries, wrong-original rejection and resume.",
  );

  const changedNote = file("Changed.md", "# Incoming\n"),
    changed = await begin(workspace.space_id, [changedNote.entry], "markdown");
  await api(
    "/api/v1/resources",
    "POST",
    {
      kind: "note",
      spaceId: workspace.space_id,
      name: "Changed",
      body: "Retained existing note",
    },
    201,
  );
  await transfer(changed.batch, changedNote);
  const blocked = await wait(
    changed.batch,
    (b) => b.status === "blocked",
    "changed destination",
  );
  assert.match(blocked.error ?? "", /destination changed/i);
  assert.equal(await published([changedNote.entry.id]), 0);
  const review = await api<WorkspaceImportPreview>(
    `/api/v1/spaces/${workspace.space_id}/imports/preview`,
    "POST",
    changed.manifest,
  );
  assert.equal(review.entries[0].name, "Changed (2)");
  await api(
    `/api/v1/spaces/${workspace.space_id}/imports/${changed.batch.id}/recheck`,
    "POST",
    { fingerprint: review.fingerprint },
  );
  assert.equal(
    (
      await wait(
        changed.batch,
        (b) => b.status === "complete",
        "reviewed destination",
      )
    ).result!.resources[0].name,
    "Changed (2)",
  );
  const kept = (
    await query(
      "SELECT n.body FROM notes n JOIN resources r ON r.note_id=n.id WHERE n.title='Changed' AND r.space_id=$1",
      [workspace.space_id],
    )
  )[0];
  assert.equal(kept.body, "Retained existing note");
  console.log(
    "PASS: changed destination freezes private content; explicit recheck keeps both without overwriting.",
  );

  const quota = file("Quota.md", "# Quota\n"),
    quotaManifest = { source: "markdown", entries: [quota.entry] };
  await query("UPDATE spaces SET quota_bytes=1 WHERE id=$1", [teamId]);
  const qp = await api<WorkspaceImportPreview>(
    `/api/v1/spaces/${workspace.space_id}/imports/preview`,
    "POST",
    quotaManifest,
  );
  const deniedId = randomUUID();
  await api(
    `/api/v1/spaces/${workspace.space_id}/imports`,
    "POST",
    { id: deniedId, manifest: quotaManifest, fingerprint: qp.fingerprint },
    413,
  );
  assert.equal(
    (await query("SELECT id FROM workspace_imports WHERE id=$1", [deniedId]))
      .length,
    0,
  );
  await query("UPDATE spaces SET quota_bytes=NULL WHERE id=$1", [teamId]);
  const readyQuota = await begin(workspace.space_id, [quota.entry], "markdown");
  await query("UPDATE spaces SET quota_bytes=1 WHERE id=$1", [teamId]);
  await transfer(readyQuota.batch, quota);
  assert.equal(
    (
      await wait(
        readyQuota.batch,
        (b) => b.status === "blocked",
        "quota changed before publication",
      )
    ).status,
    "blocked",
  );
  assert.equal(await published([quota.entry.id]), 0);
  await cancel(readyQuota.batch);
  await query("UPDATE spaces SET quota_bytes=NULL WHERE id=$1", [teamId]);
  const revoke = file("Revoked.md", "# Owned draft\n"),
    rev = await begin(workspace.space_id, [revoke.entry], "markdown");
  await query(
    "UPDATE members SET role='member',content_role='viewer' WHERE group_id=$1 AND user_id=$2",
    [group.id, ownerId],
  );
  await query(
    "UPDATE project_members SET role='viewer' WHERE project_id=(SELECT project_id FROM spaces WHERE id=$1) AND user_id=$2",
    [workspace.space_id, ownerId],
  );
  await api(
    `/api/v1/spaces/${workspace.space_id}/imports/${rev.batch.id}/entries/${revoke.entry.id}/prepare`,
    "POST",
    {},
    404,
  );
  assert.equal((await state(rev.batch)).status, "preparing");
  await other(
    `/api/v1/spaces/${workspace.space_id}/imports/${rev.batch.id}`,
    "GET",
    undefined,
    404,
  );
  assert.equal((await cancel(rev.batch)).status, "cancelled");
  assert.equal(await published([revoke.entry.id]), 0);
  await query(
    "UPDATE members SET role='owner',content_role='editor' WHERE group_id=$1 AND user_id=$2",
    [group.id, ownerId],
  );
  await query(
    "UPDATE project_members SET role='editor' WHERE project_id=(SELECT project_id FROM spaces WHERE id=$1) AND user_id=$2",
    [workspace.space_id, ownerId],
  );
  console.log(
    "PASS: quota reservation rollback, publication-time quota recheck, access revocation and owner-only cancellation after revocation.",
  );

  const bad = file("Invalid.md", new Uint8Array([0xff]));
  const invalid = await begin(workspace.space_id, [bad.entry], "markdown");
  await transfer(invalid.batch, bad);
  const rejected = await wait(
    invalid.batch,
    (b) => b.entries[0].status === "failed",
    "UTF-8 rejection",
  );
  assert.match(rejected.entries[0].error ?? "", /UTF-8/);
  assert.equal(await published([bad.entry.id]), 0);
  await cancel(invalid.batch);
  const expiryFile = file("Expired.md", "# Expired\n"),
    expiry = await begin(workspace.space_id, [expiryFile.entry], "markdown");
  await query(
    "UPDATE workspace_imports SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expiry.batch.id],
  );
  await query(
    "UPDATE upload_sessions SET expires_at=now()-interval '1 second' WHERE import_entry_id=$1",
    [expiryFile.entry.id],
  );
  await expireWorkspaceImports();
  assert.equal((await state(expiry.batch)).status, "cancelled");
  assert.equal(await published([expiryFile.entry.id]), 0);
  console.log(
    "PASS: strict UTF-8 validation, expiry and cancellation leave no published resources.",
  );

  const first = file("Rollback/first.md", "# Rollback first\n"),
    last = file("Rollback/last.bin", "fixture", "file"),
    rollback = await begin(workspace.space_id, [
      folder("Rollback"),
      first.entry,
      last.entry,
    ]);
  const suffix = randomUUID().replaceAll("-", ""),
    functionName = `axiom_import_test_${suffix}`;
  await query(
    `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Isolated atomic rollback fixture'; END $$`,
  );
  await query(
    `CREATE TRIGGER ${functionName} BEFORE INSERT ON resources FOR EACH ROW WHEN (NEW.id='${last.entry.id}'::uuid) EXECUTE FUNCTION ${functionName}()`,
  );
  try {
    await transfer(rollback.batch, first);
    await transfer(rollback.batch, last);
    await wait(
      rollback.batch,
      (b) => b.status === "publishing",
      "rollback preparation",
    );
    await assert.rejects(
      () => finishWorkspaceImport(rollback.batch.id),
      /atomic rollback fixture/,
    );
    assert.equal(
      await published(rollback.manifest.entries.map((e) => e.id)),
      0,
    );
    assert.equal(
      (
        await query("SELECT room FROM documents WHERE note_id=$1", [
          first.entry.id,
        ])
      ).length,
      0,
    );
    await cancel(rollback.batch);
  } finally {
    await query(`DROP TRIGGER ${functionName} ON resources`);
    await query(`DROP FUNCTION ${functionName}()`);
  }
  console.log(
    "PASS: a real database failure after earlier inserts rolls back folders, notes, Yjs documents and files as one transaction.",
  );

  const raceFile = file("Race.md", "# Cancellation race\n"),
    race = await begin(workspace.space_id, [raceFile.entry], "markdown");
  await transfer(race.batch, raceFile);
  const raceCancel = await cancel(race.batch);
  const count = await published([raceFile.entry.id]);
  assert(["cancelled", "complete"].includes(raceCancel.status));
  assert.equal(count, raceCancel.status === "complete" ? 1 : 0);
  console.log(
    "PASS: cancel-versus-publication produces either the whole receipt or no resources, never a partial import.",
  );

  const removable = await api(
    "/api/v1/spaces",
    "POST",
    {
      groupId: group.id,
      name: "Disposable import lifecycle",
      audience: "group",
    },
    201,
  );
  const pendingManifest: ImportManifest = {
    source: "folder",
    parentId: null,
    conflict: "keepBoth",
    entries: [folder("Pending empty folder")],
  };
  const pendingPreview = await api<WorkspaceImportPreview>(
    `/api/v1/spaces/${removable.space_id}/imports/preview`,
    "POST",
    pendingManifest,
  );
  const pendingId = randomUUID();
  // A synthetic blocked folder-only batch has no upload_session row. It must
  // still protect the workspace. No worker is queued for this isolated fixture.
  await query(
    "INSERT INTO workspace_imports(id,owner_id,space_id,manifest,manifest_hash,preview_hash,plan,status) VALUES($1,$2,$3,$4,$5,$6,$7,'blocked')",
    [
      pendingId,
      ownerId,
      removable.space_id,
      JSON.stringify(pendingManifest),
      digest(canonicalImportJson(pendingManifest)),
      pendingPreview.fingerprint,
      JSON.stringify(pendingPreview.entries),
    ],
  );
  const pendingEntry = pendingManifest.entries[0];
  await query(
    "INSERT INTO workspace_import_entries(id,batch_id,path,kind,digest) VALUES($1,$2,$3,$4,$5)",
    [
      pendingEntry.id,
      pendingId,
      pendingEntry.path,
      pendingEntry.kind,
      pendingEntry.digest,
    ],
  );
  const pending = await api<WorkspaceImportBatch>(
    `/api/v1/spaces/${removable.space_id}/imports/${pendingId}`,
  );
  const lifecycle = `/api/v1/spaces/${removable.space_id}`;
  const change = async (action: string, expected = 200) => {
    const { space } = await api(lifecycle);
    return api(
      `${lifecycle}/${action}`,
      "POST",
      {
        version: space.version,
        confirmation: space.name,
        mutationId: randomUUID(),
      },
      expected,
    );
  };
  await change("trash");
  const impact = await api(lifecycle + "/lifecycle");
  assert.deepEqual(
    impact.blockers
      .filter((b: { kind: string }) => b.kind === "transfers")
      .map((b: { count: number }) => b.count),
    [1],
  );
  await change("purge", 409);
  assert.equal((await cancel(pending)).status, "cancelled");
  await change("restore");
  const finishedFile = file("Finished/Empty.md"),
    finished = await begin(removable.space_id, [
      folder("Finished"),
      finishedFile.entry,
    ]);
  await transfer(finished.batch, finishedFile);
  await wait(
    finished.batch,
    (b) => b.status === "complete",
    "disposable native publication",
  );
  assert.equal(
    (
      await query("SELECT id FROM upload_sessions WHERE import_entry_id=$1", [
        finishedFile.entry.id,
      ])
    ).length,
    1,
  );
  await change("trash");
  const queued = await change("purge", 202);
  for (let attempt = 0; ; attempt++) {
    try {
      await purgeSpace(removable.space_id, ownerId, queued.space.version);
      break;
    } catch (error) {
      if (
        attempt >= 15 ||
        !(error instanceof Error) ||
        !error.message.includes("synchronizing")
      )
        throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
  }
  await purgeSpace(removable.space_id, ownerId, queued.space.version);
  for (const table of [
    "spaces",
    "workspace_imports",
    "upload_sessions",
    "resources",
  ])
    assert.equal(
      (
        await query(
          `SELECT id FROM ${table} WHERE ${table === "spaces" ? "id" : "space_id"}=$1`,
          [removable.space_id],
        )
      ).length,
      0,
    );
  assert.equal(
    (await query("SELECT id FROM groups WHERE id=$1", [group.id])).length,
    1,
  );
  assert.equal(
    (await query("SELECT id FROM spaces WHERE id=$1", [workspace.space_id]))
      .length,
    1,
  );
  console.log(
    "PASS: folder-only private imports protect workspace removal; finished/cancelled batches do not block authorized purge or delete sibling workspaces.",
  );
  assert.equal(IMPORT_LIMITS.entries, 2000);
  console.log(
    "Workspace import API acceptance passed. Only synthetic isolated data was changed.",
  );
} finally {
  await pool.end();
}
