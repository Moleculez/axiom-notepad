/** Test-only process wrapper: actual worker functions, SQL and commits; no HTTP hooks. */
import assert from "node:assert/strict";
import type pg from "pg";
import { stageDatabase } from "./stage-fixtures";

const control = await stageDatabase();
await control.end();
const mode = process.argv[2],
  barrier = process.argv[3] ?? "",
  clock = process.argv[4];
assert(["planning", "tool"].includes(mode));
if (clock) {
  assert(
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(clock) &&
      Number.isFinite(Date.parse(clock)),
  );
  const OriginalDate = Date;
  globalThis.Date = new Proxy(OriginalDate, {
    construct(target, args) {
      return Reflect.construct(target, args.length ? args : [clock]);
    },
    get(target, property, receiver) {
      return property === "now"
        ? () => OriginalDate.parse(clock)
        : Reflect.get(target, property, receiver);
    },
  });
}
const { pool } = await import("../../packages/shared/src/db");
let held = false;
const originals = new WeakMap<pg.PoolClient, pg.PoolClient["query"]>();
// Instrument only these process-owned clients, including pool.query's callback
// path. Preserve actual results and lock lifetimes; no SQL rows are mocked.
pool.on("acquire", (client) => {
  // A checkpoint belongs to this transaction, not a cancellation-monitor client.
  let observed = false;
  const original = client.query,
    query = original.bind(client);
  originals.set(client, original);
  client.query = ((
    input: string,
    values?: unknown[] | ((e: Error | null, r?: pg.QueryResult) => void),
    callback?: (e: Error | null, r?: pg.QueryResult) => void,
  ) => {
    const cb = typeof values === "function" ? values : callback;
    const work = async () => {
      let sql = input;
      if (clock) sql = sql.replace(/\bnow\(\)/g, `timestamptz '${clock}'`);
      if (
        barrier === "planning-before-commit" &&
        input.includes("INSERT INTO planning_automation_runs")
      )
        observed = true;
      if (
        barrier === "after-confirmed" &&
        input.includes("UPDATE assistant_run_steps SET usage=")
      )
        observed = true;
      if (
        barrier === "after-checkpoint" &&
        input.includes("UPDATE assistant_runs SET round=")
      )
        observed = true;
      const commit = /^COMMIT$/i.test(input);
      const hold = async () => {
        if (held || !observed || !commit) return;
        held = true;
        if (!process.send)
          throw new Error(
            "A controlled barrier requires the acceptance parent.",
          );
        process.send({ kind: "barrier", point: barrier });
        await new Promise<void>((done, fail) => {
          const timer = setTimeout(() => {
            process.removeListener("message", release);
            fail(
              new Error("Parent did not release the test-only worker barrier."),
            );
          }, 30000);
          const release = (message: unknown) => {
            if ((message as { kind?: string })?.kind === "release") {
              clearTimeout(timer);
              process.removeListener("message", release);
              done();
            }
          };
          process.on("message", release);
        });
      };
      if (barrier === "planning-before-commit") await hold();
      const result = await query(
        sql,
        Array.isArray(values) ? values : undefined,
      );
      if (barrier !== "planning-before-commit") await hold();
      return result;
    };
    if (cb) {
      void work().then(
        (r) => cb(null, r),
        (e) => cb(e),
      );
      return;
    }
    return work();
  }) as typeof client.query;
});
pool.on("release", (_error, client) => {
  const original = originals.get(client);
  if (original) client.query = original;
  originals.delete(client);
});
try {
  const worked =
    mode === "planning"
      ? await (
          await import("../../packages/shared/src/planning-automation-api")
        ).processPlanningAutomation()
      : await (
          await import("../../packages/shared/src/tool-jobs")
        ).processToolJob();
  process.send?.({ kind: "complete", worked });
} finally {
  await pool.end();
}
