import "dotenv/config";
import { spawn } from "node:child_process";
import { buildEnvironment } from "./environment";

const env = buildEnvironment(process.env);
for (const args of [
  ["--import", "tsx", "scripts/build/vendor-tools.ts"],
  ["node_modules/next/dist/bin/next", "build", "apps/web"],
  ["--import", "tsx", "scripts/build/build-offline.ts"],
]) {
  await new Promise<void>((done, fail) => {
    const child = spawn(process.execPath, args, { env, stdio: "inherit" });
    const stop = () => child.kill("SIGTERM");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const cleanup = () => {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    };
    child.on("error", (error) => {
      cleanup();
      fail(error);
    });
    child.on("exit", (code) => {
      cleanup();
      if (code === 0) done();
      else fail(new Error(`Build command failed (${code ?? "signal"}).`));
    });
  });
}
