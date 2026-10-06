import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  migration,
  forwardMigrations,
} from "../../packages/shared/src/migrations";
import { metadataBatchUpdateSql } from "../../packages/shared/src/planning-metadata-query";
import {
  offlinePostgresGate,
  offlineMigrationCommands,
  sqlLiteral,
} from "./offline-postgres";

// No dotenv, configured URL, listener or working blobs. This exercises real SQL,
// not HTTP, pg-wire or concurrent-worker acceptance.
const { root, initialize, sql } = await offlinePostgresGate(
  "planning-lab-migration",
);
const literal = sqlLiteral,
  commands = offlineMigrationCommands;
const latest = Math.max(...forwardMigrations.map((m) => m.version));
let state = "failed";
try {
  const upgraded = await initialize("upgrade"),
    note = randomUUID(),
    group = randomUUID(),
    task = randomUUID(),
    f = randomUUID(),
    choiceField = randomUUID(),
    choice = randomUUID(),
    rule = randomUUID(),
    log = randomUUID();
  const batch = (patch: Record<string, unknown> | null) =>
    metadataBatchUpdateSql
      .replace("$1", `(SELECT space_id FROM tasks WHERE id='${task}')`)
      .replace(
        "$2",
        literal(
          JSON.stringify([
            {
              id: task,
              status: "todo",
              priority: "normal",
              assignee_id: null,
              labels: [],
              custom_patch: patch,
            },
          ]),
        ),
      );
  const versions = new Set(
    forwardMigrations.filter((m) => m.version <= 45).map((m) => m.version),
  );
  await sql(
    upgraded,
    `BEGIN;\n${migration}\nCREATE TABLE schema_migrations(version integer PRIMARY KEY,name text NOT NULL,applied_at timestamptz DEFAULT now());\n${forwardMigrations
      .filter((m) => m.version <= 45)
      .map(
        (m) =>
          `SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED; ${m.sql}\n INSERT INTO schema_migrations(version,name) VALUES(${m.version},${literal(m.name)});`,
      )
      .join("\n")}\nCOMMIT;`,
    "Version 45 fixture",
  );
  await sql(
    upgraded,
    `BEGIN;
    INSERT INTO "user"(id,name,email) VALUES('lab-gate','Lab fixture','lab-gate@axiom.test');
    INSERT INTO groups(id,name) VALUES('${group}','Lab gate');
    INSERT INTO members(group_id,user_id,role) VALUES('${group}','lab-gate','owner');
    INSERT INTO notes(id,group_id,author_id,title,body) VALUES('${note}','${group}','lab-gate','Preserved research',E'# Source\\r\\n\\r\\n$E=mc^2$');
    INSERT INTO documents(room,note_id,state) VALUES('${note}:1','${note}',decode('000102ff','hex'));
    INSERT INTO tasks(id,space_id,project_id,created_by,title,body,version) SELECT '${task}',space_id,NULL,'lab-gate','Original task','Unchanged task Markdown',11 FROM resources WHERE id='${note}';
    CREATE TABLE _lab_gate_before AS SELECT (SELECT to_jsonb(t) FROM tasks t WHERE id='${task}') AS task,(SELECT to_jsonb(n) FROM notes n WHERE id='${note}') AS note,(SELECT to_jsonb(d) FROM documents d WHERE room='${note}:1') AS document;
    DO $$ BEGIN IF (SELECT max(version) FROM schema_migrations)<>45 THEN RAISE EXCEPTION 'Fixture version is not 45'; END IF; END $$;
    COMMIT;`,
    "Preserved corpus",
  );
  await sql(upgraded, await commands(versions), `45 to ${latest} upgrade`);
  const preserved = `DO $$ BEGIN
    IF (SELECT max(version) FROM schema_migrations)<>${latest} THEN RAISE EXCEPTION 'Current migration ledger incomplete'; END IF;
    IF (SELECT to_jsonb(t)-'custom_fields' FROM tasks t WHERE id='${task}') IS DISTINCT FROM (SELECT task FROM _lab_gate_before) OR (SELECT to_jsonb(n) FROM notes n WHERE id='${note}') IS DISTINCT FROM (SELECT note FROM _lab_gate_before) OR (SELECT to_jsonb(d) FROM documents d WHERE room='${note}:1') IS DISTINCT FROM (SELECT document FROM _lab_gate_before) THEN RAISE EXCEPTION 'Existing source, CRDT or task identity/version changed'; END IF;
    IF (SELECT custom_fields FROM tasks WHERE id='${task}')<>'{}' THEN RAISE EXCEPTION 'Existing custom fields were not empty'; END IF;
    END $$;`;
  await sql(upgraded, preserved, "Source preservation");
  await sql(
    upgraded,
    await commands(versions),
    "Normal migration controller rerun",
  );
  await sql(upgraded, preserved, "Rerun preservation");
  await sql(
    upgraded,
    `BEGIN;
    INSERT INTO planning_fields(id,space_id,name,kind) SELECT '${f}',space_id,'Mass','number' FROM tasks WHERE id='${task}';
    UPDATE tasks SET custom_fields=jsonb_build_object('${f}',2.5),version=version+1 WHERE id='${task}';
    DO $$ BEGIN IF (SELECT number_value FROM planning_field_values WHERE task_id='${task}' AND field_id='${f}')<>2.5 THEN RAISE EXCEPTION 'Projection is wrong'; END IF; END $$;
    INSERT INTO planning_fields(id,space_id,name,kind,options) SELECT '${choiceField}',space_id,'Evidence stage','select',jsonb_build_array(jsonb_build_object('id','${choice}','label','Verified','archived',false)) FROM tasks WHERE id='${task}';
    UPDATE tasks SET custom_fields=custom_fields||jsonb_build_object('${choiceField}','${choice}'),version=version+1 WHERE id='${task}';
    DO $$ BEGIN IF NOT (SELECT used_options @> ARRAY['${choice}'::uuid] AND version=1 FROM planning_fields WHERE id='${choiceField}') THEN RAISE EXCEPTION 'Choice identity was not remembered without changing its definition revision'; END IF; END $$;
    ${batch({ [f]: 0 })};
    DO $$ BEGIN IF (SELECT number_value FROM planning_field_values WHERE task_id='${task}' AND field_id='${f}')<>0 OR (SELECT custom_fields->>'${choiceField}' FROM tasks WHERE id='${task}') IS DISTINCT FROM '${choice}' THEN RAISE EXCEPTION 'Metadata batch did not set zero while retaining unrelated fields'; END IF; END $$;
    ${batch({ [f]: null })};
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM planning_field_values WHERE task_id='${task}' AND field_id='${f}') OR (SELECT custom_fields->>'${choiceField}' FROM tasks WHERE id='${task}') IS DISTINCT FROM '${choice}' THEN RAISE EXCEPTION 'Metadata batch did not clear only the touched field'; END IF; END $$;
    ${batch({ [f]: 2.5 })};
    ${batch(null)};
    DO $$ BEGIN IF (SELECT custom_fields->>'${f}' FROM tasks WHERE id='${task}') IS DISTINCT FROM '2.5' OR (SELECT custom_fields->>'${choiceField}' FROM tasks WHERE id='${task}') IS DISTINCT FROM '${choice}' OR (SELECT body FROM tasks WHERE id='${task}')<>'Unchanged task Markdown' THEN RAISE EXCEPTION 'Metadata-only batch replaced values or Markdown'; END IF; END $$;
    INSERT INTO planning_time(id,space_id,task_id,author_id,spent_on,minutes,note) SELECT '${log}',space_id,id,'lab-gate','2026-10-06',90,'Verified work' FROM tasks WHERE id='${task}';
    INSERT INTO planning_time_history(entry_id,space_id,actor_id,reason,after_data) SELECT id,space_id,author_id,'',to_jsonb(e) FROM planning_time e WHERE id='${log}';
    INSERT INTO planning_automations(id,space_id,name,config,enabled,configured_by,enabled_at) SELECT '${rule}',space_id,'Triage','{"name":"Triage","trigger":"changed","watched":["priority"],"conditions":[],"actions":[{"kind":"status","value":"in_progress"}],"enabled":true,"archived":false,"at":"09:00"}',true,'lab-gate',now() FROM tasks WHERE id='${task}';
    UPDATE tasks SET priority='high',version=version+1 WHERE id='${task}';
    UPDATE tasks SET priority='urgent',version=version+1 WHERE id='${task}';
    DO $$ BEGIN
      IF (SELECT count(*) FROM planning_automation_events WHERE task_id='${task}' AND processed_at IS NULL)<>1 THEN RAISE EXCEPTION 'Pending events were not coalesced'; END IF;
      IF (SELECT after_data ? 'body' FROM planning_automation_events WHERE task_id='${task}') THEN RAISE EXCEPTION 'Outbox leaked Markdown'; END IF;
      IF (SELECT before_data->>'priority' FROM planning_automation_events WHERE task_id='${task}')<>'normal' OR (SELECT after_data->>'priority' FROM planning_automation_events WHERE task_id='${task}')<>'urgent' THEN RAISE EXCEPTION 'Event did not preserve before/latest metadata'; END IF;
    END $$;
    SELECT set_config('axiom.automation_origin','${rule}',true);
    UPDATE tasks SET status='in_progress',version=version+1 WHERE id='${task}';
    DO $$ BEGIN IF (SELECT count(*) FROM planning_automation_events WHERE task_id='${task}')<>1 THEN RAISE EXCEPTION 'Automation recursed'; END IF; END $$;
    CREATE TEMP TABLE before_time AS SELECT version,(SELECT planning_version FROM spaces WHERE id=t.space_id) AS plan FROM tasks t WHERE id='${task}';
    UPDATE planning_time SET minutes=100,version=version+1 WHERE id='${log}';
    DO $$ BEGIN IF (SELECT version FROM tasks WHERE id='${task}')<>(SELECT version FROM before_time) OR (SELECT planning_version FROM spaces WHERE id=(SELECT space_id FROM tasks WHERE id='${task}'))<>(SELECT plan FROM before_time) THEN RAISE EXCEPTION 'Time changed the task or schedule revision'; END IF; END $$;
    UPDATE tasks SET custom_fields='{}',version=version+1 WHERE id='${task}';
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM planning_field_values WHERE task_id='${task}') THEN RAISE EXCEPTION 'Cleared projection retained a value'; END IF; END $$;
    DO $$ BEGIN IF NOT (SELECT used_options @> ARRAY['${choice}'::uuid] FROM planning_fields WHERE id='${choiceField}') THEN RAISE EXCEPTION 'Clearing a value forgot its used option identity'; END IF; END $$;
    DO $$ BEGIN BEGIN UPDATE tasks SET custom_fields=jsonb_build_object('${randomUUID()}',1) WHERE id='${task}'; RAISE EXCEPTION 'Unknown field accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END; END $$;
    UPDATE tasks SET deleted_at=now(),version=version+1 WHERE id='${task}';
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM planning_time WHERE id='${log}') THEN RAISE EXCEPTION 'Soft deletion lost time history'; END IF; END $$;
    COMMIT;`,
    "Projection/time/outbox SQL contracts",
  );
  const fresh = await initialize("fresh");
  await sql(fresh, await commands(new Set()), "Fresh migration controller");
  await sql(
    fresh,
    `DO $$ BEGIN IF (SELECT max(version) FROM schema_migrations)<>${latest} OR to_regclass('public.planning_time') IS NULL THEN RAISE EXCEPTION 'Fresh schema incomplete'; END IF; END $$;`,
    "Fresh schema assertion",
  );
  state = "passed";
  console.log(
    `Planning lab offline SQL gate passed: fresh schema, 45→${latest}, rerun, exact source/state preservation, projection, time isolation and coalesced non-recursive outbox. HTTP/concurrency/browser gates are separate.`,
  );
} finally {
  await writeFile(
    join(root, "result.json"),
    JSON.stringify(
      {
        state,
        from: 45,
        to: latest,
        mode: "offline-single-user",
        at: new Date().toISOString(),
        http: false,
        concurrency: false,
        browser: false,
      },
      null,
      2,
    ),
  );
  console.log(`Isolated evidence: ${root}`);
}
