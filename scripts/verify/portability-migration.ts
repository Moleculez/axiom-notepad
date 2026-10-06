import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  migration,
  forwardMigrations,
} from "../../packages/shared/src/migrations";
import {
  offlinePostgresGate,
  offlineMigrationCommands,
  sqlLiteral,
} from "./offline-postgres";

// Disposable real SQL only. No dotenv, configured database, listener or blobs.
const { root, initialize, sql } = await offlinePostgresGate(
  "portability-migration",
);
const latest = Math.max(...forwardMigrations.map((item) => item.version));
let state = "failed",
  error: string | undefined;
try {
  const directory = await initialize("upgrade"),
    group = randomUUID(),
    note = randomUUID(),
    installation = randomUUID(),
    grant = randomUUID();
  const versions = new Set(
    forwardMigrations
      .filter((item) => item.version <= 47)
      .map((item) => item.version),
  );
  await sql(
    directory,
    `BEGIN; ${migration}
    CREATE TABLE schema_migrations(version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz DEFAULT now());
    ${forwardMigrations
      .filter((item) => item.version <= 47)
      .map(
        (item) =>
          `SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED; ${item.sql} INSERT INTO schema_migrations(version,name) VALUES(${item.version},${sqlLiteral(item.name)});`,
      )
      .join("\n")} COMMIT;`,
    "Version 47 fixture",
  );
  await sql(
    directory,
    `BEGIN;
    INSERT INTO "user"(id,name,email) VALUES('portability-gate','Synthetic fixture','portability-gate@axiom.test');
    INSERT INTO groups(id,name) VALUES('${group}','Synthetic portability gate');
    INSERT INTO members(group_id,user_id,role) VALUES('${group}','portability-gate','owner');
    INSERT INTO notes(id,group_id,author_id,title,body) VALUES('${note}','${group}','portability-gate','Preserved source',E'# Source\\r\\n\\r\\n$E=mc^2$');
    INSERT INTO documents(room,note_id,state) VALUES('${note}:1','${note}',decode('000102ff','hex'));
    INSERT INTO plugin_packages(hash,plugin_id,version,manifest,bundle,archive,builtin) VALUES(repeat('a',64),'test.expiry','1.0.0','{}','export default {run(){}}',decode('00','hex'),true);
    INSERT INTO plugin_installations(id,user_id,plugin_id,package_hash,enabled) VALUES('${installation}','portability-gate','test.expiry',repeat('a',64),true);
    INSERT INTO plugin_group_approvals(group_id,plugin_id,package_hash,space_ids,approved_by) SELECT '${group}','test.expiry',repeat('a',64),ARRAY[space_id],'portability-gate' FROM resources WHERE id='${note}';
    INSERT INTO plugin_grants(id,installation_id,user_id,space_id,package_hash,capabilities,approval_revision) SELECT '${grant}','${installation}','portability-gate',space_id,repeat('a',64),ARRAY['resources:read'],1 FROM resources WHERE id='${note}';
    CREATE TABLE _portability_before AS SELECT (SELECT to_jsonb(n) FROM notes n WHERE id='${note}') AS note,(SELECT to_jsonb(d) FROM documents d WHERE room='${note}:1') AS document,(SELECT to_jsonb(g) FROM plugin_grants g WHERE id='${grant}') AS grant,(SELECT to_jsonb(a) FROM plugin_group_approvals a WHERE group_id='${group}') AS approval;
    COMMIT;`,
    "Preserved corpus and existing consent",
  );
  await sql(
    directory,
    await offlineMigrationCommands(versions),
    "47 to current upgrade",
  );
  const preserved = `DO $$ BEGIN
    IF (SELECT max(version) FROM schema_migrations)<>${latest} THEN RAISE EXCEPTION 'Migration ledger incomplete'; END IF;
    IF (SELECT to_jsonb(n) FROM notes n WHERE id='${note}') IS DISTINCT FROM (SELECT note FROM _portability_before) OR (SELECT to_jsonb(d) FROM documents d WHERE room='${note}:1') IS DISTINCT FROM (SELECT document FROM _portability_before) OR (SELECT to_jsonb(g)-'expires_at' FROM plugin_grants g WHERE id='${grant}') IS DISTINCT FROM (SELECT grant FROM _portability_before) OR (SELECT to_jsonb(a)-'expires_at' FROM plugin_group_approvals a WHERE group_id='${group}') IS DISTINCT FROM (SELECT approval FROM _portability_before) THEN RAISE EXCEPTION 'Source, CRDT or original authority changed'; END IF;
    IF NOT EXISTS(SELECT 1 FROM plugin_grants WHERE id='${grant}' AND expires_at BETWEEN clock_timestamp()+interval '719 hours' AND clock_timestamp()+interval '721 hours') OR NOT EXISTS(SELECT 1 FROM plugin_group_approvals WHERE group_id='${group}' AND expires_at BETWEEN clock_timestamp()+interval '719 hours' AND clock_timestamp()+interval '721 hours') THEN RAISE EXCEPTION 'Upgrade grace is not 30 days'; END IF;
    END $$;`;
  await sql(
    directory,
    preserved +
      `CREATE TABLE _portability_expiries AS SELECT expires_at AS grant_expiry,(SELECT expires_at FROM plugin_group_approvals WHERE group_id='${group}') AS approval_expiry FROM plugin_grants WHERE id='${grant}';`,
    "Grace and preservation assertions",
  );
  await sql(
    directory,
    await offlineMigrationCommands(versions),
    "Controller rerun",
  );
  await sql(
    directory,
    preserved +
      `DO $$ BEGIN IF (SELECT expires_at FROM plugin_grants WHERE id='${grant}') IS DISTINCT FROM (SELECT grant_expiry FROM _portability_expiries) OR (SELECT expires_at FROM plugin_group_approvals WHERE group_id='${group}') IS DISTINCT FROM (SELECT approval_expiry FROM _portability_expiries) THEN RAISE EXCEPTION 'Rerun extended old consent'; END IF; END $$;`,
    "Stable expiry on rerun",
  );
  await sql(
    directory,
    `BEGIN;
    UPDATE plugin_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE id='${grant}';
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM plugin_grants WHERE id='${grant}' AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Expired grant remains active'; END IF; END $$;
    UPDATE plugin_grants SET expires_at=clock_timestamp()+interval '720 hours',revision=revision+1 WHERE id='${grant}';
    UPDATE plugin_group_approvals SET expires_at=clock_timestamp()-interval '1 second' WHERE group_id='${group}';
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM plugin_group_approvals WHERE group_id='${group}' AND enabled AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Expired group approval remains active'; END IF; END $$;
    COMMIT;`,
    "Expiry boundaries",
  );
  const fresh = await initialize("fresh");
  await sql(
    fresh,
    await offlineMigrationCommands(new Set()),
    "Fresh controller",
  );
  await sql(
    fresh,
    `DO $$ BEGIN IF (SELECT max(version) FROM schema_migrations)<>${latest} OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='plugin_grants' AND column_name='expires_at' AND is_nullable='NO') OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='plugin_group_approvals' AND column_name='expires_at' AND is_nullable='NO') THEN RAISE EXCEPTION 'Fresh expiry schema missing'; END IF; END $$;`,
    "Fresh assertions",
  );
  state = "passed";
  console.log(
    `Portability offline SQL passed: fresh, 47→${latest}, stable rerun, 30-day grace and preserved source/CRDT/consent. HTTP, worker concurrency and browsers are separate gates.`,
  );
} catch (reason) {
  error = (reason as Error).message;
  throw reason;
} finally {
  await writeFile(
    join(root, "result.json"),
    JSON.stringify(
      {
        state,
        from: 47,
        to: latest,
        at: new Date().toISOString(),
        mode: "offline-single-user",
        error,
        http: false,
        concurrency: false,
        browser: false,
      },
      null,
      2,
    ),
  );
  console.log("Isolated evidence: " + root);
}
