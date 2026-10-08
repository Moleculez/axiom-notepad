import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const heartbeatFile = () => join(tmpdir(), "axiom-workspace-worker.heartbeat");
export async function workerHealthy(file = heartbeatFile(), now = Date.now()) {
  try {
    const value = Number(await readFile(file, "utf8"));
    return (
      Number.isFinite(value) &&
      value > 0 &&
      now >= value &&
      now - value < 90_000
    );
  } catch {
    return false;
  }
}

/** Ephemeral liveness only: no credentials, paths, queue contents or DB writes. */
export async function startWorkerHeartbeat(file = heartbeatFile()) {
  let pending = Promise.resolve();
  const beat = () => {
    pending = pending
      .then(() => writeFile(file, String(Date.now()), { mode: 0o600 }))
      .catch(() => {
        console.error("Workspace worker heartbeat could not be written.");
      });
    return pending;
  };
  await beat();
  const timer = setInterval(() => {
    void beat();
  }, 20_000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
    await unlink(file).catch(() => {});
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = (await workerHealthy()) ? 0 : 1;
