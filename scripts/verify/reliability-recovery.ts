import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import {
  assertPopulatedRecovery,
  requiredRecoveryTables,
} from "./stage-acceptance-contract";
import {
  mutationTestTarget,
  verifyMutationTestStorage,
} from "../../packages/shared/src/test-target";

type Run = (args: string[], env: NodeJS.ProcessEnv) => Promise<void>;
/** Uses the real paired-backup CLI, a newly created DB, and new blob storage.
 * The controller has already drained its own services; no live pair is touched. */
export async function rehearseReliabilityRecovery(
  env: NodeJS.ProcessEnv,
  directory: string,
  run: Run,
) {
  const target = mutationTestTarget(env);
  await verifyMutationTestStorage(target);
  assert(
    target.profile === "reliability",
    "Recovery requires the dedicated reliability profile.",
  );
  assert(
    resolve(directory).startsWith(resolve("data") + "/reliability-"),
    "Recovery output must belong to this verification run.",
  );
  let bin = env.PG_BIN;
  if (!bin && process.platform === "darwin")
    for (const candidate of [
      "/opt/homebrew/opt/libpq/bin",
      "/usr/local/opt/libpq/bin",
    ]) {
      try {
        await access(join(candidate, "pg_dump"));
        bin = candidate;
        break;
      } catch {
        /* Try PATH below. */
      }
    }
  const source = new pg.Client({ connectionString: target.databaseUrl });
  await source.connect();
  const queries = [
    "SELECT id,title,body,generation,version FROM notes ORDER BY id",
    "SELECT room,note_id,encode(state,'hex') AS state,revision FROM documents ORDER BY room",
    "SELECT id,room,encode(data,'hex') AS data FROM document_updates ORDER BY id",
    "SELECT id,note_id,body,encode(state,'hex') AS state FROM snapshots ORDER BY id",
    "SELECT id,storage_key,sha256,bytes FROM attachments ORDER BY id",
    "SELECT to_jsonb(t) FROM tasks t ORDER BY id",
    "SELECT id,planning_fields_version FROM spaces ORDER BY id",
    "SELECT to_jsonb(f) FROM planning_fields f ORDER BY id",
    "SELECT to_jsonb(v) FROM planning_field_values v ORDER BY task_id,field_id",
    "SELECT to_jsonb(e) FROM planning_time e ORDER BY id",
    "SELECT to_jsonb(h) FROM planning_time_history h ORDER BY id",
    "SELECT to_jsonb(r) FROM planning_automations r ORDER BY id",
    "SELECT to_jsonb(r) FROM planning_automation_runs r ORDER BY id",
    "SELECT to_jsonb(e) FROM planning_automation_events e ORDER BY id",
    "SELECT id,space_id,title,body,version,archived,task_ids,milestone_ids FROM planning_goals ORDER BY id",
    "SELECT id,space_id,entity_id,summary,created_at FROM planning_history ORDER BY id",
    "SELECT id,space_id,rule,template,version,enabled,archived,last_date FROM task_recurrences ORDER BY id",
    "SELECT recurrence_id,occurs_on,task_id FROM task_occurrences ORDER BY recurrence_id,occurs_on",
    "SELECT id,reference_id,version,kind,before_data,after_data,details FROM reference_provenance ORDER BY id",
    "SELECT id,task_id,source_kind,snapshot_id,reference_event_id FROM task_research_links ORDER BY id",
    "SELECT id,snapshot_id,file_version_id,paper_context FROM review_requests ORDER BY id",
    "SELECT to_jsonb(c) FROM assistant_conversations c ORDER BY id",
    "SELECT to_jsonb(c) FROM assistant_contexts c ORDER BY id",
    "SELECT to_jsonb(j) FROM tool_jobs j WHERE kind='assistant' ORDER BY id",
    "SELECT to_jsonb(r) FROM assistant_runs r ORDER BY id",
    "SELECT to_jsonb(r) FROM assistant_run_reviews r ORDER BY id",
    "SELECT to_jsonb(s) FROM assistant_run_steps s ORDER BY run_id,ordinal",
    "SELECT to_jsonb(s) FROM workspace_change_sets s ORDER BY id",
    "SELECT to_jsonb(a) FROM workspace_change_actions a ORDER BY set_id,key",
    'SELECT id,email FROM "user" ORDER BY id',
    "SELECT version,name FROM schema_migrations ORDER BY version",
  ];
  try {
    const actual = (
      await source.query(
        "SELECT current_database() AS name, current_setting('server_version_num') AS version",
      )
    ).rows[0];
    assert.equal(actual.name, target.databaseName);
    const counts: Record<string, number> = {};
    for (const table of requiredRecoveryTables)
      counts[table] = Number(
        (await source.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n,
      );
    assertPopulatedRecovery(counts);
    for (const tool of ["pg_dump", "pg_restore"]) {
      let version: string;
      try {
        version = (
          await promisify(execFile)(bin ? join(bin, tool) : tool, ["--version"])
        ).stdout;
      } catch {
        throw new Error(
          "Install PostgreSQL client tools matching the test server, or set PG_BIN. Recovery was not attempted.",
        );
      }
      assert(
        Number(/PostgreSQL\) (\d+)/.exec(version)?.[1]) >=
          Math.floor(Number(actual.version) / 10000),
        "PostgreSQL client tools are older than the test server.",
      );
    }
    // A pg.Client is one connection, not a pool. Keep snapshots sequential;
    // queued concurrent query() calls are deprecated by the driver.
    const expected: Record<string, unknown>[][] = [];
    for (const sql of queries) expected.push((await source.query(sql)).rows);
    const backup = join(directory, "paired-backup");
    const backupEnv = { ...env, ...(bin ? { PG_BIN: bin } : {}) };
    const cli = ["--import", "tsx", "scripts/ops/backup.ts"];
    await run([...cli, "create", backup], backupEnv);
    await run([...cli, "verify", backup], backupEnv);
    const restored = new URL(target.databaseUrl);
    const name = `axiom_recovery_${randomBytes(6).toString("hex")}_test`;
    restored.pathname = "/" + name;
    // Generated exact identifier; CREATE refuses collisions. Never DROP/reuse.
    await source.query(`CREATE DATABASE "${name}"`);
    const storage = join(directory, "restored-attachments");
    await run([...cli, "restore", backup], {
      ...backupEnv,
      RESTORE_DATABASE_URL: restored.href,
      STORAGE_PATH: storage,
    });
    const restoredClient = new pg.Client({ connectionString: restored.href });
    await restoredClient.connect();
    try {
      for (const [index, sql] of queries.entries())
        assert.deepEqual(
          (await restoredClient.query(sql)).rows,
          expected[index],
          `Recovered records differ for check ${index + 1}.`,
        );
    } finally {
      await restoredClient.end();
    }
    const manifest = JSON.parse(
      await readFile(join(backup, "manifest.json"), "utf8"),
    ) as {
      attachments: { key: string; bytes: number; sha256: string }[];
    };
    assert(
      manifest.attachments.length > 0,
      "Empty attachment stores cannot establish paired blob recovery.",
    );
    const verifyBlobs = async () => {
      for (const blob of manifest.attachments) {
        assert.match(blob.key, /^[a-f0-9-]{36}$/);
        const hash = createHash("sha256");
        let bytes = 0;
        for await (const chunk of createReadStream(join(storage, blob.key))) {
          hash.update(chunk);
          bytes += chunk.length;
        }
        assert.equal(bytes, blob.bytes);
        assert.equal(hash.digest("hex"), blob.sha256);
      }
    };
    await verifyBlobs();
    // The real restore guard must refuse a second restore into the same pair.
    let refused = false;
    try {
      await run([...cli, "restore", backup], {
        ...backupEnv,
        RESTORE_DATABASE_URL: restored.href,
        STORAGE_PATH: storage,
      });
    } catch {
      refused = true;
    }
    assert(
      refused,
      "Restore must not overwrite a non-empty database/storage pair.",
    );
    const preserved = new pg.Client({ connectionString: restored.href });
    await preserved.connect();
    try {
      for (const [index, sql] of queries.entries())
        assert.deepEqual(
          (await preserved.query(sql)).rows,
          expected[index],
          "Refused restore changed recovered data.",
        );
      await verifyBlobs();
    } finally {
      await preserved.end();
    }
    for (const [index, sql] of queries.entries())
      assert.deepEqual(
        (await source.query(sql)).rows,
        expected[index],
        "Source data changed during recovery.",
      );
    console.log(
      `PASS: paired recovery preserves notes, Yjs states/journals, snapshots, tasks, users, migration receipts and ${manifest.attachments.length} verified blobs; repeat restore is refused.`,
    );
    return {
      databaseChecks: queries.length,
      populated: true,
      counts,
      blobs: manifest.attachments.length,
      overwriteRefused: true,
    };
  } finally {
    await source.end();
  }
}
