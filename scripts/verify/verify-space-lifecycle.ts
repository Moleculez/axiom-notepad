import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { pool, query } from "../../packages/shared/src/db";
import { purgeSpace } from "../../packages/shared/src/space-lifecycle";
import { deleteUnusedBlob } from "../../packages/shared/src/resource-operations";
import { getAttachment } from "../../packages/shared/src/storage";

// This script permanently removes only freshly created verification scopes.
// Refuse production and require an explicitly isolated test database.
const database = new URL(process.env.DATABASE_URL!),
  origin = process.env.TEST_APP_URL!;
assert(
  /(?:test|verification)/.test(database.pathname),
  "Use an isolated test database.",
);
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(
  new URL(origin).port === "3002",
  "Use the isolated web service on port 3002.",
);
let cookie = "";
async function api(
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const response = await fetch(origin + path, {
    method,
    headers: { origin, cookie, "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (response.headers.getSetCookie().length)
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  const result = await response.json();
  assert(response.ok, `${path}: ${response.status} ${result.error ?? ""}`);
  return result;
}
try {
  const login = await api("/api/auth/sign-in/email", {
    email: process.env.TEST_OWNER_EMAIL ?? "researcher@axiom.local",
    password: process.env.TEST_OWNER_PASSWORD ?? "AxiomResearch2026!",
  });
  const group = await api("/api/v1/groups", {
    name: "Lifecycle verification " + randomUUID().slice(0, 8),
  });
  const spaces = await api("/api/v1/spaces"),
    team = spaces.find(
      (s: any) => s.group_id === group.id && s.kind === "team",
    ),
    personal = spaces.find((s: any) => s.kind === "personal");
  const project = await api("/api/v1/projects", {
    groupId: group.id,
    name: "Owned child scope",
  });
  const shared = await api("/api/v1/notes", {
    groupId: group.id,
    title: "Owned shared work",
    body: "Owned source.",
  });
  const privateNote = await api("/api/v1/notes", {
    groupId: group.id,
    title: "Private work survives",
    visibility: "private",
    body: "Personal mathematics [@retained].",
  });
  await api("/api/v1/references", {
    groupId: group.id,
    citeKey: "retained",
    title: "Retained citation metadata",
  });
  const before = (
    await query(
      "SELECT n.body,d.state FROM notes n JOIN documents d ON d.note_id=n.id WHERE n.id=$1",
      [privateNote.id],
    )
  )[0];
  async function upload(name: string, body: string) {
    const data = new FormData();
    data.append("file", new File([body], name, { type: "text/plain" }));
    const response = await fetch(
      `${origin}/api/v1/notes/${shared.id}/attachments`,
      { method: "POST", headers: { origin, cookie }, body: data },
    );
    assert(response.ok, "Fixture file upload failed");
    const attachment = await response.json();
    return (
      await query(
        "SELECT a.*,v.resource_id,r.version FROM attachments a JOIN file_versions v ON v.id=a.id JOIN resources r ON r.id=v.resource_id WHERE a.id=$1",
        [attachment.id],
      )
    )[0];
  }
  const moved = await upload(
      "moved-evidence.txt",
      "Evidence now owned by personal space.",
    ),
    owned = await upload("owned-evidence.txt", "Eligible owned file.");
  await api(`/api/v1/resources/${moved.resource_id}/transfer`, {
    version: moved.version,
    destinationSpaceId: personal.id,
    parentId: null,
    confirmAudience: true,
  });
  const blocker = await api("/api/v1/notes", {
    groupId: group.id,
    title: "Outside reference blocker",
    visibility: "private",
    body: `[Retained evidence](/api/v1/attachments/${owned.id})`,
  });
  async function state() {
    return (await api("/api/v1/spaces?manage=1")).find(
      (s: any) => s.id === team.id,
    );
  }
  async function change(action: string) {
    const current = await state();
    return api(`/api/v1/spaces/${team.id}/${action}`, {
      version: current.version,
      confirmation: current.name,
      mutationId: randomUUID(),
    });
  }
  await change("trash");
  const impact = await api(`/api/v1/spaces/${team.id}/lifecycle`);
  assert(
    impact.blockers.some((item: any) => item.kind === "external_files"),
    "Outside evidence must block removal",
  );
  const blocked = await fetch(`${origin}/api/v1/spaces/${team.id}/purge`, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({
      version: (await state()).version,
      confirmation: team.name,
    }),
  });
  assert.equal(blocked.status, 409);
  assert.equal(
    (await getAttachment(owned.storage_key)).toString(),
    "Eligible owned file.",
  );
  const blockerResource = await api(`/api/v1/resources/${blocker.id}`);
  await api(`/api/v1/resources/${blocker.id}/trash`, {
    version: blockerResource.version,
  });
  const deleted = await api(`/api/v1/resources/${blocker.id}`);
  await api(`/api/v1/resources/${blocker.id}/purge`, {
    version: deleted.version,
    confirmation: "DELETE FOREVER",
  });
  const queued = await change("purge");
  for (let attempt = 0; ; attempt++)
    try {
      await purgeSpace(team.id, login.user.id, queued.space.version);
      break;
    } catch (error) {
      if (
        attempt >= 15 ||
        !(error instanceof Error) ||
        !error.message.includes("synchronizing")
      )
        throw error;
      await delay(1000);
    }
  // A retried worker with the same lease payload is harmless after completion.
  await purgeSpace(team.id, login.user.id, queued.space.version);
  assert.equal(
    (await query("SELECT id FROM groups WHERE id=$1", [group.id])).length,
    0,
  );
  assert.equal(
    (await query("SELECT id FROM projects WHERE id=$1", [project.id])).length,
    0,
  );
  assert.equal(
    (await query("SELECT id FROM notes WHERE id=$1", [shared.id])).length,
    0,
  );
  assert.equal(
    (await query("SELECT id FROM attachments WHERE id=$1", [owned.id])).length,
    0,
  );
  assert.equal(
    (
      await query("SELECT space_id FROM space_tombstones WHERE group_id=$1", [
        group.id,
      ])
    ).length,
    2,
  );
  const after = (
    await query(
      "SELECT n.body,d.state FROM notes n JOIN documents d ON d.note_id=n.id WHERE n.id=$1",
      [privateNote.id],
    )
  )[0];
  assert.equal(after.body, before.body);
  assert.deepEqual(after.state, before.state);
  assert.equal(
    (
      await query("SELECT cite_key FROM personal_citations WHERE note_id=$1", [
        privateNote.id,
      ])
    )[0].cite_key,
    "retained",
  );
  assert.equal(
    (await getAttachment(moved.storage_key)).toString(),
    "Evidence now owned by personal space.",
  );
  await deleteUnusedBlob(owned.storage_key);
  await assert.rejects(getAttachment(owned.storage_key));
  assert.equal(
    (await getAttachment(moved.storage_key)).toString(),
    "Evidence now owned by personal space.",
  );
  console.log(
    "PASS: external evidence blocks removal; owner purge is idempotent; tombstones persist; personal Markdown/CRDT/citations and moved files survive; only unreferenced owned blobs are removed.",
  );
} finally {
  await pool.end();
}
