import { query } from "@axiom/shared/db";
import { pendingDatabaseMigrations } from "@axiom/shared/schema-readiness";
import {
  mutationTestTarget,
  verifyMutationTestStorage,
} from "@axiom/shared/test-target";

/** Both web health URLs report readiness for this release, not just a live DB. */
export async function webHealthResponse() {
  const headers = { "Cache-Control": "no-store" };
  try {
    if ((await pendingDatabaseMigrations()).length)
      return Response.json(
        { status: "unavailable", reason: "database_upgrade_required" },
        { status: 503, headers },
      );
    // Ordinary deployments reveal no test identity, paths or database details.
    let testTarget: string | undefined;
    if (process.env.AXIOM_TEST_PROFILE) {
      const target = mutationTestTarget(
        process.env,
        process.env.AXIOM_TEST_ROOT,
      );
      await verifyMutationTestStorage(target);
      const [database] = await query<{ name: string }>(
        "SELECT current_database() AS name",
      );
      if (database.name !== target.databaseName)
        throw new Error("Invalid test database");
      testTarget = target.fingerprint;
    }
    await query("SELECT 1 FROM app_instance LIMIT 1");
    return Response.json(
      { status: "ok", service: "web", ...(testTarget ? { testTarget } : {}) },
      { headers },
    );
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
