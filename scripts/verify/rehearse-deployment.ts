import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

// Own fresh Compose project and named volumes; never imports the local .env.
const root = process.cwd();
await mkdir(resolve("data"), { recursive: true });
const directory = await mkdtemp(resolve("data/deployment-rehearsal-"));
const project = "axiom-rehearsal-" + randomBytes(5).toString("hex");
const password = randomBytes(32).toString("hex");
const values = {
  APP_URL: "https://localhost:8443",
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  SYNC_SECRET: randomBytes(32).toString("hex"),
  POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
  AXIOM_DATABASE_PASSWORD: password,
  AXIOM_HTTP_PORT: "127.0.0.1:8181",
  AXIOM_HTTPS_PORT: "127.0.0.1:8443",
  // Let Docker allocate a loopback port instead of competing with local dev sync.
  AXIOM_SYNC_HOST_PORT: "0",
  AXIOM_IMAGE: process.env.AXIOM_REHEARSAL_IMAGE ?? "axiom:rehearsal",
  AXIOM_OPERATIONS_IMAGE:
    process.env.AXIOM_REHEARSAL_OPERATIONS_IMAGE ??
    "axiom-operations:rehearsal",
};
const file = join(directory, "compose.env");
await writeFile(
  file,
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { mode: 0o600, flag: "wx" },
);
const env = {
  ...process.env,
  ...values,
  AXIOM_ADMIN_PASSWORD: randomBytes(24).toString("base64url"),
  TEST_OWNER_EMAIL: "owner@axiom.test",
  TEST_APP_URL: values.APP_URL,
  AXIOM_REHEARSAL_DIR: directory,
  RESTORE_DATABASE_URL: `postgresql://axiom:${password}@db:5432/axiom_recovered`,
};
const testEnv: NodeJS.ProcessEnv = {
  ...env,
  TEST_OWNER_PASSWORD: env.AXIOM_ADMIN_PASSWORD,
};
await writeFile(
  join(directory, "test.env"),
  Object.entries({
    TEST_APP_URL: values.APP_URL,
    TEST_OWNER_EMAIL: env.TEST_OWNER_EMAIL,
    TEST_OWNER_PASSWORD: env.AXIOM_ADMIN_PASSWORD,
    AXIOM_REHEARSAL_DIR: directory,
  })
    .map(([k, v]) => `${k}=${v}`)
    .join("\n"),
  { mode: 0o600, flag: "wx" },
);
const compose = [
  "compose",
  "--project-name",
  project,
  "--env-file",
  file,
  "-f",
  "compose.yaml",
  "-f",
  "deploy/docker/compose.rehearsal.yaml",
];
async function run(binary: string, args: string[]) {
  await new Promise<void>((done, fail) => {
    const child = spawn(binary, args, {
      cwd: root,
      env: testEnv,
      stdio: "inherit",
    });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0
        ? done()
        : fail(
            new Error(
              `${binary} command failed (${code ?? "signal"}). Rehearsal retained: ${directory}`,
            ),
          ),
    );
  });
}
const docker = (args: string[]) => run("docker", [...compose, ...args]);
const checks: string[] = [];
await writeFile(
  join(directory, "receipt.json"),
  JSON.stringify(
    {
      project,
      directory,
      status: "running",
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  `Isolated deployment rehearsal: ${project}. Private configuration/evidence: ${directory}`,
);
try {
  await docker(["config", "--quiet"]);
  await docker(["build", "db", "web", "operations"]);
  await docker(["up", "-d", "--wait", "--wait-timeout", "180"]);
  const { stdout } = await promisify(execFile)(
    "docker",
    [...compose, "port", "sync", "1234"],
    { cwd: root, env: testEnv },
  );
  const syncAddress = stdout.trim();
  if (!/^127\.0\.0\.1:[1-9]\d{0,4}$/.test(syncAddress))
    throw new Error("Sync must publish exactly one host-loopback port.");
  const syncHealth = await fetch(`http://${syncAddress}/health`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!syncHealth.ok || (await syncHealth.json()).service !== "sync")
    throw new Error("Published synchronization health check failed.");
  checks.push("loopback-only host synchronization health");
  await docker([
    "exec",
    "-T",
    "-e",
    "AXIOM_ADMIN_PASSWORD",
    "web",
    "node",
    "--import",
    "tsx",
    "scripts/ops/admin.ts",
    "--email",
    env.TEST_OWNER_EMAIL,
    "--name",
    "Deployment Owner",
  ]);
  checks.push("fresh migration, health and first owner");
  testEnv.TEST_DEPLOYMENT_PHASE = "workflow";
  await run(process.execPath, [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "deployment.config.ts",
    "--grep",
    "fresh production",
  ]);
  checks.push(
    "HTTPS, invitation/join, collaboration, file checksums/preview, Canvas, Trash and background export",
  );
  await docker(["restart", "web", "sync", "worker"]);
  await docker(["up", "-d", "--wait", "--wait-timeout", "180"]);
  testEnv.TEST_DEPLOYMENT_PHASE = "restart";
  await run(process.execPath, [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "deployment.config.ts",
    "--grep",
    "survives service restart",
  ]);
  checks.push("restart persistence");
  await docker([
    "run",
    "--rm",
    "operations",
    "node",
    "--import",
    "tsx",
    "scripts/ops/backup.ts",
    "create",
    "/backups/verified",
  ]);
  await docker([
    "run",
    "--rm",
    "operations",
    "node",
    "--import",
    "tsx",
    "scripts/ops/backup.ts",
    "verify",
    "/backups/verified",
  ]);
  await docker([
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "CREATE DATABASE axiom_recovered OWNER axiom",
  ]);
  await docker([
    "run",
    "--rm",
    "-e",
    "RESTORE_DATABASE_URL",
    "-e",
    "STORAGE_PATH=/restore/attachments",
    "operations",
    "node",
    "--import",
    "tsx",
    "scripts/ops/backup.ts",
    "restore",
    "/backups/verified",
  ]);
  checks.push("database/blob backup verification and isolated restore");
  const expected = JSON.parse(
    await readFile(join(directory, "content.json"), "utf8"),
  );
  await docker([
    "run",
    "--rm",
    "-e",
    "RESTORE_DATABASE_URL",
    "operations",
    "node",
    "--input-type=module",
    "-e",
    `import pg from 'pg'; import assert from 'node:assert/strict'; import {readFile} from 'node:fs/promises'; import {createHash} from 'node:crypto';
const expected=${JSON.stringify(expected)};
const client=new pg.Client({connectionString:process.env.RESTORE_DATABASE_URL}); await client.connect();
try {
  const note=(await client.query('SELECT body FROM notes WHERE id=$1',[expected.note])).rows[0]; assert.equal(note.body,expected.body);
  const canvas=(await client.query('SELECT body FROM notes WHERE id=$1',[expected.canvas])).rows[0]; assert.ok(JSON.parse(canvas.body).nodes[0].text.includes('A preserved card.'));
  const manifest=JSON.parse(await readFile('/backups/verified/manifest.json','utf8'));
  assert.ok(manifest.attachments.length>0);
  for(const file of manifest.attachments){assert.match(file.key,/^[a-f0-9-]{36}$/);const bytes=await readFile('/restore/attachments/'+file.key);assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
  console.log('Restored note, Canvas and all '+manifest.attachments.length+' blob checksums verified.');
} finally {await client.end();}`,
  ]);
  checks.push("restored canonical note/Canvas content and every blob checksum");
  await writeFile(
    join(directory, "receipt.json"),
    JSON.stringify(
      {
        project,
        directory,
        status: "passed",
        completedAt: new Date().toISOString(),
        checks,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "Deployment rehearsal passed. Stop the isolated services with the project and env-file in the receipt; named test volumes and backup are retained, never auto-deleted.",
  );
} catch (error) {
  await writeFile(
    join(directory, "receipt.json"),
    JSON.stringify(
      {
        project,
        directory,
        status: "failed",
        checkedAt: new Date().toISOString(),
        checks,
        error: String(error),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  throw error;
}
