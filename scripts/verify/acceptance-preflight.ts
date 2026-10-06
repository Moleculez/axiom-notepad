import { createServer } from "node:net";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { acceptanceCommand } from "./acceptance-process";
import { codeFingerprint } from "./stage-acceptance-contract";

export async function reserveAcceptancePort(port: number) {
  await new Promise<void>((done, fail) => {
    const server = createServer();
    server.once("error", (e: NodeJS.ErrnoException) =>
      fail(
        Object.assign(
          new Error(
            `Cannot reserve isolated port ${port} (${e.code ?? "unknown"}); existing services are never stopped.`,
          ),
          { code: e.code },
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () =>
      server.close((e) => (e ? fail(e) : done())),
    );
  });
}
export async function acceptanceSource(root: string, env: NodeJS.ProcessEnv) {
  const run = (args: string[]) =>
    acceptanceCommand("git", args, { cwd: root, env, quiet: true });
  const commit = (await run(["rev-parse", "HEAD"])).trim();
  const names = (
    await run([
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "apps",
      "packages",
      "scripts",
      "tests",
      "examples",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "*.ts",
      "*.mjs",
      ".github/workflows/reliability.yml",
    ])
  )
    .split("\0")
    .filter(
      (p) =>
        p &&
        /\.(?:tsx?|[cm]?js|json|css|html|ya?ml)$/.test(p) &&
        !p.endsWith("next-env.d.ts"),
    );
  const files = await Promise.all(
    [...new Set(names)].map(async (path) => {
      try {
        return { path, bytes: await readFile(resolve(root, path)) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    }),
  );
  return {
    commit,
    fingerprint: codeFingerprint(files.filter((file) => file !== null)),
    dirty: Boolean((await run(["status", "--porcelain"])).trim()),
  };
}
export async function preflightAcceptance(
  root: string,
  env: NodeJS.ProcessEnv,
  browsers: string[],
  signal?: AbortSignal,
) {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error(
      "Node 24 is required for this acceptance gate; no fixtures were started.",
    );
  const { chromium, firefox, webkit } = await import("@playwright/test");
  const engines = { chromium, firefox, webkit };
  for (const name of browsers) {
    const engine = engines[name as keyof typeof engines];
    if (!engine) throw new Error("Unknown acceptance browser.");
    try {
      await access(engine.executablePath());
    } catch {
      throw new Error(
        `Missing browser ${name}; run npx playwright install chromium firefox webkit.`,
      );
    }
  }
  const host = `${process.platform}-${process.arch}`;
  if (
    !["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].includes(host)
  )
    throw new Error("Local PostgreSQL is not installed for this host.");
  const binaries = (await import(`@embedded-postgres/${host}`)) as {
    postgres: string;
  };
  const version = await acceptanceCommand(binaries.postgres, ["--version"], {
    cwd: root,
    env,
    signal,
    quiet: true,
  });
  const major = Number(/PostgreSQL\) (\d+)/.exec(version)?.[1]);
  if (!major)
    throw new Error(
      "Missing PostgreSQL server version; no fixtures were started.",
    );
  let bin = env.PG_BIN;
  if (!bin && process.platform === "darwin") {
    for (const candidate of [
      "/opt/homebrew/opt/libpq/bin",
      "/usr/local/opt/libpq/bin",
    ]) {
      try {
        await access(join(candidate, "pg_dump"));
        bin = candidate;
        break;
      } catch {
        /* Try PATH last. */
      }
    }
  }
  const versions: string[] = [];
  for (const name of ["pg_dump", "pg_restore"]) {
    let result: string;
    try {
      result = await acceptanceCommand(
        bin ? join(bin, name) : name,
        ["--version"],
        { cwd: root, env, signal, quiet: true },
      );
    } catch {
      throw new Error(
        "Missing PostgreSQL client tools; install pg_dump/pg_restore matching the bundled server or set PG_BIN.",
      );
    }
    const clientMajor = Number(/PostgreSQL\) (\d+)/.exec(result)?.[1]);
    if (!Number.isInteger(clientMajor) || clientMajor < 1)
      throw new Error(
        "Missing PostgreSQL client version; no fixtures were started.",
      );
    if (clientMajor < major)
      throw new Error(
        "PostgreSQL client tools are older than the test server.",
      );
    versions.push(result.trim());
  }
  await acceptanceCommand(
    "git",
    ["rev-parse", "--verify", "7cd2cc5^{commit}"],
    { cwd: root, env, signal, quiet: true },
  );
  for (const port of [3004, 1236, 1235, 8096, 54339])
    await reserveAcceptancePort(port);
  return { versions, ...(bin ? { PG_BIN: bin } : {}) };
}
