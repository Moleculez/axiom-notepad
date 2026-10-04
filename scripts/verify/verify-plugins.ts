import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { query, pool } from "../../packages/shared/src/db";
import { auth } from "../../packages/shared/src/auth";
import { processChangeSet } from "../../packages/shared/src/workspace-change-sets";
import { executeReviewedAction } from "../../apps/web/lib/reviewed-actions";
import { activePluginGrant } from "../../packages/shared/src/plugin-security";
import { pilotPackages } from "../../packages/shared/src/plugin-pilots";
import { makePluginPackage } from "../../packages/shared/src/plugin-package";
import {
  pluginManifestSchema,
  pluginCapabilities,
} from "../../packages/shared/src/plugins";
const database = new URL(process.env.DATABASE_URL!),
  origin = process.env.APP_URL!;
assert.equal(
  database.pathname,
  "/axiom_plugins_test",
  "Only the isolated extension dataset is allowed.",
);
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(new URL(origin).port, "3004");
assert((process.env.STORAGE_PATH ?? "").includes("plugins-test"));
function client() {
  let cookie = "";
  return async (path: string, method = "GET", data?: unknown, status = 200) => {
    const response = await fetch(origin + path, {
      method,
      headers: {
        origin,
        cookie,
        "content-type": Buffer.isBuffer(data)
          ? "application/zip"
          : "application/json",
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
}
const api = client(),
  other = client();
try {
  const login = await api("/api/auth/sign-in/email", "POST", {
    email: "extensions@axiom.local",
    password: "ExtensionsTest2026!",
  });
  const email = "extension-member@axiom.local";
  let [member] = await query('SELECT id FROM "user" WHERE email=$1', [email]);
  if (!member)
    member = (
      await auth.api.signUpEmail({
        body: {
          email,
          name: "Extension member",
          password: "ExtensionsTest2026!",
        },
        headers: new Headers({ "x-axiom-internal": process.env.SYNC_SECRET! }),
      })
    ).user;
  await other("/api/auth/sign-in/email", "POST", {
    email,
    password: "ExtensionsTest2026!",
  });
  const group = await api(
    "/api/v1/groups",
    "POST",
    { name: "Extension acceptance " + randomUUID().slice(0, 6) },
    201,
  );
  await query(
    "INSERT INTO members(group_id,user_id,role,content_role) VALUES($1,$2,'member','editor')",
    [group.id, member.id],
  );
  const spaces = await api("/api/v1/spaces"),
    space = spaces.find(
      (s: any) => s.group_id === group.id && s.kind === "team",
    ),
    personal = spaces.find((s: any) => s.kind === "personal");
  let registry = await api("/api/v1/plugins");
  assert.equal(
    new Set(
      registry.catalog
        .filter((p: any) => p.manifest.id.startsWith("axiom."))
        .map((p: any) => p.manifest.id),
    ).size,
    3,
  );
  const currentJournal = (await pilotPackages()).find(
    (p) => p.manifest.id === "axiom.journal",
  )!;
  const journal = registry.catalog.find(
    (p: any) => p.hash === currentJournal.hash,
  );
  const existing = registry.installations.find(
    (i: any) => i.plugin_id === "axiom.journal",
  );
  if (existing)
    await api("/api/v1/plugins/installations/" + existing.id, "DELETE", {
      revision: existing.revision,
    });
  await api(
    "/api/v1/plugins/installations",
    "POST",
    { packageHash: journal.hash },
    201,
  );
  registry = await api("/api/v1/plugins");
  let installed = registry.installations.find(
    (i: any) => i.plugin_id === "axiom.journal",
  );
  assert.equal(installed.enabled, false);
  await api(
    "/api/v1/plugins/grants",
    "POST",
    {
      installationId: installed.id,
      installationRevision: installed.revision,
      spaceId: personal.id,
      capabilities: journal.manifest.capabilities,
    },
    409,
  );
  await api("/api/v1/plugins/installations/" + installed.id, "PATCH", {
    revision: installed.revision,
    enabled: true,
  });
  registry = await api("/api/v1/plugins");
  installed = registry.installations.find((i: any) => i.id === installed.id);
  await api(
    "/api/v1/plugins/grants",
    "POST",
    {
      installationId: installed.id,
      installationRevision: installed.revision,
      spaceId: space.id,
      capabilities: journal.manifest.capabilities,
    },
    403,
  );
  await api(
    "/api/v1/plugins/approvals",
    "POST",
    {
      groupId: group.id,
      packageHash: journal.hash,
      spaceIds: [personal.id],
      enabled: true,
    },
    400,
  );
  await other(
    "/api/v1/plugins/approvals",
    "POST",
    {
      groupId: group.id,
      packageHash: journal.hash,
      spaceIds: [space.id],
      enabled: true,
    },
    403,
  );
  await api("/api/v1/plugins/approvals", "POST", {
    groupId: group.id,
    packageHash: journal.hash,
    spaceIds: [space.id],
    enabled: true,
  });
  const grant = await api(
    "/api/v1/plugins/grants",
    "POST",
    {
      installationId: installed.id,
      installationRevision: installed.revision,
      spaceId: space.id,
      capabilities: journal.manifest.capabilities,
    },
    201,
  );
  const authority = {
    grantId: grant.id,
    grantRevision: grant.revision,
    packageHash: grant.package_hash,
  };
  const read = (
    method: string,
    args: Record<string, unknown> = {},
    status = 200,
  ) =>
    api("/api/v1/plugins/rpc", "POST", { ...authority, method, args }, status);
  const metadata = await read("resources.list");
  assert.equal(metadata.hasMore, false);
  await read("documents.read", { resourceId: randomUUID() }, 403);
  await read("resources.list", { spaceId: personal.id }, 400);
  await other(
    "/api/v1/plugins/rpc",
    "POST",
    { ...authority, method: "resources.list", args: {} },
    403,
  );
  const start = await api("/api/v1/plugins/runtime/start", "POST", {
    installationId: installed.id,
    spaceId: space.id,
    command: "axiom.journal.open",
  });
  assert(start.bundle.includes("export default"));
  await api(
    "/api/v1/plugins/runtime/start",
    "POST",
    { installationId: installed.id, spaceId: space.id, command: "core.delete" },
    400,
  );
  const name = "Reviewed journal " + randomUUID().slice(0, 6),
    mutationId = randomUUID();
  const proposal = {
    mutationId,
    title: "Create journal",
    spaceIds: [space.id],
    actions: [
      {
        key: "journal",
        action: "file_create",
        spaceId: space.id,
        title: "Create journal",
        payload: {
          type: "markdown",
          name,
          source: "# Journal\n\nReviewed source.",
        },
      },
    ],
  };
  const set = await read("changes.prepare", proposal);
  assert.equal(set.status, "draft");
  assert.equal(
    (
      await query("SELECT id FROM resources WHERE space_id=$1 AND name=$2", [
        space.id,
        name,
      ])
    ).length,
    0,
    "Preparing must not create a file.",
  );
  assert.equal(
    (await read("changes.prepare", proposal)).id,
    set.id,
    "Same proposal retries are idempotent.",
  );
  await read("changes.prepare", { ...proposal, title: "Altered retry" }, 409);
  await read(
    "changes.prepare",
    {
      ...proposal,
      mutationId: randomUUID(),
      actions: [{ ...proposal.actions[0], action: "workspace_purge" }],
    },
    403,
  );
  await read(
    "changes.prepare",
    { ...proposal, mutationId: randomUUID(), spaceIds: [personal.id] },
    403,
  );
  const preview = await api(
    `/api/v1/assistant/change-sets/${set.id}/preview`,
    "POST",
    { version: set.version, keys: ["journal"] },
  );
  await api(
    `/api/v1/assistant/change-sets/${set.id}/apply`,
    "POST",
    { fingerprint: "a".repeat(64), consent: true },
    409,
  );
  await api(
    `/api/v1/assistant/change-sets/${set.id}/apply`,
    "POST",
    { fingerprint: preview.preview.fingerprint, consent: true },
    202,
  );
  await processChangeSet(executeReviewedAction);
  const applied = await api(`/api/v1/assistant/change-sets/${set.id}`);
  assert.equal(applied.status, "complete");
  const [file] = await query(
    "SELECT r.*,n.body FROM resources r JOIN notes n ON n.id=r.note_id WHERE r.space_id=$1 AND r.name=$2",
    [space.id, name],
  );
  assert.equal(file.body, proposal.actions[0].payload.source);
  assert(
    (
      await query(
        "SELECT id FROM audit_events WHERE plugin_grant_id=$1 AND plugin_package_hash=$2",
        [grant.id, grant.package_hash],
      )
    ).length > 0,
    "Native mutations retain plugin attribution.",
  );
  const stale = await read("changes.prepare", {
    ...proposal,
    mutationId: randomUUID(),
    title: "Pending after revoke",
    actions: [
      {
        ...proposal.actions[0],
        payload: { ...proposal.actions[0].payload, name: name + " pending" },
      },
    ],
  });
  const approval = (await api("/api/v1/plugins")).approvals.find(
    (a: any) => a.group_id === group.id && a.plugin_id === "axiom.journal",
  );
  await api("/api/v1/plugins/approvals", "POST", {
    groupId: group.id,
    packageHash: journal.hash,
    spaceIds: [],
    enabled: false,
    revision: approval.revision,
  });
  await read("resources.list", {}, 403);
  await api(
    `/api/v1/assistant/change-sets/${stale.id}/preview`,
    "POST",
    { version: stale.version, keys: ["journal"] },
    403,
  );
  await api("/api/v1/plugins/approvals", "POST", {
    groupId: group.id,
    packageHash: journal.hash,
    spaceIds: [space.id],
    enabled: true,
    revision: approval.revision + 1,
  });
  await read("resources.list", {}, 403); // Reapproval must not revive an old grant.
  const fresh = await api(
    "/api/v1/plugins/grants",
    "POST",
    {
      installationId: installed.id,
      installationRevision: installed.revision,
      spaceId: space.id,
      capabilities: journal.manifest.capabilities,
      grantRevision: grant.revision,
    },
    201,
  );
  await assert.rejects(
    activePluginGrant({
      grantId: grant.id,
      userId: login.user.id,
      packageHash: grant.package_hash,
      revision: grant.revision,
    }),
  );
  await api("/api/v1/plugins/rpc", "POST", {
    ...authority,
    grantRevision: fresh.revision,
    method: "resources.list",
    args: {},
  });
  await query(
    "UPDATE members SET content_role='viewer' WHERE group_id=$1 AND user_id=$2",
    [group.id, login.user.id],
  );
  await api(
    "/api/v1/plugins/rpc",
    "POST",
    {
      ...authority,
      grantRevision: fresh.revision,
      method: "changes.prepare",
      args: { ...proposal, mutationId: randomUUID() },
    },
    404,
  );
  await query(
    "UPDATE members SET content_role='editor' WHERE group_id=$1 AND user_id=$2",
    [group.id, login.user.id],
  );
  await api("/api/v1/plugins/installations/" + installed.id, "PATCH", {
    revision: installed.revision,
    enabled: false,
  });
  await api(
    "/api/v1/plugins/rpc",
    "POST",
    {
      ...authority,
      grantRevision: fresh.revision,
      method: "resources.list",
      args: {},
    },
    403,
  );
  await api(`/api/v1/plugins/proposals/${stale.id}`, "DELETE");
  assert.equal(
    (
      await query("SELECT status FROM workspace_change_sets WHERE id=$1", [
        stale.id,
      ])
    )[0].status,
    "cancelled",
  );
  await other(
    `/api/v1/plugins/proposals/${stale.id}`,
    "DELETE",
    undefined,
    409,
  );

  // An independently imported package exercises all RPC adapters and lifecycle
  // fences, without executing its code or touching the working database.
  const id = "test.lifecycle-" + randomUUID().slice(0, 8);
  const m1 = pluginManifestSchema.parse({
    format: "axiom-plugin",
    apiVersion: 1,
    id,
    name: "Lifecycle acceptance",
    version: "1.0.0",
    description: "Isolated lifecycle fixture",
    author: "Test fixture",
    license: "MIT",
    entry: "main.js",
    capabilities: pluginCapabilities,
    commands: [
      { id: id + ".run", title: "Inspect", description: "Read a snapshot" },
    ],
    settings: [
      { id: "label", label: "Label", type: "text", value: "Default" },
      { id: "removed", label: "Removed", type: "text" },
    ],
  });
  const p1 = await makePluginPackage(m1, "export default {run(){}};");
  await api("/api/v1/plugins/packages", "POST", p1.archive, 201);
  const created = await api(
    "/api/v1/plugins/installations",
    "POST",
    { packageHash: p1.hash },
    201,
  );
  const installationNow = async () =>
    (await api("/api/v1/plugins")).installations.find(
      (i: any) => i.id === created.id,
    );
  let i = await installationNow();
  assert.deepEqual(i.settings, { label: "Default" });
  await other(
    `/api/v1/plugins/installations/${i.id}`,
    "PATCH",
    { revision: i.revision, enabled: true },
    404,
  );
  await api(
    `/api/v1/plugins/installations/${i.id}`,
    "PATCH",
    { revision: i.revision, bindings: { [id + ".run"]: "Mod-k" } },
    400,
  );
  await api(`/api/v1/plugins/installations/${i.id}`, "PATCH", {
    revision: i.revision,
    enabled: true,
    settings: { label: "Saved", removed: "Retain on rollback" },
    bindings: { [id + ".run"]: "Mod-Alt-Shift-F9" },
  });
  i = await installationNow();
  await api("/api/v1/plugins/approvals", "POST", {
    groupId: group.id,
    packageHash: p1.hash,
    spaceIds: [space.id],
    enabled: true,
  });
  const all = await api(
    "/api/v1/plugins/grants",
    "POST",
    {
      installationId: i.id,
      installationRevision: i.revision,
      spaceId: space.id,
      capabilities: m1.capabilities,
    },
    201,
  );
  const rpc = (
    g: any,
    method: string,
    args: Record<string, unknown> = {},
    status = 200,
  ) =>
    api(
      "/api/v1/plugins/rpc",
      "POST",
      {
        grantId: g.id,
        grantRevision: g.revision,
        packageHash: g.package_hash,
        method,
        args,
      },
      status,
    );
  assert.equal(
    (await rpc(all, "documents.read", { resourceId: file.id })).source,
    proposal.actions[0].payload.source,
  );
  assert.equal((await rpc(all, "planning.read")).summary.total, 0);
  assert.deepEqual((await rpc(all, "references.list")).items, []);
  const privateState = await rpc(all, "storage.get");
  await rpc(all, "storage.set", {
    version: privateState.version,
    data: { draft: "Private retained value" },
  });
  await rpc(
    all,
    "storage.set",
    { version: privateState.version, data: { draft: "Overwrite" } },
    409,
  );
  assert.equal(
    (await rpc(all, "storage.get")).data.draft,
    "Private retained value",
  );
  const narrow = await api(
    "/api/v1/plugins/grants",
    "POST",
    {
      installationId: i.id,
      installationRevision: i.revision,
      spaceId: personal.id,
      capabilities: ["resources:read"],
    },
    201,
  );
  await rpc(narrow, "planning.read", {}, 403);
  await rpc(narrow, "documents.read", { resourceId: file.id }, 403);
  // Re-granting a capability cannot revive a revoked proposal's fence.
  const queued = await rpc(all, "changes.prepare", {
    ...proposal,
    mutationId: randomUUID(),
    title: "Queue then revoke",
    actions: [
      {
        ...proposal.actions[0],
        payload: {
          ...proposal.actions[0].payload,
          name: name + " revoked queue",
        },
      },
    ],
  });
  const frozen = await api(
    `/api/v1/assistant/change-sets/${queued.id}/preview`,
    "POST",
    { version: queued.version, keys: ["journal"] },
  );
  await api(
    `/api/v1/assistant/change-sets/${queued.id}/apply`,
    "POST",
    { fingerprint: frozen.preview.fingerprint, consent: true },
    202,
  );
  await api(`/api/v1/plugins/grants/${all.id}`, "DELETE", {
    revision: all.revision,
  });
  await processChangeSet(executeReviewedAction);
  assert.equal(
    (
      await query("SELECT id FROM resources WHERE space_id=$1 AND name=$2", [
        space.id,
        name + " revoked queue",
      ])
    ).length,
    0,
  );

  const m2 = pluginManifestSchema.parse({
    ...m1,
    version: "2.0.0",
    commands: [
      { id: id + ".inspect", title: "New command", description: "Read" },
    ],
    settings: [
      { id: "label", label: "Numeric label", type: "number", value: 7 },
      {
        id: "required",
        label: "Review new configuration",
        type: "text",
        required: true,
      },
    ],
  });
  const p2 = await makePluginPackage(m2, "export default {run(){}};");
  await api("/api/v1/plugins/packages", "POST", p2.archive, 201);
  const collided = await makePluginPackage(
    m2,
    "export default {run(){return 1;}};",
  );
  await api("/api/v1/plugins/packages", "POST", collided.archive, 409);
  await api(
    "/api/v1/plugins/installations",
    "POST",
    { packageHash: p2.hash, expectedRevision: i.revision - 1 },
    409,
  );
  await api(
    "/api/v1/plugins/installations",
    "POST",
    { packageHash: p2.hash, expectedRevision: i.revision },
    201,
  );
  i = await installationNow();
  assert.equal(i.enabled, false);
  assert.equal(i.previous_hash, p1.hash);
  assert.deepEqual(i.settings, { label: 7 });
  assert.deepEqual(i.bindings, {});
  await rpc(narrow, "resources.list", {}, 403);
  await api(
    `/api/v1/plugins/installations/${i.id}`,
    "PATCH",
    { revision: i.revision, enabled: true },
    400,
  );
  await api(`/api/v1/plugins/installations/${i.id}`, "PATCH", {
    revision: i.revision,
    rollback: true,
  });
  i = await installationNow();
  assert.equal(i.package_hash, p1.hash);
  assert.equal(i.enabled, false);
  assert.deepEqual(i.settings, {
    label: "Saved",
    removed: "Retain on rollback",
  });
  assert.deepEqual(i.bindings, { [id + ".run"]: "Mod-Alt-Shift-F9" });
  await api(`/api/v1/plugins/installations/${i.id}`, "PATCH", {
    revision: i.revision,
    enabled: true,
  });
  i = await installationNow();
  const restored = await api(
    "/api/v1/plugins/grants",
    "POST",
    {
      installationId: i.id,
      installationRevision: i.revision,
      spaceId: personal.id,
      capabilities: m1.capabilities,
      grantRevision: narrow.revision + 2,
    },
    201,
  );
  assert.equal(
    (await rpc(restored, "storage.get")).data.draft,
    "Private retained value",
  );
  await api(`/api/v1/plugins/installations/${i.id}`, "DELETE", {
    revision: i.revision,
    clearSettings: true,
  });
  await rpc(restored, "storage.get", {}, 403);
  const [cleared] = await query(
    "SELECT settings,bindings,private_state,previous_settings FROM plugin_installations WHERE id=$1",
    [i.id],
  );
  assert.deepEqual(cleared.settings, {});
  assert.deepEqual(cleared.bindings, {});
  assert.deepEqual(cleared.private_state, {});
  assert.equal(cleared.previous_settings, null);
  const activity = await api("/api/v1/recovery-activity");
  assert(Array.isArray(activity.items));
  assert(!JSON.stringify(activity).includes("Private retained value"));
  console.log(
    "Extension API acceptance passed: exact reviewed Apply/audit, owner/workspace/capability fences, queued revocation, cancel-after-disable, saved snapshots/planning/references, private-state CAS, package identity, update/rollback configuration, shortcut collisions and uninstall cleanup.",
  );
} finally {
  await pool.end();
}
