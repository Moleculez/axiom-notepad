/** Seed only the drained, owned disposable pair; never a working dataset. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as Y from "yjs";
import { stageDatabase, stageFixture } from "./stage-fixtures";
import {
  assertPopulatedRecovery,
  requiredRecoveryTables,
} from "./stage-acceptance-contract";

const directory = resolve(process.argv[2] ?? "");
assert(
  directory.startsWith(resolve("data/reliability-")) &&
    (await realpath(directory)) === directory,
);
const db = await stageDatabase(process.env, false);
try {
  const f = await stageFixture(db, "Populated paired recovery"),
    doc = new Y.Doc();
  doc.clientID = 340047;
  doc
    .getText("markdown")
    .insert(0, "# Synthetic evidence\r\n\r\nAn observation is not proof.\r\n");
  const vector = Y.encodeStateVector(doc);
  doc
    .getText("markdown")
    .insert(
      doc.getText("markdown").length,
      "\r\nA saved local journal survives recovery.\r\n",
    );
  const state = Buffer.from(Y.encodeStateAsUpdate(doc)),
    delta = Buffer.from(Y.encodeStateAsUpdate(doc, vector)),
    source = doc.getText("markdown").toString();
  doc.destroy();
  const key = randomUUID(),
    attachment = randomUUID(),
    bytes = Buffer.from("Synthetic paired-recovery evidence.\n");
  const { putAttachment } = await import("../../packages/shared/src/storage");
  const { sealCredential } =
    await import("../../packages/shared/src/tool-providers");
  const { assistantContext } =
    await import("../../packages/shared/src/assistant-service");
  const { storeAssistantReview } =
    await import("../../packages/shared/src/assistant-run-review");
  await putAttachment(key, bytes, "text/plain");
  await db.query("BEGIN");
  try {
    await db.query("UPDATE notes SET body=$2,version=version+1 WHERE id=$1", [
      f.note,
      source,
    ]);
    await db.query(
      "INSERT INTO documents(room,note_id,state,revision) VALUES($1,$2,$3,7)",
      [`${f.note}:1`, f.note, state],
    );
    await db.query("INSERT INTO document_updates(room,data) VALUES($1,$2)", [
      `${f.note}:1`,
      delta,
    ]);
    await db.query(
      "INSERT INTO snapshots(note_id,title,body,state,generation,label,author_id) VALUES($1,'Synthetic saved milestone',$2,$3,1,'Paired recovery',$4)",
      [f.note, source, state, f.owner],
    );
    await db.query(
      "INSERT INTO attachments(id,note_id,name,mime,bytes,storage_key,sha256) VALUES($1,$2,'recovery-evidence.txt','text/plain',$3,$4,$5)",
      [
        attachment,
        f.note,
        bytes.length,
        key,
        createHash("sha256").update(bytes).digest("hex"),
      ],
    );
    const field = randomUUID(),
      entry = randomUUID(),
      rule = randomUUID(),
      automation = randomUUID();
    await db.query(
      "INSERT INTO planning_fields(id,space_id,name,kind,unit,created_by) VALUES($1,$2,'Measured quantity','number','mg',$3)",
      [field, f.space, f.owner],
    );
    await db.query(
      "UPDATE tasks SET custom_fields=$2,version=version+1 WHERE id=$1",
      [f.task, JSON.stringify({ [field]: 2.5 })],
    );
    await db.query(
      "INSERT INTO planning_time(id,space_id,task_id,author_id,spent_on,minutes,note) VALUES($1,$2,$3,$4,'2026-01-01',45,'Synthetic manual work')",
      [entry, f.space, f.task, f.member],
    );
    await db.query(
      "INSERT INTO planning_time_history(entry_id,space_id,actor_id,reason,after_data) SELECT id,space_id,$2,'Verified synthetic correction',to_jsonb(t) FROM planning_time t WHERE id=$1",
      [entry, f.owner],
    );
    const config = {
      name: "Paused recovery rule",
      trigger: "changed",
      watched: ["priority"],
      conditions: [],
      actions: [{ kind: "status", value: "in_progress" }],
      enabled: false,
      archived: false,
      at: "09:00",
    };
    await db.query(
      "INSERT INTO planning_automations(id,space_id,name,config,configured_by) VALUES($1,$2,$3,$4,$5)",
      [rule, f.space, config.name, JSON.stringify(config), f.owner],
    );
    await db.query(
      "INSERT INTO planning_automation_runs(id,space_id,rule_id,rule_version,field_version,event_key,changes,status) VALUES($1,$2,$3,1,1,'synthetic-recovery',$4,'pending')",
      [
        automation,
        f.space,
        rule,
        JSON.stringify([
          {
            id: f.task,
            version: 2,
            before: { status: "todo" },
            after: { status: "in_progress" },
          },
        ]),
      ],
    );
    await db.query(
      "INSERT INTO planning_automation_events(space_id,task_id,task_version,kind,before_data,after_data) SELECT space_id,id,version,'changed','{}',jsonb_build_object('id',id,'version',version,'priority',priority) FROM tasks WHERE id=$1",
      [f.task],
    );
    const provider = randomUUID(),
      conversation = randomUUID();
    await db.query(
      "INSERT INTO tool_providers(id,group_id,name,kind,endpoint,model,credential,capabilities,enabled) VALUES($1,$2,'Synthetic recovery provider','private','http://127.0.0.1:8096/v1/','synthetic-only',$3,ARRAY['assistant'],true)",
      [provider, f.group, sealCredential("assistant-fixture-token")],
    );
    await db.query(
      "INSERT INTO assistant_conversations(id,owner_id,space_id,space_ids,title) VALUES($1,$2,$3,ARRAY[$3::uuid],'Synthetic recovery conversation')",
      [conversation, f.owner, f.space],
    );
    const jobs: { id: string; context: string }[] = [];
    for (const kind of ["held", "confirmed", "uncertain"] as const) {
      const context = randomUUID(),
        id = randomUUID();
      const messages = [
        {
          role: "user",
          content: JSON.stringify({
            request: "Synthetic recovery receipt",
            mode: "ask",
            primaryWorkspace: f.space,
            evidence: [],
          }),
        },
      ];
      await db.query(
        "INSERT INTO assistant_contexts(id,conversation_id,provider_id,provider_version,prompt,evidence,messages,fingerprint,conversation_version,agent_config,submitted_at) VALUES($1,$2,$3,1,'Synthetic recovery receipt','[]',$4,$5,1,$6,now())",
        [
          context,
          conversation,
          provider,
          JSON.stringify(messages),
          createHash("sha256").update(context).digest("hex"),
          JSON.stringify({
            mode: "ask",
            discover: false,
            budget: { maxRounds: 4, maxOutputTokens: 1024 },
          }),
        ],
      );
      await db.query(
        "INSERT INTO tool_jobs(id,owner_id,provider_id,kind,assistant_context_id,status) VALUES($1,$2,$3,'assistant',$4,$5)",
        [
          id,
          f.owner,
          provider,
          context,
          kind === "held"
            ? "awaiting-review"
            : kind === "confirmed"
              ? "failed"
              : "uncertain",
        ],
      );
      await db.query(
        "INSERT INTO assistant_runs(id,context_id) VALUES($1,$2)",
        [id, context],
      );
      const captured = await assistantContext(
        context,
        f.owner,
        db as unknown as import("pg").PoolClient,
      );
      const review = await storeAssistantReview(
        db as unknown as import("pg").PoolClient,
        captured,
        id,
        1,
        [],
        [],
        { maxRounds: 4, maxOutputTokens: 1024 },
      );
      if (kind !== "held") {
        await db.query(
          "UPDATE assistant_run_reviews SET state='approved',approved_at=now(),approval_mutation_id=$2 WHERE id=$1",
          [review.id, randomUUID()],
        );
        await db.query(
          "INSERT INTO assistant_run_steps(run_id,ordinal,provider_id,review_id,usage,response,outcome,completed_at,request_characters) VALUES($1,1,$2,$3,$4,$5,$6,CASE WHEN $6='complete' THEN now() END,128)",
          [
            id,
            provider,
            review.id,
            kind === "confirmed"
              ? JSON.stringify({ input: null, output: 20 })
              : null,
            kind === "confirmed"
              ? JSON.stringify({
                  text: JSON.stringify({
                    answer: "Synthetic saved response",
                    actions: [],
                    reads: [],
                    done: true,
                  }),
                })
              : null,
            kind === "confirmed" ? "complete" : "uncertain",
          ],
        );
      }
      jobs.push({ id, context });
    }
    const set = randomUUID(),
      remaining = randomUUID(),
      folder = randomUUID();
    await db.query(
      "INSERT INTO resources(id,space_id,kind,name,owner_id) VALUES($1,$2,'folder','Confirmed synthetic output',$3)",
      [folder, f.space, f.owner],
    );
    await db.query(
      "INSERT INTO workspace_change_sets(id,owner_id,context_id,run_id,title,space_ids,request_hash,status) VALUES($1,$2,$3,$4,'Partially completed synthetic set',ARRAY[$5::uuid],$6,'partial')",
      [
        set,
        f.owner,
        jobs[1].context,
        jobs[1].id,
        f.space,
        createHash("sha256").update(set).digest("hex"),
      ],
    );
    for (const [position, state] of [
      "complete",
      "pending",
      "uncertain",
    ].entries()) {
      const key = `action-${position}`,
        entity = position === 0 ? folder : randomUUID();
      const action = {
        key,
        action: "folder_create",
        spaceId: f.space,
        title: "Synthetic recovery action",
        payload: { kind: "folder", name: "Synthetic output" },
        dependsOn: [],
        explanation: "Recovery fixture only",
      };
      await db.query(
        "INSERT INTO workspace_change_actions(set_id,key,position,entity_id,data,selected,state,result,completed_at) VALUES($1,$2,$3,$4,$5,true,$6,$7,CASE WHEN $6='complete' THEN now() END)",
        [
          set,
          key,
          position,
          entity,
          JSON.stringify(action),
          state,
          position === 0 ? JSON.stringify({ id: folder }) : null,
        ],
      );
    }
    await db.query(
      "INSERT INTO workspace_change_sets(id,owner_id,title,space_ids,request_hash,recovery_of) VALUES($1,$2,'Remaining-only synthetic receipt',ARRAY[$3::uuid],$4,$5)",
      [
        remaining,
        f.owner,
        f.space,
        createHash("sha256").update(remaining).digest("hex"),
        set,
      ],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  const counts: Record<string, number> = {};
  for (const table of requiredRecoveryTables)
    counts[table] = Number(
      (await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n,
    );
  assertPopulatedRecovery(counts);
  await writeFile(
    join(directory, "recovery-fixtures.json"),
    JSON.stringify(
      {
        populated: true,
        counts,
        source:
          "Owned synthetic fixture seeded after all services drained; no fixture provider calls.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
} finally {
  await db.end();
  await (await import("../../packages/shared/src/db")).pool.end();
}
