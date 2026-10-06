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
  sqlLiteral as literal,
} from "./offline-postgres";

const { root, initialize, sql } = await offlinePostgresGate(
  "assistant-grounding-migration",
);
const latest = Math.max(...forwardMigrations.map((m) => m.version));
let state = "failed",
  error: string | undefined;
try {
  const upgraded = await initialize("upgrade"),
    group = randomUUID(),
    note = randomUUID(),
    task = randomUUID(),
    provider = randomUUID(),
    conversation = randomUUID(),
    context = randomUUID(),
    job = randomUUID(),
    review = randomUUID(),
    set = randomUUID(),
    recovered = randomUUID();
  const versions = new Set(
    forwardMigrations.filter((m) => m.version <= 46).map((m) => m.version),
  );
  await sql(
    upgraded,
    `BEGIN; ${migration}
    CREATE TABLE schema_migrations(version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz DEFAULT now());
    ${forwardMigrations
      .filter((m) => m.version <= 46)
      .map(
        (m) =>
          `SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED; ${m.sql} INSERT INTO schema_migrations(version,name) VALUES(${m.version},${literal(m.name)});`,
      )
      .join("\n")} COMMIT;`,
    "Version 46 fixture",
  );
  await sql(
    upgraded,
    `BEGIN;
    INSERT INTO "user"(id,name,email) VALUES('ground-gate','Synthetic fixture','ground-gate@axiom.test');
    INSERT INTO groups(id,name) VALUES('${group}','Synthetic grounding gate');
    INSERT INTO members(group_id,user_id,role) VALUES('${group}','ground-gate','owner');
    INSERT INTO notes(id,group_id,author_id,title,body) VALUES('${note}','${group}','ground-gate','Preserved research',E'# Source\\r\\n\\r\\n$E=mc^2$');
    INSERT INTO documents(room,note_id,state) VALUES('${note}:1','${note}',decode('000102ff','hex'));
    INSERT INTO tasks(id,space_id,project_id,created_by,title,body,version) SELECT '${task}',space_id,NULL,'ground-gate','Preserved task','Unchanged Markdown',9 FROM resources WHERE id='${note}';
    INSERT INTO tool_providers(id,group_id,name,kind,endpoint,model,credential) VALUES('${provider}','${group}','Synthetic provider','private','https://synthetic.invalid/v1/','synthetic','not-a-credential');
    INSERT INTO assistant_conversations(id,owner_id,space_id,space_ids) SELECT '${conversation}','ground-gate',space_id,ARRAY[space_id] FROM resources WHERE id='${note}';
    INSERT INTO assistant_contexts(id,conversation_id,provider_id,provider_version,prompt,evidence,messages,fingerprint,conversation_version,agent_config,submitted_at) VALUES('${context}','${conversation}','${provider}',1,'Synthetic request','[]','[]',repeat('a',64),1,'{"mode":"ask","discover":true}',now());
    INSERT INTO tool_jobs(id,owner_id,provider_id,kind,assistant_context_id,status) VALUES('${job}','ground-gate','${provider}','assistant','${context}','queued');
    INSERT INTO assistant_runs(id,context_id,round) VALUES('${job}','${context}',1);
    INSERT INTO assistant_run_steps(run_id,ordinal,provider_id,completed_at) VALUES('${job}',1,'${provider}',now());
    CREATE TABLE _ground_gate_before AS SELECT (SELECT to_jsonb(n) FROM notes n WHERE id='${note}') AS note,(SELECT to_jsonb(d) FROM documents d WHERE room='${note}:1') AS document,(SELECT to_jsonb(t) FROM tasks t WHERE id='${task}') AS task,(SELECT to_jsonb(c) FROM assistant_contexts c WHERE id='${context}') AS context;
    COMMIT;`,
    "Preserved corpus and legacy pending discovery",
  );
  await sql(
    upgraded,
    await offlineMigrationCommands(versions),
    "46 to current upgrade",
  );
  const preserved = `DO $$ BEGIN
    IF (SELECT max(version) FROM schema_migrations)<>${latest} OR to_regclass('public.assistant_run_reviews') IS NULL THEN RAISE EXCEPTION 'Grounding schema missing'; END IF;
    IF (SELECT to_jsonb(n) FROM notes n WHERE id='${note}') IS DISTINCT FROM (SELECT note FROM _ground_gate_before) OR (SELECT to_jsonb(d) FROM documents d WHERE room='${note}:1') IS DISTINCT FROM (SELECT document FROM _ground_gate_before) OR (SELECT to_jsonb(t) FROM tasks t WHERE id='${task}') IS DISTINCT FROM (SELECT task FROM _ground_gate_before) OR (SELECT to_jsonb(c) FROM assistant_contexts c WHERE id='${context}') IS DISTINCT FROM (SELECT context FROM _ground_gate_before) THEN RAISE EXCEPTION 'Source, CRDT, task identity/version or captured context changed'; END IF;
    IF (SELECT status FROM tool_jobs WHERE id='${job}')<>'awaiting-review' OR (SELECT review_id FROM assistant_runs WHERE id='${job}') IS NOT NULL THEN RAISE EXCEPTION 'Legacy consent was grandfathered'; END IF;
    IF (SELECT outcome FROM assistant_run_steps WHERE run_id='${job}' AND ordinal=1)<>'complete' OR (SELECT usage FROM assistant_run_steps WHERE run_id='${job}' AND ordinal=1) IS NOT NULL THEN RAISE EXCEPTION 'Legacy usage fabricated or known completion lost'; END IF;
    END $$;`;
  await sql(upgraded, preserved, "Source and legacy-pause assertions");
  await sql(
    upgraded,
    await offlineMigrationCommands(versions),
    "Controller rerun",
  );
  await sql(upgraded, preserved, "Rerun preservation");
  await sql(
    upgraded,
    `BEGIN;
    INSERT INTO assistant_run_reviews(id,run_id,ordinal,fingerprint,envelope,expires_at) VALUES('${review}','${job}',2,repeat('b',64),'{}',now()+interval '15 minutes');
    UPDATE assistant_runs SET review_id='${review}' WHERE id='${job}';
    INSERT INTO assistant_run_steps(run_id,ordinal,provider_id,review_id,usage,response,outcome,completed_at) VALUES('${job}',2,'${provider}','${review}','{"input":null,"output":20}','{"text":"Synthetic saved response"}','complete',now());
    UPDATE assistant_run_reviews SET state='approved',approval_mutation_id='${job}',approved_at=now() WHERE id='${review}';
    DO $$ BEGIN BEGIN INSERT INTO assistant_run_reviews(id,run_id,ordinal,fingerprint,envelope,approval_mutation_id) VALUES(gen_random_uuid(),'${job}',2,repeat('c',64),'{}','${job}'); RAISE EXCEPTION 'Duplicate approval accepted'; EXCEPTION WHEN unique_violation THEN NULL; END; END $$;
    INSERT INTO workspace_change_sets(id,owner_id,title,space_ids,request_hash) SELECT '${set}','ground-gate','Original',ARRAY[space_id],repeat('d',64) FROM resources WHERE id='${note}';
    INSERT INTO workspace_change_sets(id,owner_id,title,space_ids,request_hash,recovery_of) SELECT '${recovered}','ground-gate','Remaining',ARRAY[space_id],repeat('e',64),'${set}' FROM resources WHERE id='${note}';
    DELETE FROM workspace_change_sets WHERE id='${set}';
    DO $$ BEGIN IF (SELECT recovery_of FROM workspace_change_sets WHERE id='${recovered}') IS NOT NULL THEN RAISE EXCEPTION 'Expired lineage blocks newer receipts'; END IF; END $$;
    DELETE FROM assistant_contexts WHERE id='${context}';
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM assistant_runs WHERE id='${job}') OR EXISTS(SELECT 1 FROM assistant_run_reviews WHERE run_id='${job}') OR EXISTS(SELECT 1 FROM assistant_run_steps WHERE run_id='${job}') THEN RAISE EXCEPTION 'Private cyclic ledger cleanup failed'; END IF; IF NOT EXISTS(SELECT 1 FROM notes WHERE id='${note}') THEN RAISE EXCEPTION 'Private deletion lost accepted document'; END IF; END $$;
    COMMIT;`,
    "Review uniqueness, nullable usage, lineage and cyclic cleanup",
  );
  const fresh = await initialize("fresh");
  await sql(
    fresh,
    await offlineMigrationCommands(new Set()),
    "Fresh controller",
  );
  await sql(
    fresh,
    `DO $$ BEGIN IF (SELECT max(version) FROM schema_migrations)<>${latest} OR to_regclass('public.assistant_run_reviews') IS NULL THEN RAISE EXCEPTION 'Fresh schema incomplete'; END IF; END $$;`,
    "Fresh assertions",
  );
  state = "passed";
  console.log(
    `Grounding offline SQL gate passed: fresh, 46→${latest}, rerun, source preservation, legacy pause, receipt uniqueness and private-ledger cleanup. HTTP/concurrency/browser are separate gates.`,
  );
} catch (e) {
  error = (e as Error).message;
  throw e;
} finally {
  await writeFile(
    join(root, "result.json"),
    JSON.stringify(
      {
        state,
        from: 46,
        to: latest,
        mode: "offline-single-user",
        error,
        at: new Date().toISOString(),
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
