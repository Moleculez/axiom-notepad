import { query } from "./db";
import { forwardMigrations } from "./migrations";

const requiredVersions = forwardMigrations.map(({ version }) => version);

function postgresCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
}

/** Read-only: never migrate a running installation implicitly. Check every
 * receipt, not just MAX(version), which can hide a skipped migration. */
export async function pendingDatabaseMigrations(): Promise<number[]> {
  let applied: { version: number }[];
  try {
    applied = await query<{ version: number }>(
      "SELECT version FROM public.schema_migrations",
    );
  } catch (error) {
    if (postgresCode(error) === "42P01") return [...requiredVersions];
    throw error;
  }
  const versions = new Set(applied.map(({ version }) => version));
  return requiredVersions.filter((version) => !versions.has(version));
}

/** Diagnose only schema-shaped failures. A typo against a current database must
 * remain an application error, and normal API requests incur no extra query. */
export async function isDatabaseUpgradeRequired(error: unknown) {
  if (!["42P01", "42703"].includes(String(postgresCode(error)))) return false;
  try {
    return (await pendingDatabaseMigrations()).length > 0;
  } catch {
    // Preserve the original failure if diagnostics cannot reach the database.
    return false;
  }
}
