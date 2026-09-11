import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

// Deliberate fault injection is permitted only against a local, disposable DB.
const origin =
  process.env.TEST_APP_URL ?? process.env.APP_URL ?? "http://localhost:8080";
const database = new URL(process.env.DATABASE_URL!);
for (const hostname of [new URL(origin).hostname, database.hostname])
  assert(
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname),
    "Run this verification against local test services only.",
  );
const admin = new pg.Client({ connectionString: database.toString() });
await admin.connect();
const role = "axiom_verify_" + randomBytes(6).toString("hex");
const password = randomBytes(24).toString("hex");
const syncDatabase = new URL(database);
syncDatabase.username = role;
syncDatabase.password = password;
const port = Number(process.env.TEST_SYNC_PORT ?? 1235);
let processHandle: ChildProcess | undefined;
let groupId: string | undefined;
let cookie = "";
let provider: HocuspocusProvider | undefined;
let doc: Y.Doc | undefined;
let roleCreated = false;
let logs = "";

async function api(path: string, data?: unknown) {
  const response = await fetch(origin + path, {
    method: data === undefined ? "GET" : "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (response.headers.getSetCookie().length)
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  assert(response.ok, `API ${path}: ${response.status}`);
  return response.json();
}
async function stop(signal: NodeJS.Signals = "SIGKILL") {
  provider?.destroy();
  provider = undefined;
  doc?.destroy();
  doc = undefined;
  const child = processHandle;
  processHandle = undefined;
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill(signal);
  let forced = false;
  const timer = setTimeout(() => {
    forced = true;
    child.kill("SIGKILL");
  }, 6000);
  await exited;
  clearTimeout(timer);
  assert(!forced, "Graceful synchronization shutdown timed out.");
}
async function start() {
  // Refuse to interact with another service using the selected port.
  if (
    await fetch(`http://127.0.0.1:${port}/health`)
      .then(() => true)
      .catch(() => false)
  )
    throw new Error(`Port ${port} is occupied. Choose a free TEST_SYNC_PORT.`);
  logs = "";
  processHandle = spawn(
    process.execPath,
    ["--import", "tsx", "apps/sync/src/server.ts"],
    {
      env: {
        ...process.env,
        DATABASE_URL: syncDatabase.toString(),
        SYNC_PORT: String(port),
        SYNC_HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  processHandle.stdout?.on("data", (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-4000);
  });
  processHandle.stderr?.on("data", (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-4000);
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (processHandle.exitCode !== null)
      throw new Error("Test sync service exited: " + logs);
    if (
      await fetch(`http://127.0.0.1:${port}/health`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      return;
    await delay(100);
  }
  throw new Error("Test sync service did not become healthy: " + logs);
}
async function connect(noteId: string) {
  const token = await api(`/api/v1/notes/${noteId}/sync-token`, {});
  doc = new Y.Doc();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Synchronization timeout: " + logs)),
      10000,
    );
    provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name: token.room,
      token: token.token,
      document: doc!,
      onSynced: () => {
        clearTimeout(timer);
        resolve();
      },
      onAuthenticationFailed: ({ reason }) => {
        clearTimeout(timer);
        reject(new Error(reason));
      },
    });
  });
}
async function save(expected: "persisted" | "save-error") {
  const id = randomUUID();
  const active = provider!;
  await new Promise<void>((resolve, reject) => {
    const done = ({ payload }: { payload: string }) => {
      const message = JSON.parse(payload);
      if (message.id !== id) return;
      clearTimeout(timer);
      active.off("stateless", done);
      try {
        assert.equal(message.type, expected);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    const timer = setTimeout(() => {
      active.off("stateless", done);
      reject(new Error("Save acknowledgement timed out: " + logs));
    }, 10000);
    active.on("stateless", done);
    active.sendStateless(JSON.stringify({ type: "save-check", id }));
  });
}

try {
  await api("/api/auth/sign-in/email", {
    email: "researcher@axiom.local",
    password: "AxiomResearch2026!",
  });
  groupId = (
    await api("/api/v1/groups", {
      name: "Verification durability " + randomUUID().slice(0, 8),
    })
  ).id;
  const note = await api("/api/v1/notes", {
    groupId,
    title: "Crash recovery test",
    body: "Initial state.\n",
  });
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  roleCreated = true;
  await admin.query(
    `GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
  );
  await start();
  await connect(note.id);
  doc!.getText("markdown").insert(0, "Acknowledged before crash.\n");
  await save("persisted");
  const acknowledged = doc!.getText("markdown").toString();
  await stop();
  await start();
  await connect(note.id);
  assert.equal(doc!.getText("markdown").toString(), acknowledged);
  console.log(
    "PASS: acknowledged text survives an abrupt synchronization-process crash.",
  );

  await admin.query(`REVOKE INSERT,UPDATE ON documents FROM ${role}`);
  doc!.getText("markdown").insert(0, "Journal-only recovery.\n");
  await save("save-error");
  const journaled = doc!.getText("markdown").toString();
  const updates = await admin.query(
    "SELECT count(*) AS n FROM document_updates WHERE room=$1",
    [note.id + ":1"],
  );
  assert(Number(updates.rows[0].n) > 0);
  console.log(
    "PASS: failed snapshot persistence returns save-error, never a success acknowledgment.",
  );
  await stop();
  await admin.query(`GRANT INSERT,UPDATE ON documents TO ${role}`);
  await start();
  await connect(note.id);
  assert.equal(doc!.getText("markdown").toString(), journaled);
  await save("persisted");
  console.log(
    "PASS: binary update journal recovers text absent from the last snapshot.",
  );
  await stop("SIGTERM");
  console.log(
    "PASS: graceful shutdown drains persistence and exits without forced termination.",
  );
} finally {
  await stop().catch((error: unknown) => console.error(error));
  if (groupId) {
    // Personal notes now survive group deletion, so remove our exact temporary
    // fixture notes explicitly instead of relying on the old group cascade.
    await admin.query("DELETE FROM notes WHERE group_id=$1", [groupId]);
    await admin.query("DELETE FROM groups WHERE id=$1", [groupId]);
  }
  if (roleCreated) {
    await admin.query(`DROP OWNED BY ${role}`);
    await admin.query(`DROP ROLE ${role}`);
  }
  if (cookie) await api("/api/auth/sign-out", {}).catch(() => {});
  await admin.end();
  console.log(
    "Temporary verification group, notes, and database role removed.",
  );
}
