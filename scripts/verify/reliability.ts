import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
import {
  stagingEnvironment,
  reliabilityStagingProfile,
} from "../../packages/shared/src/test-staging";
import { rehearseReliabilityRecovery } from "./reliability-recovery";
import {
  acceptanceLock,
  preserveGeneratedTypes,
  spawnAcceptanceChild,
  stopAcceptanceChild,
} from "./acceptance-process";
import { acceptanceEnvironment } from "./stage-acceptance-contract";

// No dotenv import: every runtime/credential below belongs to disposable fixtures.
await mkdir(resolve("data"), { recursive: true });
const directory = await mkdtemp(resolve("data/reliability-"));
const children = new Set<ChildProcess>();
const stageAcceptance = process.argv.includes("--stage-acceptance");
const browserArguments = process.argv
  .slice(2)
  .filter((a) => a !== "--stage-acceptance");
const inherited = stageAcceptance
  ? acceptanceEnvironment(process.env)
  : process.env;
let releaseLock: (() => Promise<void>) | undefined;
let races: { passed: boolean; checks: string[] } | undefined;
let scale: { passed: boolean; artifact: string } | undefined;
let failureStage: string | undefined, failure: string | undefined;
let database: EmbeddedPostgres | undefined;
let stopping: Promise<void> | undefined;
let databaseRunning = false;
let signalFailure = false;
async function freePort(port: number) {
  await new Promise<void>((done, fail) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) =>
      fail(
        Object.assign(
          new Error(
            `Cannot reserve isolated port ${port} (${error.code ?? "unknown"}); no existing service will be stopped.`,
          ),
          { code: error.code },
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? fail(error) : done())),
    );
  });
}
function child(args: string[], env: NodeJS.ProcessEnv) {
  if (signalFailure) throw new Error("Verification was interrupted.");
  const value = spawnAcceptanceChild(process.execPath, args, {
    env,
    stdio: "inherit",
  });
  children.add(value);
  // Keep handles after wrapper exit: its owned group may still have descendants.
  return value;
}
async function run(args: string[], env: NodeJS.ProcessEnv) {
  await new Promise<void>((done, fail) => {
    const value = child(args, env);
    value.once("error", fail);
    value.once("exit", (code) =>
      code === 0
        ? done()
        : fail(
            new Error(`Isolated verification failed (${code ?? "signal"}).`),
          ),
    );
  });
}
function stop() {
  return (stopping ??= stopChildren());
}
async function stopChildren() {
  try {
    await stopProcesses([...children]);
  } finally {
    if (databaseRunning) {
      await database?.stop();
      databaseRunning = false;
    }
  }
}
async function stopProcesses(values: ChildProcess[]) {
  const results = await Promise.allSettled(
    values.map((value) => stopAcceptanceChild(value)),
  );
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((r) => r.reason),
      "Owned acceptance processes did not drain.",
    );
}
const interrupted = () => {
  signalFailure = true;
  void stop().catch((error) => {
    failure = (error as Error).message;
  });
};
process.once("SIGINT", interrupted);
process.once("SIGTERM", interrupted);
let status = "failed",
  buildId: string | undefined;
const checks: string[] = [];
let recovery:
  Awaited<ReturnType<typeof rehearseReliabilityRecovery>> | undefined;
