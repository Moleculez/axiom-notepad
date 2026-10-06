import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { acceptanceCommand } from "./acceptance-process";
import {
  acceptanceEnvironment,
  compareScaleSamples,
  acceptanceScaleCases,
} from "./stage-acceptance-contract";
import { stageDatabase } from "./stage-fixtures";
import { seedStageScale, type StageScaleFixture } from "./stage-scale-fixtures";

const directory = resolve(process.argv[2] ?? "");
assert(
  directory.startsWith(resolve("data/reliability-")) &&
    (await realpath(directory)) === directory,
);
let fixture: StageScaleFixture | undefined, commit: string | undefined;
let passed = false,
  error: string | undefined,
  step = "fixture";
const comparisons: Record<string, unknown> = {};
const file = join(directory, "scale-fixture.json");
const baseline = join(directory, "baseline"),
  archive = join(directory, "baseline.tar");
const clean = acceptanceEnvironment(process.env);
const dependencyLockHash = createHash("sha256")
  .update(await readFile("package-lock.json"))
  .digest("hex");
try {
  const db = await stageDatabase();
  try {
    fixture = await seedStageScale(db);
  } finally {
    await db.end();
  }
  await writeFile(file, JSON.stringify(fixture), { mode: 0o600 });
  step = "baseline-source";
  await mkdir(baseline);
  commit = (
    await acceptanceCommand(
      "git",
      ["rev-parse", "--verify", "7cd2cc5^{commit}"],
      { env: clean, quiet: true },
    )
  ).trim();
  const tree = await acceptanceCommand(
    "git",
    ["ls-tree", "-r", commit, "--", "packages/shared/src"],
    { env: clean, quiet: true },
  );
  assert(
    tree
      .trim()
      .split("\n")
      .every((line) =>
        /^100(?:644|755) blob [a-f0-9]+\tpackages\/shared\/src\/(?!.*(?:^|\/)\.\.(?:\/|$))/.test(
          line,
        ),
      ),
    "Baseline source archive must contain only regular reviewed source files.",
  );
  await acceptanceCommand(
    "git",
    [
      "archive",
      "--format=tar",
      `--output=${archive}`,
      commit,
      "packages/shared/src",
    ],
    { env: clean, quiet: true },
  );
  await acceptanceCommand("tar", ["-xf", archive, "-C", baseline], {
    env: clean,
    quiet: true,
  });
  const run = async (source: string, name: string) => {
    const output = join(directory, name);
    await acceptanceCommand(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/verify/stage-scale-sample.ts",
        source,
        file,
        output,
      ],
      { env: process.env },
    );
    return JSON.parse(await readFile(output, "utf8"));
  };
  step = "common-samples";
  const before = await run(baseline, "scale-baseline.json"),
    after = await run(process.cwd(), "scale-candidate.json");
  assert(
    before.passed && after.passed,
    "Both raw sample receipts must have completed.",
  );
  assert.deepEqual(
    Object.keys(before.reports).sort(),
    [...acceptanceScaleCases].sort(),
  );
  assert.deepEqual(
    Object.keys(after.reports).sort(),
    [...acceptanceScaleCases].sort(),
  );
  for (const name of acceptanceScaleCases) {
    assert.equal(
      before.reports[name].resultHash,
      after.reports[name].resultHash,
      `Common ${name} semantics differ between sources.`,
    );
    const comparison = compareScaleSamples(
      before.reports[name].samples,
      after.reports[name].samples,
    );
    comparisons[name] = comparison;
    assert(
      comparison.passed,
      `${name} p95 regressed ${(100 * (comparison.ratio - 1)).toFixed(1)}%, above the 20% budget. No outliers or failed runs were discarded.`,
    );
  }
  // New-only metadata cannot be assigned a fictitious historical timing.
  step = "lab-only-summary";
  const live = await stageDatabase();
  try {
    const field = (
      await live.query(
        "INSERT INTO planning_fields(space_id,name,kind,unit,created_by) VALUES($1,'Measured sample','number','mg',$2) RETURNING id",
        [fixture.space, fixture.owner],
      )
    ).rows[0].id;
    await live.query(
      "UPDATE tasks SET custom_fields=jsonb_build_object($2::text,(position%101)::numeric/10),version=version+1 WHERE space_id=$1",
      [fixture.space, field],
    );
    await live.query("ANALYZE planning_field_values");
    const { planningApi } =
      await import("../../packages/shared/src/planning-api");
    const samples: number[] = [];
    const path = `spaces/${fixture.space}/planning?limit=5000&includeFields=${field}`;
    for (let i = 0; i < 23; i++) {
      const start = performance.now(),
        response = await planningApi(
          new Request(`http://localhost:3004/api/v1/${path}`),
          ["spaces", fixture.space, "planning"],
          fixture.owner,
        );
      assert(response?.ok);
      const value = await response.json();
      assert.equal(value.items.length, 5000);
      assert.equal(value.fields.length, 1);
      assert(
        value.items.every((item: any) =>
          Object.hasOwn(item.field_summaries, field),
        ),
      );
      if (i >= 3) samples.push(performance.now() - start);
    }
    await writeFile(
      join(directory, "scale-lab-only.json"),
      JSON.stringify(
        {
          samples,
          historicalBaseline: null,
          scope:
            "New-only field summaries; reported separately, no historical regression claim.",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } finally {
    await live.end();
    await (await import("../../packages/shared/src/db")).pool.end();
  }
  passed = true;
} catch (e) {
  error = (e as Error).message;
  throw e;
} finally {
  await writeFile(
    join(directory, "scale.json"),
    JSON.stringify(
      {
        passed,
        baselineCommit: commit,
        fixture,
        dependencyLockHash,
        step,
        comparisons,
        error,
        raw: [
          "scale-baseline.json",
          "scale-candidate.json",
          "scale-lab-only.json",
        ],
        scope:
          "Same host, dependency lockfile and disposable shared-schema data. Server-handler p95; network/visual acceptance is separate.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
