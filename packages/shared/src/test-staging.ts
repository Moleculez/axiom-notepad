import { resolve } from "node:path";
import { mutationTestProfiles, mutationTestTarget } from "./test-target";

export type StagingProfile = {
  database: string;
  storage: string;
  dist: string;
  devDist: string;
  webPort: number;
  syncPort: number;
};
export const reliabilityStagingProfile: StagingProfile = {
  database: "axiom_plugins_test",
  storage: "data/reliability-test-attachments",
  dist: ".next/reliability-test",
  devDist: ".next/reliability-test-dev",
  webPort: 3004,
  syncPort: 1236,
};

/** Pure preflight: validate all targets before creating directories/databases. */
export function stagingEnvironment(
  profile: StagingProfile,
  inherited: NodeJS.ProcessEnv,
  root = process.cwd(),
) {
  if (inherited.NODE_ENV === "production")
    throw new Error(
      "Staging helpers must not run in a production environment.",
    );
  const registered = Object.entries(mutationTestProfiles).find(
    ([, spec]) =>
      spec.database === profile.database &&
      resolve(root, spec.storage) === resolve(root, profile.storage),
  );
  if (!registered || profile.webPort !== 3004 || profile.syncPort !== 1236)
    throw new Error(
      "Staging requires a registered isolated database, storage and port profile.",
    );
  const [testProfile] = registered;
  const build = `.next/${testProfile === "extensions" ? "plugins" : testProfile}-test`;
  if (profile.dist !== build || profile.devDist !== build + "-dev")
    throw new Error(
      "Staging build directories must not overlap the working application.",
    );
  let control: URL;
  try {
    control = new URL(inherited.DATABASE_URL ?? "");
  } catch {
    throw new Error(
      "Staging requires an explicit local PostgreSQL control database.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(control.protocol) ||
    !["localhost", "127.0.0.1"].includes(control.hostname) ||
    control.search ||
    control.hash
  )
    throw new Error(
      "Staging requires a local PostgreSQL server without connection overrides.",
    );
  if (decodeURIComponent(control.pathname) === "/" + profile.database)
    throw new Error(
      "Staging must not reuse the configured application database.",
    );
  if (
    resolve(root, profile.storage) ===
    resolve(root, inherited.STORAGE_PATH ?? "data/attachments")
  )
    throw new Error(
      "Staging must not reuse the configured attachment directory.",
    );
  control.pathname = "/" + profile.database;
  const extensions = testProfile === "extensions";
  const extensionAccount = extensions || testProfile === "reliability";
  const env = {
    ...inherited,
    AXIOM_TEST_PROFILE: testProfile,
    AXIOM_TEST_ROOT: root,
    TEST_APP_URL: "http://localhost:3004",
    DATABASE_URL: control.href,
    APP_URL: "http://localhost:3004",
    BETTER_AUTH_URL: "http://localhost:3004",
    PORT: "3004",
    SYNC_PORT: "1236",
    SYNC_HOST: "127.0.0.1",
    SYNC_INTERNAL_URL: "http://127.0.0.1:1236",
    NEXT_PUBLIC_SYNC_URL: "ws://localhost:1236",
    STORAGE_DRIVER: "local",
    STORAGE_PATH: resolve(root, profile.storage),
    AXIOM_DIST_DIR: profile.dist,
    AXIOM_DEV_DIST_DIR: profile.devDist,
    NEXT_PUBLIC_AXIOM_EDITOR_ENGINE: "milkdown",
    BETTER_AUTH_SECRET: `axiom-isolated-auth-not-production-${profile.database}`,
    SYNC_SECRET: `axiom-isolated-sync-not-production-${profile.database}`,
    SMTP_URL: "",
    OIDC_DISCOVERY_URL: "",
    OIDC_CLIENT_ID: "",
    OIDC_CLIENT_SECRET: "",
    TOOL_PROVIDER_KEY: extensionAccount
      ? Buffer.alloc(32, 0x31).toString("base64")
      : "",
    TOOL_PROVIDER_ALLOWED_ORIGINS: extensionAccount
      ? "http://127.0.0.1:8096"
      : "",
    TEST_OWNER_EMAIL: extensionAccount
      ? "extensions@axiom.local"
      : "researcher@axiom.local",
    TEST_OWNER_PASSWORD: extensionAccount
      ? "ExtensionsTest2026!"
      : "AxiomResearch2026!",
  };
  mutationTestTarget(env, root);
  return env;
}
