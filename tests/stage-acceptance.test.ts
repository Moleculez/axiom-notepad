import { describe, it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  unlink,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acceptanceEnvironment,
  parseAcceptanceArguments,
  emptyAcceptancePhases,
  acceptanceSoftwareState,
  compareScaleSamples,
  codeFingerprint,
  requiredRecoveryTables,
  assertPopulatedRecovery,
  isAcceptanceEnvironmentError,
} from "../scripts/verify/stage-acceptance-contract";
import {
  acceptanceLock,
  preserveGeneratedTypes,
  acceptanceCommand,
  AcceptanceCommandError,
  spawnAcceptanceChild,
  stopAcceptanceChild,
} from "../scripts/verify/acceptance-process";
import {
  ownedRuntimeReceipt,
  ownedRuntimeArtifact,
} from "../scripts/verify/acceptance-artifacts";
import {
  insertScaleTasks,
  scaleTaskId,
} from "../scripts/verify/stage-scale-fixtures";

describe("Stage 3–4 acceptance contracts", () => {
  it("defaults to every desktop browser and rejects hidden narrowing arguments", () => {
    expect(parseAcceptanceArguments([]).browsers).toEqual([
      "chromium",
      "firefox",
      "webkit",
    ]);
    expect(
      parseAcceptanceArguments(["--project=firefox", "--project=firefox"])
        .browsers,
    ).toEqual(["firefox"]);
    expect(() => parseAcceptanceArguments(["--grep=only-one-test"])).toThrow();
    expect(() => parseAcceptanceArguments(["--project=unknown"])).toThrow();
    expect(parseAcceptanceArguments(["--preflight-only"]).preflightOnly).toBe(
      true,
    );
  });
  it("does not pass ambient research credentials, proxies, preload or test target overrides", () => {
    const env = acceptanceEnvironment({
      PATH: "/bin",
      HOME: "/synthetic",
      PG_BIN: "/test/pg",
      DATABASE_URL: "private",
      TOOL_PROVIDER_KEY: "private",
      AXIOM_LIVE_PROVIDER_CREDENTIAL: "private",
      NODE_OPTIONS: "--require=private",
      HTTPS_PROXY: "private",
      AXIOM_RELIABILITY_DATABASE_URL: "private",
      STORAGE_PATH: "private",
    });
    expect(env).toEqual({
      PATH: "/bin",
      HOME: "/synthetic",
      PG_BIN: "/test/pg",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "development",
    });
  });
  it("never promotes a partial or blocked matrix", () => {
    const phases = emptyAcceptancePhases();
    expect(acceptanceSoftwareState(phases)).toBe("pending");
    phases.preflight.state = "blocked";
    expect(acceptanceSoftwareState(phases)).toBe("blocked");
    phases.preflight.state = "failed";
    expect(acceptanceSoftwareState(phases)).toBe("failed");
    for (const phase of Object.values(phases)) phase.state = "passed";
    expect(acceptanceSoftwareState(phases)).toBe("passed");
    expect(acceptanceSoftwareState(phases, ["chromium"])).toBe("pending");
  });
  it("requires nonempty coverage for every new recovery ledger", () => {
    const counts = Object.fromEntries(
      requiredRecoveryTables.map((t) => [t, 1]),
    );
    expect(() => assertPopulatedRecovery(counts)).not.toThrow();
    counts.assistant_run_reviews = 0;
    expect(() => assertPopulatedRecovery(counts)).toThrow(
      /assistant_run_reviews/,
    );
    counts.assistant_run_reviews = Number.NaN;
    expect(() => assertPopulatedRecovery(counts)).toThrow();
  });
  it("uses p95 and the exact twenty-sample 20 percent budget", () => {
    const samples = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(
      compareScaleSamples(
        samples,
        samples.map((x) => x * 1.2),
      ).passed,
    ).toBe(true);
    expect(
      compareScaleSamples(
        samples,
        samples.map((x) => x * 1.21),
      ).passed,
    ).toBe(false);
    expect(() => compareScaleSamples([1], [1])).toThrow();
    expect(() => compareScaleSamples(Array(20).fill(0), samples)).toThrow();
    expect(() => compareScaleSamples(samples, Array(20).fill(NaN))).toThrow();
  });
  it("fingerprints source names and exact bytes, independent of enumeration order", () => {
    const files = [
      { path: "a.ts", bytes: Buffer.from("a") },
      { path: "b.ts", bytes: Buffer.from("b") },
    ];
    expect(codeFingerprint(files)).toBe(codeFingerprint([...files].reverse()));
    expect(codeFingerprint(files)).not.toBe(
      codeFingerprint([
        { path: "b.ts", bytes: Buffer.from("a") },
        { path: "a.ts", bytes: Buffer.from("b") },
      ]),
    );
  });
  it("distinguishes environmental refusal from functional regression", () => {
    expect(
      isAcceptanceEnvironmentError(new DOMException("Aborted", "AbortError")),
    ).toBe(true);
    expect(isAcceptanceEnvironmentError({ code: "EPERM" })).toBe(true);
    expect(
      isAcceptanceEnvironmentError(new Error("Operation not permitted")),
    ).toBe(true);
    expect(
      isAcceptanceEnvironmentError(new Error("Expected one run, found two")),
    ).toBe(false);
  });
  it("restores the exact dirty generated file even after a failed build", async () => {
    const root = await mkdtemp(join(tmpdir(), "axiom-type-selection-"));
    await mkdir(join(root, "apps/web"), { recursive: true });
    const path = join(root, "apps/web/next-env.d.ts"),
      original = Buffer.from("existing dirty selection\r\n");
    await writeFile(path, original);
    await expect(
      preserveGeneratedTypes(root, async () => {
        await writeFile(path, "changed build selection\n");
        throw new Error("build failed");
      }),
    ).rejects.toThrow("build failed");
    expect(await readFile(path)).toEqual(original);
  });
  it("refuses competing or abandoned locks without removing them", async () => {
    const root = await mkdtemp(join(tmpdir(), "axiom-acceptance-lock-")),
      path = join(root, "lock");
    const release = await acceptanceLock(path);
    await expect(acceptanceLock(path)).rejects.toMatchObject({
      code: "EEXIST",
    });
    await release();
    const releaseAgain = await acceptanceLock(path);
    await releaseAgain();
  });
  it("does not remove a lock whose ownership changed", async () => {
    const root = await mkdtemp(join(tmpdir(), "axiom-acceptance-owner-")),
      path = join(root, "lock");
    const release = await acceptanceLock(path);
    await writeFile(path, JSON.stringify({ token: "different-owner" }));
    await expect(release()).rejects.toThrow(/ownership changed/);
    expect(JSON.parse(await readFile(path, "utf8")).token).toBe(
      "different-owner",
    );
  });
  it("restores a generated file removed by a failed build", async () => {
    const root = await mkdtemp(join(tmpdir(), "axiom-acceptance-types-"));
    await mkdir(join(root, "apps/web"), { recursive: true });
    const path = join(root, "apps/web/next-env.d.ts");
    await writeFile(path, "dirty original\n");
    await expect(
      preserveGeneratedTypes(root, async () => {
        await unlink(path);
        throw new Error("failed build");
      }),
    ).rejects.toThrow("failed build");
    expect(await readFile(path, "utf8")).toBe("dirty original\n");
  });
  it("retains failed child output so an interrupted runtime receipt can be inspected", async () => {
    const env = acceptanceEnvironment(process.env);
    await expect(
      acceptanceCommand(
        process.execPath,
        ["-e", "console.log('safe diagnostic'); process.exitCode=3"],
        { env, quiet: true },
      ),
    ).rejects.toMatchObject({
      output: expect.stringContaining("safe diagnostic"),
    });
    expect(new AcceptanceCommandError("failed", "receipt")).toBeInstanceOf(
      Error,
    );
  });
  it("checks real artifact ownership, including traversal and symlink redirects", async () => {
    const root = await realpath(
        await mkdtemp(join(tmpdir(), "axiom-artifacts-")),
      ),
      directory = join(root, "data/reliability-owned");
    await mkdir(directory, { recursive: true });
    const receipt = join(directory, "receipt.json"),
      artifact = join(directory, "scale.json");
    await writeFile(receipt, "{}");
    await writeFile(artifact, "{}");
    expect(
      await ownedRuntimeReceipt(
        root,
        `Isolated failed receipt: ${receipt}. Fixture data is retained.`,
      ),
    ).toBe(receipt);
    expect(await ownedRuntimeArtifact(receipt, "scale.json")).toBe(artifact);
    await expect(
      ownedRuntimeArtifact(receipt, "../elsewhere.json"),
    ).rejects.toThrow(/escaped/);
    await expect(
      ownedRuntimeReceipt(
        root,
        `Isolated passed receipt: ${root}/receipt.json`,
      ),
    ).rejects.toThrow(/escaped/);
    const external = join(root, "external.json");
    await writeFile(external, "{}");
    await symlink(external, join(directory, "redirect.json"));
    await expect(
      ownedRuntimeArtifact(receipt, "redirect.json"),
    ).rejects.toThrow(/escaped/);
    await expect(ownedRuntimeReceipt(root, "no receipt")).rejects.toThrow(
      /did not produce/,
    );
  });
  it("uses repeatable namespace-isolated scale IDs and refuses invalid batches before SQL", async () => {
    const id = scaleTaskId("fixture-a", 42);
    expect(id).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    expect(id).toBe(scaleTaskId("fixture-a", 42));
    expect(id).not.toBe(scaleTaskId("fixture-b", 42));
    expect(
      new Set(
        Array.from({ length: 5000 }, (_, i) => scaleTaskId("fixture-a", i)),
      ).size,
    ).toBe(5000);
    for (const count of [0, 5001, 1.5, NaN])
      await expect(
        insertScaleTasks({} as never, "fixture-a", "owner", count),
      ).rejects.toThrow(/batches/);
  });
  it("stops only its own process and tolerates repeated cleanup", async () => {
    const child = spawnAcceptanceChild(
      process.execPath,
      ["-e", "process.send('ready'); setInterval(()=>{},1000)"],
      {
        env: acceptanceEnvironment(process.env),
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    const unrelated = spawnAcceptanceChild(
      process.execPath,
      ["-e", "process.send('ready'); setInterval(()=>{},1000)"],
      {
        env: acceptanceEnvironment(process.env),
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    const ready = (value: typeof child) =>
      new Promise<void>((done, fail) => {
        value.once("message", () => done());
        value.once("error", fail);
      });
    try {
      await Promise.all([ready(child), ready(unrelated)]);
      await stopAcceptanceChild(child, 300);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(unrelated.exitCode).toBeNull();
      expect(unrelated.signalCode).toBeNull();
      await stopAcceptanceChild(child, 300);
    } finally {
      await Promise.all([
        stopAcceptanceChild(child, 300),
        stopAcceptanceChild(unrelated, 300),
      ]);
    }
  });
  it.skipIf(process.platform === "win32")(
    "drains a wrapper's owned descendant even after the wrapper exits",
    async () => {
      const child = spawnAcceptanceChild(
        process.execPath,
        [
          "-e",
          `
      const {spawn}=require('node:child_process');
      const nested=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); process.send('ready'); setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});
      nested.once('message',()=>process.send({pid:nested.pid}));
      process.on('SIGTERM',()=>process.exit(0));
    `,
        ],
        {
          env: acceptanceEnvironment(process.env),
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
      let descendant: number | undefined;
      try {
        descendant = await new Promise<number>((done, fail) => {
          child.once("message", (m: any) => done(m.pid));
          child.once("error", fail);
        });
        await stopAcceptanceChild(child, 300);
        expect(() => process.kill(descendant!, 0)).toThrow();
      } finally {
        await stopAcceptanceChild(child, 300);
      }
    },
  );
  it("records interruption instead of passing an aborted command", async () => {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 150);
    try {
      await expect(
        acceptanceCommand(
          process.execPath,
          ["-e", "setInterval(()=>{},1000)"],
          {
            env: acceptanceEnvironment(process.env),
            quiet: true,
            signal: controller.signal,
          },
        ),
      ).rejects.toThrow(/Acceptance interrupted/);
    } finally {
      clearTimeout(timer);
    }
  });
});
