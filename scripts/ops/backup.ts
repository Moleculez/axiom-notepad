import "dotenv/config";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import {
  attachmentStream,
  putAttachmentStream,
} from "../../packages/shared/src/storage-streams";

const [operation, argument] = process.argv.slice(2);
if (!["create", "restore", "verify"].includes(operation) || !argument)
  throw new Error(
    "Usage: npm run backup -- create|verify|restore /absolute/backup-directory",
  );
const directory = resolve(argument);
async function fingerprint(stream: Readable, destination?: string) {
  const hash = createHash("sha256");
  let bytes = 0;
  if (destination) {
    const digest = new Transform({
      transform(chunk: Buffer, _encoding, next) {
        hash.update(chunk);
        bytes += chunk.length;
        next(null, chunk);
      },
    });
    await pipeline(
      stream,
      digest,
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    );
  } else
    for await (const chunk of stream) {
      hash.update(chunk);
      bytes += chunk.length;
    }
  return { sha256: hash.digest("hex"), bytes };
}
type Manifest = {
  format: "axiom-backup";
  version: 1 | 2;
  createdAt: string;
  database: string;
  attachments: { key: string; sha256: string; bytes: number; mime: string }[];
};
async function pgTool(tool: string, database: string, args: string[]) {
  const url = new URL(database);
  const child = spawn(
    process.env.PG_BIN ? join(process.env.PG_BIN, tool) : tool,
    args,
    {
      stdio: "inherit",
      env: {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || "5432",
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
        ...(url.searchParams.has("sslmode")
          ? { PGSSLMODE: url.searchParams.get("sslmode")! }
          : {}),
      },
    },
  );
  await new Promise<void>((done, fail) => {
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`${tool} exited with code ${code}`)),
    );
  });
}
async function verify(): Promise<Manifest> {
  const m = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  ) as Manifest;
  if (
    m.format !== "axiom-backup" ||
    ![1, 2].includes(m.version) ||
    !Array.isArray(m.attachments)
  )
    throw new Error("Invalid backup manifest.");
  if (
    (await fingerprint(createReadStream(join(directory, "database.dump"))))
      .sha256 !== m.database
  )
    throw new Error("Database checksum mismatch.");
  for (const file of m.attachments) {
    if (!/^[a-f0-9-]{36}$/.test(file.key))
      throw new Error("Invalid attachment key in manifest.");
    const checked = await fingerprint(
      createReadStream(join(directory, "attachments", file.key)),
    );
    if (checked.sha256 !== file.sha256 || checked.bytes !== file.bytes)
      throw new Error("Attachment checksum mismatch: " + file.key);
  }
  console.log(
    `Verified database and ${m.attachments.length} attachment checksums.`,
  );
  return m;
}
if (operation === "create") {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  await mkdir(directory, { mode: 0o700 }); // Intentionally refuses an existing target.
  await mkdir(join(directory, "attachments"), { mode: 0o700 });
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Manual blob cleanup takes the exclusive side of this lock. The DB dump
    // and blob inventory share one exported MVCC snapshot, even during uploads.
    await client.query(
      "SELECT pg_advisory_lock_shared(hashtext('axiom:blob-backup'))",
    );
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const {
      rows: [snapshot],
    } = await client.query("SELECT pg_export_snapshot() AS id");
    await pgTool("pg_dump", process.env.DATABASE_URL, [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--snapshot=" + snapshot.id,
      "--file",
      join(directory, "database.dump"),
    ]);
    const files = (
      await client.query(
        "SELECT storage_key::text,mime,sha256,bytes FROM attachments ORDER BY storage_key",
      )
    ).rows;
    // Optional tables preserve compatibility with backups made before the
    // workspace migration. Avatars and derivatives are part of the DB/storage pair.
    const extras = [
      [
        "user_profiles",
        "SELECT avatar_key::text AS storage_key,'image/webp' AS mime,avatar_sha256 AS sha256,NULL AS bytes FROM user_profiles WHERE avatar_key IS NOT NULL",
      ],
      [
        "file_derivatives",
        "SELECT storage_key::text,mime,NULL AS sha256,bytes FROM file_derivatives",
      ],
      [
        "workspace_exports",
        "SELECT storage_key::text,'application/zip' AS mime,sha256,bytes FROM workspace_exports WHERE storage_key IS NOT NULL",
      ],
    ];
    for (const [table, sql] of extras) {
      const {
        rows: [exists],
      } = await client.query("SELECT to_regclass($1) AS name", [table]);
      if (!exists.name) continue;
      if (
        table === "user_profiles" &&
        !(
          await client.query(
            "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_profiles' AND column_name='avatar_key'",
          )
        ).rowCount
      )
        continue;
      files.push(...(await client.query(sql)).rows);
    }
    const manifest: Manifest = {
      format: "axiom-backup",
      version: 2,
      createdAt: new Date().toISOString(),
      database: (
        await fingerprint(createReadStream(join(directory, "database.dump")))
      ).sha256,
      attachments: [],
    };
    const unique = new Map<string, { sha256: string; bytes: number }>();
    for (const file of files) {
      if (!/^[a-f0-9-]{36}$/.test(file.storage_key))
        throw new Error("Invalid stored blob identity.");
      const prior = unique.get(file.storage_key);
      if (prior) {
        if (
          (file.sha256 && prior.sha256 !== file.sha256) ||
          (file.bytes !== null && Number(file.bytes) !== prior.bytes)
        )
          throw new Error(
            "Conflicting metadata for shared blob: " + file.storage_key,
          );
        continue;
      }
      const checked = await fingerprint(
        await attachmentStream(file.storage_key),
        join(directory, "attachments", file.storage_key),
      );
      if (
        (file.sha256 && checked.sha256 !== file.sha256) ||
        (file.bytes !== null && checked.bytes !== Number(file.bytes))
      )
        throw new Error(
          "Stored attachment checksum mismatch: " + file.storage_key,
        );
      unique.set(file.storage_key, checked);
      manifest.attachments.push({
        key: file.storage_key,
        ...checked,
        mime: file.mime,
      });
    }
    await client.query("COMMIT");
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      `Backup complete: ${directory}. It contains private research and account data; encrypt it before off-host storage.`,
    );
  } finally {
    await client.end();
  }
} else if (operation === "verify") await verify();
else {
  const target = process.env.RESTORE_DATABASE_URL;
  if (!target || target === process.env.DATABASE_URL)
    throw new Error(
      "Set RESTORE_DATABASE_URL to a different, freshly created empty database. The current database is never overwritten.",
    );
  const manifest = await verify(),
    client = new pg.Client({ connectionString: target });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public'",
    );
    if (Number(rows[0].n))
      throw new Error(
        "Restore target is not empty. No existing tables will be overwritten.",
      );
    if (process.env.STORAGE_DRIVER !== "s3") {
      const storage = resolve(process.env.STORAGE_PATH ?? "./data/attachments");
      try {
        if ((await readdir(storage)).length)
          throw new Error(
            "Set STORAGE_PATH to a new empty attachment directory.",
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    for (const file of manifest.attachments) {
      let existing: { sha256: string; bytes: number } | undefined;
      try {
        existing = await fingerprint(await attachmentStream(file.key));
      } catch (error) {
        if (
          !["ENOENT", "NoSuchKey", "NotFound"].includes(
            (error as NodeJS.ErrnoException).code ?? (error as Error).name,
          )
        )
          throw error;
      }
      if (
        existing &&
        (existing.sha256 !== file.sha256 || existing.bytes !== file.bytes)
      )
        throw new Error(
          "Restore would overwrite a different object. Choose an empty storage destination.",
        );
      if (!existing)
        await putAttachmentStream(
          file.key,
          createReadStream(join(directory, "attachments", file.key)),
          file.bytes,
          file.mime,
        );
    }
    await pgTool("pg_restore", target, [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      new URL(target).pathname.slice(1),
      join(directory, "database.dump"),
    ]);
    // Backups contain committed immutable blobs, never local multipart staging
    // directories. Do not advertise resumable chunks that were not restored, or
    // abort S3 uploads which may still belong to the original installation.
    const {
      rows: [uploads],
    } = await client.query("SELECT to_regclass('upload_sessions') AS name");
    if (uploads.name) {
      await client.query("BEGIN");
      try {
        await client.query(
          "UPDATE workspace_jobs SET status='failed',leased_until=NULL,error='Restart this incomplete upload after restoring the backup.' WHERE kind='complete-upload' AND status IN ('queued','running')",
        );
        const cancelled = await client.query(
          "UPDATE upload_sessions SET status='cancelled',error='Incomplete upload parts are not included in a backup. Upload the original file again.',updated_at=now() WHERE status IN ('uploading','verifying','failed') RETURNING id",
        );
        await client.query(
          "DELETE FROM upload_chunks WHERE upload_id IN (SELECT id FROM upload_sessions WHERE status='cancelled')",
        );
        await client.query("COMMIT");
        if (cancelled.rowCount)
          console.log(
            `Cancelled ${cancelled.rowCount} incomplete transfers in the restored database only; completed files are preserved.`,
          );
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    const counts = (
      await client.query(
        "SELECT (SELECT count(*) FROM notes) AS notes,(SELECT count(*) FROM attachments) AS attachments",
      )
    ).rows[0];
    console.log(
      `Restored ${counts.notes} notes and ${counts.attachments} attachments into the empty target. Point a stopped application at this database/storage pair before restarting.`,
    );
  } finally {
    await client.end();
  }
}
