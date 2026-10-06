import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Y from "yjs";
import {
  migration,
  forwardMigrations,
} from "../../packages/shared/src/migrations";
import {
  offlinePostgresGate,
  offlineMigrationCommands,
  sqlLiteral as literal,
} from "./offline-postgres";

// Disposable PostgreSQL only. No dotenv, working URL, network listener or blobs.
const { root, initialize, sql } =
  await offlinePostgresGate("mindmap-migration");
const latest = Math.max(...forwardMigrations.map((m) => m.version));
let state = "failed",
  failure = "";
try {
  const upgraded = await initialize("upgrade"),
    group = randomUUID(),
    note = randomUUID(),
    map = randomUUID();
  const versions = new Set(
    forwardMigrations.filter((m) => m.version <= 48).map((m) => m.version),
  );
  await sql(
    upgraded,
    `BEGIN;\n${migration}\nCREATE TABLE schema_migrations(version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz DEFAULT now());\n${forwardMigrations
      .filter((m) => m.version <= 48)
      .map(
        (m) =>
          `SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED; ${m.sql}\nINSERT INTO schema_migrations(version,name) VALUES(${m.version},${literal(m.name)});`,
      )
      .join("\n")}\nCOMMIT;`,
    "Version 48 fixture",
  );
  const source = "\ufeff# Source\r\n\r\n- [ ] Evidence\r\n\r\n$$E=mc^2$$\r\n",
    doc = new Y.Doc();
  doc.getText("markdown").insert(0, source);
  const bytes = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("hex");
  doc.destroy();
  await sql(
    upgraded,
    `BEGIN;
    INSERT INTO "user"(id,name,email) VALUES('map-gate','Map fixture','map-gate@axiom.test');
    INSERT INTO groups(id,name) VALUES('${group}','Mind-map gate');
    INSERT INTO members(group_id,user_id,role) VALUES('${group}','map-gate','owner');
    INSERT INTO notes(id,group_id,author_id,title,body) VALUES('${note}','${group}','map-gate','Preserved note',${literal(source)});
    INSERT INTO documents(room,note_id,state) VALUES('${note}:1','${note}',decode('${bytes}','hex'));
    INSERT INTO tool_projects(resource_id,kind,settings,version) VALUES('${note}','text','{}',7);
    CREATE TABLE _map_before AS SELECT (SELECT to_jsonb(n) FROM notes n WHERE id='${note}') AS note,(SELECT to_jsonb(d) FROM documents d WHERE room='${note}:1') AS document,(SELECT to_jsonb(p) FROM tool_projects p WHERE resource_id='${note}') AS profile;
    COMMIT;`,
    "Canonical source and Yjs fixture",
  );
  const preserved = `DO $$ BEGIN
    IF (SELECT max(version) FROM schema_migrations)<>${latest} THEN RAISE EXCEPTION 'Migration ledger incomplete'; END IF;
    IF (SELECT to_jsonb(n) FROM notes n WHERE id='${note}') IS DISTINCT FROM (SELECT note FROM _map_before) OR (SELECT to_jsonb(d) FROM documents d WHERE room='${note}:1') IS DISTINCT FROM (SELECT document FROM _map_before) OR (SELECT to_jsonb(p) FROM tool_projects p WHERE resource_id='${note}') IS DISTINCT FROM (SELECT profile FROM _map_before) THEN RAISE EXCEPTION 'Existing canonical source, Yjs or profile changed'; END IF;
    END $$;`;
  await sql(
    upgraded,
    await offlineMigrationCommands(versions),
    `48 to ${latest}`,
  );
  await sql(upgraded, preserved, "Exact source and state preservation");
  await sql(
    upgraded,
    await offlineMigrationCommands(versions),
    "Normal controller rerun",
  );
  await sql(upgraded, preserved, "Rerun preservation");
  await sql(
    upgraded,
    `BEGIN;
    INSERT INTO notes(id,group_id,author_id,title,body) VALUES('${map}','${group}','map-gate','Map',${literal(source)});
    INSERT INTO tool_projects(resource_id,kind,settings) VALUES('${map}','mindmap','{"layout":"balanced"}');
    DO $$ BEGIN IF (SELECT source_format FROM notes WHERE id='${map}')<>'markdown' THEN RAISE EXCEPTION 'A mind map must retain Markdown source'; END IF; BEGIN UPDATE tool_projects SET kind='unknown' WHERE resource_id='${map}'; RAISE EXCEPTION 'Unknown tool kind accepted'; EXCEPTION WHEN check_violation THEN NULL; END; END $$;
    COMMIT;`,
    "New profile and constraint",
  );
  const fresh = await initialize("fresh");
  await sql(
    fresh,
    await offlineMigrationCommands(new Set()),
    "Fresh controller",
  );
  await sql(
    fresh,
    `DO $$ BEGIN IF (SELECT max(version) FROM schema_migrations)<>${latest} OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='tool_projects_kind_check' AND pg_get_constraintdef(oid) LIKE '%mindmap%') THEN RAISE EXCEPTION 'Fresh mind-map schema incomplete'; END IF; END $$;`,
    "Fresh schema assertions",
  );
  state = "passed";
  console.log(
    "Mind-map migration SQL passed: fresh, 48→49, rerun, exact canonical/Yjs/profile preservation, new profile and constraint. HTTP, concurrency and browser acceptance are separate.",
  );
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await writeFile(
    join(root, "result.json"),
    JSON.stringify(
      {
        state,
        from: 48,
        to: latest,
        mode: "offline-single-user",
        failure,
        at: new Date().toISOString(),
        http: false,
        concurrency: false,
        browser: false,
      },
      null,
      2,
    ),
  );
  console.log(`Private SQL receipt: ${root}/result.json`);
}
