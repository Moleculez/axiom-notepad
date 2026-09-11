import { resolve } from "node:path";

/** Deliberately narrow: this command is not a general database administration tool. */
export function developmentResetTargets(
  root: string,
  databaseUrl: string,
  storagePath: string,
  driver = "local",
  production = false,
) {
  const url = new URL(databaseUrl),
    expectedStorage = resolve(root, "data/attachments");
  if (
    production ||
    driver !== "local" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.port !== "54329" ||
    decodeURIComponent(url.pathname) !== "/axiom"
  )
    throw new Error(
      "Reset only supports the main local development database axiom on port 54329 with local storage. Test/remote/production databases are refused.",
    );
  if (resolve(storagePath) !== expectedStorage)
    throw new Error(
      "Reset only supports this repository's exact data/attachments directory.",
    );
  return {
    database: "axiom",
    host: url.hostname,
    port: url.port,
    storage: expectedStorage,
  };
}
