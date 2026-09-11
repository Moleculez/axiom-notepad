import "dotenv/config";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  realpath,
  rename,
  rmdir,
  writeFile,
  access,
  unlink,
} from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { developmentResetTargets } from "../../packages/shared/src/development-reset";
import { migrateDatabase } from "../../packages/shared/src/migrate-database";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  args = process.argv.slice(2);
const target = developmentResetTargets(
  root,
  process.env.DATABASE_URL ?? "",
  process.env.STORAGE_PATH ?? resolve(root, "data/attachments"),
  process.env.STORAGE_DRIVER,
  process.env.NODE_ENV === "production",
);
if ((await realpath(target.storage)) !== target.storage)
  throw new Error(
    "The attachment directory must not be a symlink or redirected path.",
  );
const execute = args.includes("--confirm-main-development-purge"),
  backup = resolve(
    root,
    "data",
    `before-development-reset-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
if (!execute) {
  console.log(
    `Dry run only. Target: ${target.database}@${target.host}:${target.port}\nStorage: ${target.storage}\nStop the main web/sync/worker services, then pass --confirm-main-development-purge. A new verified backup is mandatory; test databases, code, .env and existing backups are never removed.`,
  );
  process.exit(0);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const run = (operation: string) =>
  new Promise<void>((done, fail) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/ops/backup.ts", operation, backup],
      { cwd: root, env: process.env, stdio: "inherit" },
    );
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0
        ? done()
        : fail(
            new Error(
              `Backup ${operation} failed; development data was not reset.`,
            ),
          ),
    );
  });
let moved = false,
  committed = false,
  tokenWritten = false,
  previousTokenMoved = false;
const retired = join(backup, "retired-development-storage"),
  tokenFile = join(root, "data/development-setup-token.txt"),
  previousToken = join(backup, "previous-development-setup-token.txt");
try {
  const {
    rows: [active],
  } = await client.query(
    "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname='axiom' AND pid<>pg_backend_pid() AND backend_type='client backend'",
  );
  if (active.count)
    throw new Error(
      "Main development database connections are still open. Stop only the main web, sync and worker processes before resetting.",
    );
  await run("create");
  await run("verify");
  const token = randomBytes(32).toString("base64url"),
    hash = createHash("sha256").update(token).digest("hex");
  await client.query("BEGIN");
  await client.query("DROP SCHEMA public CASCADE");
  await client.query("CREATE SCHEMA public");
  await migrateDatabase(client);
  const {
    rows: [instance],
  } = await client.query(
    "UPDATE app_instance SET setup_token_hash=$1 RETURNING dataset_id",
    [hash],
  );
  await rename(target.storage, retired);
  moved = true;
  await mkdir(target.storage, { mode: 0o700 });
  try {
    await access(tokenFile);
    await rename(tokenFile, previousToken);
    previousTokenMoved = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(tokenFile, token + "\n", { mode: 0o600, flag: "wx" });
  tokenWritten = true;
  await client.query("COMMIT");
  committed = true;
  await writeFile(
    join(backup, "reset-receipt.json"),
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        database: target.database,
        newDatasetId: instance.dataset_id,
        activeStorage: target.storage,
        retiredStorage: retired,
        setupTokenFile: tokenFile,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    `Main development data reset. New dataset: ${instance.dataset_id}\nVerified backup: ${backup}\nPrevious storage retained: ${retired}\nOne-time setup token: ${tokenFile}\nRestart development services and open http://localhost:8080. No owner or demo content has been created.`,
  );
} catch (error) {
  if (!committed) {
    await client.query("ROLLBACK").catch(() => {});
    if (moved) {
      await rmdir(target.storage).catch(() => {});
      await rename(retired, target.storage);
    }
    if (tokenWritten) await unlink(tokenFile);
    if (previousTokenMoved) await rename(previousToken, tokenFile);
  }
  throw error;
} finally {
  await client.end();
}
