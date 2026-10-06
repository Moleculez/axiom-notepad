import { spawn, type SpawnOptions } from "node:child_process";
import { readFile, writeFile, stat, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";

const ownedGroups = new WeakSet<ChildProcess>();
/** POSIX groups include staging wrappers' descendants, never an existing service. */
export function spawnAcceptanceChild(
  command: string,
  args: string[],
  options: SpawnOptions,
  ownGroup = true,
) {
  const grouped = ownGroup && process.platform !== "win32";
  const child = spawn(command, args, { ...options, detached: grouped });
  if (grouped) ownedGroups.add(child);
  return child;
}
/** Only handles/groups created here are signalled; no PID lookup by port or name. */
export async function stopAcceptanceChild(child: ChildProcess, grace = 6000) {
  if (!child.pid) return;
  const grouped = ownedGroups.has(child),
    pid = child.pid;
  const alive = () => {
    if (!grouped) return child.exitCode === null && child.signalCode === null;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  const signal = (value: NodeJS.Signals) => {
    try {
      if (grouped) process.kill(-pid, value);
      else child.kill(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  if (!alive()) return;
  signal("SIGTERM");
  const until = Date.now() + grace;
  while (alive() && Date.now() < until)
    await new Promise((done) => setTimeout(done, 50));
  if (alive()) signal("SIGKILL");
  const forcedUntil = Date.now() + 2000;
  while (alive() && Date.now() < forcedUntil)
    await new Promise((done) => setTimeout(done, 50));
  if (alive())
    throw new Error(
      `Owned acceptance process group ${pid} did not stop; no unrelated process was signalled.`,
    );
}
export class AcceptanceCommandError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message);
  }
}
export async function acceptanceCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    quiet?: boolean;
  },
) {
  options.signal?.throwIfAborted();
  return new Promise<string>((done, fail) => {
    const child = spawnAcceptanceChild(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
        // Without a cancellation owner, inherit the runner's group. Nested commands
        // must not detach into orphan groups when their parent is interrupted.
      },
      options.signal !== undefined,
    );
    let output = "";
    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-1_000_000);
      if (!options.quiet) process.stdout.write(chunk);
    };
    child.stdout!.on("data", capture);
    child.stderr!.on("data", capture);
    let stopError: unknown;
    const abort = () => {
      // Give coordinators time to drain separately owned children/database.
      void stopAcceptanceChild(child, 30000).catch((error) => {
        stopError = error;
      });
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => options.signal?.removeEventListener("abort", abort);
    child.once("error", (e) => {
      cleanup();
      fail(e);
    });
    child.once("close", (code) => {
      cleanup();
      if (stopError) fail(stopError);
      else if (options.signal?.aborted)
        fail(
          new AcceptanceCommandError(
            "Acceptance interrupted; incomplete phases are not passed.",
            output,
          ),
        );
      else if (code !== 0)
        fail(
          new AcceptanceCommandError(
            `Acceptance child exited ${code ?? "by signal"}: ${output.slice(-2500)}`,
            output,
          ),
        );
      else done(output);
    });
  });
}
/** Preserve the user's exact generated selection, including an existing dirty file. */
export async function preserveGeneratedTypes<T>(
  root: string,
  work: () => Promise<T>,
) {
  const path = resolve(root, "apps/web/next-env.d.ts");
  const before = await readFile(path),
    metadata = await stat(path);
  try {
    return await work();
  } finally {
    let after: Buffer | undefined;
    try {
      after = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!after || !before.equals(after))
      await writeFile(path, before, { mode: metadata.mode });
  }
}
/** An abandoned lock is deliberately not auto-deleted or stolen. */
export async function acceptanceLock(path: string) {
  const token = randomUUID();
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(
      JSON.stringify({
        token,
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }),
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  return async () => {
    const owner = JSON.parse(await readFile(path, "utf8"));
    if (owner.token !== token)
      throw new Error("Acceptance lock ownership changed; it was not removed.");
    await unlink(path);
  };
}