try {
  releaseLock = await acceptanceLock(resolve("data/reliability-runtime.lock"));
  failureStage = "preflight";
  await freePort(3004);
  await freePort(1236);
  await freePort(1235);
  await freePort(8096);
  let databaseUrl = inherited.AXIOM_RELIABILITY_DATABASE_URL;
  if (databaseUrl) {
    const target = new URL(databaseUrl);
    if (
      !["localhost", "127.0.0.1"].includes(target.hostname) ||
      target.pathname !== "/postgres" ||
      !["postgres:", "postgresql:"].includes(target.protocol) ||
      target.search ||
      target.hash
    )
      throw new Error(
        "CI must provide an explicit local PostgreSQL control database, not application configuration.",
      );
  } else {
    await freePort(54339);
    const password = randomBytes(24).toString("hex");
    database = new EmbeddedPostgres({
      databaseDir: join(directory, "postgres"),
      user: "axiom_test",
      password,
      port: 54339,
      persistent: true,
      postgresFlags: ["-h", "127.0.0.1"],
      onLog: () => {},
      onError: (message) => console.error(message),
    });
    await database.initialise();
    await database.start();
    databaseRunning = true;
    databaseUrl = `postgresql://axiom_test:${password}@127.0.0.1:54339/postgres`;
  }
  const emptyEnv = join(directory, "empty.env");
  await writeFile(emptyEnv, "", { mode: 0o600 });
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    DOTENV_CONFIG_PATH: emptyEnv,
    DATABASE_URL: databaseUrl,
    APP_URL: "http://localhost:3004",
    BETTER_AUTH_URL: "http://localhost:3004",
    AXIOM_ADMIN_PASSWORD: "ExtensionsTest2026!",
    NODE_ENV: "development",
    SMTP_URL: "",
    OIDC_DISCOVERY_URL: "",
    OIDC_CLIENT_ID: "",
    OIDC_CLIENT_SECRET: "",
    STORAGE_DRIVER: "local",
    STORAGE_PATH: join(directory, "unused-control-storage"),
    AXIOM_DIST_DIR: ".next/reliability-test",
    NEXT_PUBLIC_AXIOM_EDITOR_ENGINE: "milkdown",
  };
  // Build paths are isolated from both the running workbench and prior staging.
  const staging = ["--import", "tsx", "scripts/dev/reliability-staging.ts"];
  await run([...staging, "init"], env);
  checks.push("fresh database migrations");
  failureStage = "build";
  await preserveGeneratedTypes(process.cwd(), () =>
    run([...staging, "build"], env),
  );
  buildId = (
    await readFile("apps/web/.next/reliability-test/BUILD_ID", "utf8")
  ).trim();
  checks.push("optimized production build");
  await run(
    [
      ...staging,
      "admin",
      "--email",
      "extensions@axiom.local",
      "--name",
      "Reliability fixtures",
    ],
    env,
  );
  const services = ["web", "sync", "worker"].map((command) =>
    child([...staging, command], env),
  );
  const ordinaryWorkers = [services[2]];
  services.push(
    child(
      ["--import", "tsx", "scripts/verify/assistant-provider-fixture.ts"],
      env,
    ),
  );
  for (const value of services)
    value.once("error", () => {
      signalFailure = true;
    });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (
      signalFailure ||
      services.some(
        (value) => value.exitCode !== null || value.signalCode !== null,
      )
    )
      throw new Error("An isolated service stopped before acceptance.");
    const states = await Promise.all(
      [
        "http://localhost:3004/health",
        "http://127.0.0.1:1236/health",
        "http://127.0.0.1:8096/calls",
      ].map((url) =>
        fetch(url, { signal: AbortSignal.timeout(2000) })
          .then((r) => r.ok)
          .catch(() => false),
      ),
    );
    if (states.every(Boolean)) {
      ready = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready) throw new Error("Isolated services did not become ready.");
  const staged = stagingEnvironment(reliabilityStagingProfile, env);
  if (stageAcceptance) {
    failureStage = "races";
    // Drain the ordinary worker; test-owned children now control exact leases.
    await stopProcesses([services[2]]);
    await run(
      ["--import", "tsx", "scripts/verify/stage-runtime-checks.ts", directory],
      staged,
    );
    races = JSON.parse(await readFile(join(directory, "races.json"), "utf8"));
    if (!races?.passed) throw new Error("Real worker races did not pass.");
    checks.push(
      "real PostgreSQL multi-process planning/assistant races and local recovery",
    );
    const resumedWorker = child([...staging, "worker"], env);
    ordinaryWorkers.push(resumedWorker);
    services.push(resumedWorker);
  }
  failureStage = "browser";
  const extra = browserArguments;
  await run(
    [
      ...staging,
      "test",
      "--config",
      "reliability.config.ts",
      ...(extra.length ? extra : ["--project=chromium"]),
      // Playwright clears its output directory at startup. Give each run its own
      // evidence folder so a focused follow-up never erases a full matrix.
      "--output",
      join(directory, "browser-results"),
    ],
    env,
  );
  checks.push("authenticated browser workflows");
  failureStage = "durability";
  await run([...staging, "verify-durability"], env);
  checks.push(
    "sync crash, failed-save acknowledgment, journal recovery and graceful shutdown",
  );
  if (stageAcceptance) {
    failureStage = "scale";
    await stopProcesses(ordinaryWorkers);
    // Keep web/sync/provider alive for attestation, but no ordinary writer competes
    // with same-host baseline measurements. The scale children own every fixture.
    await run(
      ["--import", "tsx", "scripts/verify/stage-scale.ts", directory],
      staged,
    );
    const report = JSON.parse(
      await readFile(join(directory, "scale.json"), "utf8"),
    );
    if (!report.passed)
      throw new Error("Same-host scale comparison did not pass.");
    scale = { passed: true, artifact: "scale.json" };
    checks.push(
      "5000-row/20-workspace/100000-task same-host server-handler p95 scale budget",
    );
  }
  await stopProcesses(services);
  failureStage = "recovery";
  await run(
    ["--import", "tsx", "scripts/verify/stage-recovery-fixture.ts", directory],
    staged,
  );
  recovery = await rehearseReliabilityRecovery(
    stagingEnvironment(reliabilityStagingProfile, env),
    directory,
    run,
  );
  checks.push("paired database/blob recovery and overwrite refusal");
  if (signalFailure) throw new Error("Verification was interrupted.");
  failureStage = undefined;
  status = "passed";
} catch (error) {
  failure = (error as Error).message;
  throw error;
} finally {
  try {
    await stop();
  } catch (error) {
    status = "failed";
    failure = [failure, `Cleanup: ${(error as Error).message}`]
      .filter(Boolean)
      .join("\n");
    process.exitCode = 1;
  }
  if (releaseLock) {
    try {
      await releaseLock();
    } catch (error) {
      status = "failed";
      failureStage = "cleanup";
      failure = [failure, `Lock cleanup: ${(error as Error).message}`]
        .filter(Boolean)
        .join("\n");
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  }
  await writeFile(
    join(directory, "receipt.json"),
    JSON.stringify(
      {
        format: "axiom-reliability-acceptance",
        version: 1,
        status,
        buildId,
        checks,
        recovery,
        races,
        scale,
        failureStage,
        error: failure,
        finishedAt: new Date().toISOString(),
        browserArguments,
        stageAcceptance,
        browserResults: "browser-results",
        scope:
          "Disposable local authenticated fixtures; no physical IME/clipboard, real provider, S3 or production acceptance.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  process.removeListener("SIGINT", interrupted);
  process.removeListener("SIGTERM", interrupted);
  console.log(
    `Isolated ${status} receipt: ${directory}/receipt.json. Fixture data is retained, never promoted to production.`,
  );
}
