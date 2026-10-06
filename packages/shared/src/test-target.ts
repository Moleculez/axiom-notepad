import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { realpath } from "node:fs/promises";

/** Test identities are explicit and contain no credentials or content. */
export const mutationTestProfiles = {
  release: {
    database: "axiom_release_test",
    storage: "data/release-test-attachments",
  },
  extensions: {
    database: "axiom_plugins_test",
    storage: "data/plugins-test-attachments",
  },
  reliability: {
    database: "axiom_plugins_test",
    storage: "data/reliability-test-attachments",
  },
} as const;
export type MutationTestProfile = keyof typeof mutationTestProfiles;
type Environment = Record<string, string | undefined>;
const refusal = () =>
  new Error(
    "Mutation tests require an isolated staging profile. Use npm run staging -- test or npm run plugins:staging -- test; never target working research data.",
  );
export function mutationTestTarget(env: Environment, root = process.cwd()) {
  const profile = env.AXIOM_TEST_PROFILE;
  if (!profile || !Object.hasOwn(mutationTestProfiles, profile))
    throw refusal();
  const spec = mutationTestProfiles[profile as MutationTestProfile];
  let database: URL, origin: URL;
  try {
    database = new URL(env.DATABASE_URL ?? "");
    origin = new URL(env.TEST_APP_URL ?? "");
  } catch {
    throw refusal();
  }
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    decodeURIComponent(database.pathname) !== "/" + spec.database ||
    database.search ||
    database.hash ||
    origin.href !== "http://localhost:3004/" ||
    env.APP_URL !== origin.origin ||
    env.STORAGE_DRIVER !== "local" ||
    !isAbsolute(env.STORAGE_PATH ?? "") ||
    resolve(env.STORAGE_PATH!) !== resolve(root, spec.storage) ||
    env.SYNC_PORT !== "1236"
  )
    throw refusal();
  const identity = {
    profile,
    origin: origin.origin,
    database: `${database.hostname}:${database.port || "5432"}/${spec.database}`,
    storage: resolve(root, spec.storage),
    syncPort: 1236,
  };
  return {
    ...identity,
    databaseName: spec.database,
    databaseUrl: database.href,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(identity))
      .digest("hex"),
  };
}

/** Redirects, missing/wrong attestations and failed readiness all fail closed. */
export async function verifyMutationTestServer(
  env: Environment,
  request: typeof fetch = fetch,
) {
  const target = mutationTestTarget(env, env.AXIOM_TEST_ROOT);
  const response = await request(target.origin + "/health", {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(
      "Isolated test server is not ready; no mutation tests were started.",
    );
  const body = await response.json();
  if (body.status !== "ok" || body.testTarget !== target.fingerprint)
    throw new Error(
      "Running server does not match the isolated database/storage profile; no mutation tests were started.",
    );
  return target;
}

export async function verifyMutationTestStorage(
  target: ReturnType<typeof mutationTestTarget>,
) {
  if ((await realpath(target.storage)) !== target.storage)
    throw new Error(
      "Isolated attachment storage must not redirect through symlinks.",
    );
}
