import { query } from "@axiom/shared/db";
import { pendingDatabaseMigrations } from "@axiom/shared/schema-readiness";

/** Both web health URLs report readiness for this release, not just a live DB. */
export async function webHealthResponse() {
  const headers = { "Cache-Control": "no-store" };
  try {
    if ((await pendingDatabaseMigrations()).length)
      return Response.json(
        { status: "unavailable", reason: "database_upgrade_required" },
        { status: 503, headers },
      );
    await query("SELECT 1 FROM app_instance LIMIT 1");
    return Response.json({ status: "ok", service: "web" }, { headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
