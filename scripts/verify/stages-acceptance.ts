import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import {
  acceptanceEnvironment,
  parseAcceptanceArguments,
  emptyAcceptancePhases,
  acceptanceSoftwareState,
  isAcceptanceEnvironmentError,
  type StageAcceptanceReceipt,
  type AcceptancePhase,
} from "./stage-acceptance-contract";
import { acceptanceSource, preflightAcceptance } from "./acceptance-preflight";
import {
  acceptanceCommand,
  acceptanceLock,
  preserveGeneratedTypes,
  AcceptanceCommandError,
} from "./acceptance-process";
import {
  ownedRuntimeReceipt,
  ownedRuntimeArtifact,
} from "./acceptance-artifacts";

const args = parseAcceptanceArguments(process.argv.slice(2));
if (args.help) {
  console.log(`Stage 3–4 software acceptance (no .env, working data, live providers or deployment).
Usage: npm run verify:stages:acceptance [-- --preflight-only] [--project=chromium|firefox|webkit]
Default: prerequisites, static checks, both migration gates, the full desktop matrix,
real worker races, populated paired recovery, and the 20% scale budget against 7cd2cc5.
Focused browser runs remain scoped, not full acceptance. Private receipts and operator
review checklists are retained under data/stage-acceptance-*. No automatic cleanup.`);
} else {
  const root = process.cwd(),
    env = acceptanceEnvironment(process.env);
  await mkdir(resolve("data"), { recursive: true });
  const directory = await mkdtemp(resolve("data/stage-acceptance-"));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const receipt: StageAcceptanceReceipt = {
    format: "axiom-stage-acceptance",
    version: 1,
    startedAt: new Date().toISOString(),
    source: { commit: "unknown", fingerprint: "unknown", dirty: true },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    browsers: args.browsers,
    phases: emptyAcceptancePhases(),
    software: "pending",
    acceptance: "pending-operator-review",
    baseline: "7cd2cc5",
    scope:
      "Isolated synthetic software acceptance. No working-data migration, live provider, physical IME/clipboard, commit, push or deployment.",
  };
  const save = () =>
    writeFile(
      join(directory, "receipt.json"),
      JSON.stringify(receipt, null, 2),
      { mode: 0o600 },
    );
  let release: (() => Promise<void>) | undefined;
  async function phase(
    name: AcceptancePhase,
    work: () => Promise<string | void>,
  ) {
    const p = receipt.phases[name];
    p.state = "running";
    p.startedAt = new Date().toISOString();
    await save();
    try {
      const artifact = await work();
      controller.signal.throwIfAborted();
      p.state = "passed";
      if (artifact) p.artifact = artifact;
    } catch (error) {
      p.state = isAcceptanceEnvironmentError(error) ? "blocked" : "failed";
      p.error = (error as Error).message;
      throw error;
    } finally {
      p.finishedAt = new Date().toISOString();
      receipt.software = acceptanceSoftwareState(receipt.phases, args.browsers);
      await save();
    }
  }
  const run = (path: string, extra: string[] = []) =>
    acceptanceCommand(process.execPath, ["--import", "tsx", path, ...extra], {
      cwd: root,
      env,
      signal: controller.signal,
    });
  try {
    await phase("preflight", async () => {
      release = await acceptanceLock(resolve("data/stage-acceptance.lock"));
      receipt.source = await acceptanceSource(root, env);
      const result = await preflightAcceptance(
        root,
        env,
        args.browsers,
        controller.signal,
      );
      receipt.environment.postgresClients = result.versions;
      if (result.PG_BIN) env.PG_BIN = result.PG_BIN;
      const empty = join(directory, "empty.env");
      await writeFile(empty, "", { mode: 0o600 });
      env.DOTENV_CONFIG_PATH = empty;
    });
    if (!args.preflightOnly) {
      await phase("static", async () => {
        for (const cli of [
          ["node_modules/typescript/bin/tsc", "--noEmit"],
          ["node_modules/eslint/bin/eslint.js", "."],
          ["node_modules/vitest/vitest.mjs", "run"],
        ])
          await acceptanceCommand(process.execPath, cli, {
            cwd: root,
            env,
            signal: controller.signal,
          });
        for (const path of [
          "scripts/verify/validate-ui.ts",
          "scripts/verify/validate-themes.ts",
          "scripts/verify/check-docs.ts",
        ])
          await run(path);
      });
      await phase("planning-sql", async () => {
        await run("scripts/verify/planning-lab-migration.ts");
      });
      await phase("assistant-sql", async () => {
        await run("scripts/verify/assistant-grounding-migration.ts");
      });
      await phase("runtime", async () => {
        let output: string, failure: unknown;
        try {
          output = await preserveGeneratedTypes(root, () =>
            run("scripts/verify/reliability.ts", [
              "--stage-acceptance",
              ...args.browsers.map((b) => `--project=${b}`),
            ]),
          );
        } catch (error) {
          if (!(error instanceof AcceptanceCommandError)) throw error;
          output = error.output;
          failure = error;
        }
        let path: string;
        try {
          path = await ownedRuntimeReceipt(root, output);
        } catch (error) {
          throw failure ?? error;
        }
        receipt.phases.runtime.artifact = relative(directory, path);
        const runtime = JSON.parse(await readFile(path, "utf8"));
        if (runtime.failureStage === "scale") {
          const artifact = await ownedRuntimeArtifact(path, "scale.json");
          const scale = JSON.parse(await readFile(artifact, "utf8"));
          receipt.phases.scale = {
            state: isAcceptanceEnvironmentError(
              new Error(scale.error ?? "Scale comparison failed."),
            )
              ? "blocked"
              : "failed",
            artifact: relative(directory, artifact),
            error: scale.error ?? "Scale comparison failed.",
            finishedAt: new Date().toISOString(),
          };
        }
        if (failure) throw failure;
        if (
          runtime.status !== "passed" ||
          runtime.stageAcceptance !== true ||
          !args.browsers.every((b) =>
            runtime.browserArguments?.includes(`--project=${b}`),
          ) ||
          !runtime.races?.passed ||
          !runtime.recovery?.populated
        )
          throw new Error(
            "Runtime lacks real race and populated recovery evidence.",
          );
        return relative(directory, path);
      });
      await phase("scale", async () => {
        // Reuse only the runtime's owned disposable cluster while it is alive:
        // reliability runs scale before draining it and records the immutable report.
        const runtimePath = resolve(
          directory,
          receipt.phases.runtime.artifact!,
        );
        const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
        if (!runtime.scale?.passed || !runtime.scale.artifact)
          throw new Error(
            "No complete passing scale comparison was recorded by the isolated runtime.",
          );
        return relative(
          directory,
          await ownedRuntimeArtifact(runtimePath, runtime.scale.artifact),
        );
      });
      const current = await acceptanceSource(root, env);
      controller.signal.throwIfAborted();
      if (current.fingerprint !== receipt.source.fingerprint)
        throw new Error(
          "Source changed during acceptance; this receipt cannot certify the current tree.",
        );
    }
  } catch (error) {
    if (
      !Object.values(receipt.phases).some(
        (p) => p.state === "failed" || p.state === "blocked",
      )
    )
      receipt.phases.runtime = {
        state: "failed",
        error: (error as Error).message,
        finishedAt: new Date().toISOString(),
      };
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    if (release) {
      try {
        await release();
      } catch (error) {
        receipt.phases.preflight = {
          state: "failed",
          error: `Lock cleanup: ${(error as Error).message}`,
          finishedAt: new Date().toISOString(),
        };
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    }
    receipt.finishedAt = new Date().toISOString();
    receipt.software = acceptanceSoftwareState(receipt.phases, args.browsers);
    await save();
    await writeFile(
      join(directory, "OPERATOR_REVIEW.md"),
      `# Stage 3–4 operator review\n\nReceipt: receipt.json\nSource fingerprint: ${receipt.source.fingerprint}\n\nSoftware result: ${receipt.software}. This file is a checklist, not a signed pass.\n\n- [ ] All required phases and all three browsers passed for this exact source/build.\n- [ ] Open and inspect the actual planning and assistant screenshots: five styles, both modes, 22px text, wrapping, scroll ownership and visible footer actions.\n- [ ] Exercise keyboard focus, consent with Space, Escape dismissal and focus return.\n- [ ] Inspect forced-colors and reduced-motion behavior, not only default-theme images.\n- [ ] Check the same forms with a screen reader; record platform, reader and observed result.\n- [ ] Inspect race, populated recovery and scale reports; there are no hidden skipped checks.\n\nRecord reviewer, date, build/source identity, image filenames and any failures in a separate review note. Keep stage acceptance pending until this review is completed. Live-provider billing/retention/quality, physical IME/clipboard and deployment remain separate gates.\n`,
      { mode: 0o600 },
    );
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    console.log(
      `Stage acceptance ${receipt.software}: ${directory}/receipt.json. Operator review remains pending.`,
    );
  }
}
