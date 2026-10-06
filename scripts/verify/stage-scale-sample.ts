import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import type pg from "pg";
import { stageDatabase } from "./stage-fixtures";
import type { StageScaleFixture } from "./stage-scale-fixtures";

const source = resolve(process.argv[2] ?? ""),
  fixturePath = resolve(process.argv[3] ?? ""),
  output = resolve(process.argv[4] ?? "");
const runRoot = resolve(fixturePath, "..");
assert(
  runRoot.startsWith(resolve("data/reliability-")) &&
    (await realpath(runRoot)) === runRoot,
);
assert(
  output.startsWith(runRoot + "/") &&
    [process.cwd(), join(runRoot, "baseline")].includes(source),
);
const control = await stageDatabase();
await control.end();
const fixture = JSON.parse(
  await readFile(fixturePath, "utf8"),
) as StageScaleFixture;
assert(
  fixture.tasks === 100000 &&
    fixture.spaces.length === 20 &&
    fixture.rows === 5000,
);
const load = (name: string) =>
  import(pathToFileURL(join(source, "packages/shared/src", name + ".ts")).href);
const database = await load("db"),
  planning = await load("planning-api"),
  expansion = await load("planning-expansion-api");
let queryCount = 0;
const pool = database.pool as pg.Pool,
  originals = new WeakMap<pg.PoolClient, pg.PoolClient["query"]>();
pool.on("acquire", (client) => {
  const original = client.query;
  originals.set(client, original);
  client.query = ((...args: unknown[]) => {
    queryCount++;
    return Reflect.apply(original, client, args);
  }) as typeof client.query;
});
pool.on("release", (_error, client) => {
  const original = originals.get(client);
  if (original) client.query = original;
  originals.delete(client);
});
const cases = [
  {
    name: "planning-5000",
    path: `spaces/${fixture.space}/planning?limit=5000`,
    handler: planning.planningApi,
    summarize: (value: any) => {
      assert.equal(value.total, 5000);
      assert.equal(value.items.length, 5000);
      assert(
        value.items.every((t: any) => t.body === undefined || t.body === ""),
      );
      return {
        total: value.total,
        ids: value.items.map((t: any) => t.id),
        completed: value.completed,
      };
    },
  },
  {
    name: "portfolio-100000",
    path: `groups/${fixture.group}/portfolio?portfolio=${fixture.portfolio}`,
    handler: expansion.planningExpansionApi,
    summarize: (value: any) => {
      assert.equal(value.spaces.length, 20);
      assert.equal(
        value.spaces.reduce((n: number, s: any) => n + s.total, 0),
        100000,
      );
      return value.spaces.map((s: any) => ({
        id: s.id,
        total: s.total,
        completed: s.completed,
        estimatedHours: s.estimatedHours,
      }));
    },
  },
  {
    name: "capacity-100000",
    path: `groups/${fixture.group}/capacity?portfolio=${fixture.portfolio}&start=2026-10-05&weeks=12`,
    handler: expansion.planningExpansionApi,
    summarize: (value: any) => value,
  },
];
const reports: Record<
  string,
  { samples: number[]; queries: number[]; resultHash: string }
> = {};
let passed = false,
  error: string | undefined;
try {
  for (const scenario of cases) {
    const samples: number[] = [],
      queries: number[] = [];
    let resultHash = "";
    const report = { samples, queries, resultHash };
    reports[scenario.name] = report;
    for (let i = 0; i < 23; i++) {
      const before = queryCount,
        started = performance.now();
      const request = new Request(
        `http://localhost:3004/api/v1/${scenario.path}`,
      );
      const response: Response | null = await scenario.handler(
        request,
        scenario.path.split("?")[0].split("/"),
        fixture.owner,
      );
      assert(response?.ok, `Real ${scenario.name} handler failed`);
      const value = await response.json(),
        elapsed = performance.now() - started;
      const hash = createHash("sha256")
        .update(JSON.stringify(scenario.summarize(value)))
        .digest("hex");
      if (resultHash)
        assert.equal(
          hash,
          resultHash,
          "Measured source results changed between samples.",
        );
      resultHash = hash;
      report.resultHash = hash;
      if (i >= 3) {
        samples.push(elapsed);
        queries.push(queryCount - before);
      }
    }
  }
  passed = true;
} catch (e) {
  error = (e as Error).message;
  throw e;
} finally {
  try {
    await writeFile(
      output,
      JSON.stringify(
        {
          node: process.version,
          platform: process.platform,
          architecture: process.arch,
          reports,
          passed,
          error,
          peakRssKb: process.resourceUsage().maxRSS,
          scope:
            "Actual authorization/SQL/serialization handlers, not network or browser input-to-paint latency.",
          warmups: 3,
          measured: 20,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } finally {
    await pool.end();
  }
}
