import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Exercise the standalone reader, not Next's route adapter. Requires completed
// site-insights browser fixtures and a publication service on ports 3005/3006.
const target = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(target.hostname));
assert(process.env.NODE_ENV !== "production");
const database = process.env.AXIOM_STAGING_DATABASE;
assert(database && /^axiom_[a-z0-9_]*test[a-z0-9_]*$/.test(database));
assert.notEqual(target.pathname, `/${database}`);
target.pathname = `/${database}`;
process.env.DATABASE_URL = target.href;
const { query, pool } = await import("../../packages/shared/src/db");
const { analyticsMaintenance } =
  await import("../../packages/shared/src/site-analytics");
const [site] = await query(
  "SELECT s.id,s.slug,s.live_release_id,r.public_catalog FROM workspace_sites s JOIN site_releases r ON r.id=s.live_release_id JOIN spaces p ON p.id=s.space_id WHERE s.slug LIKE 'insights-%' AND p.name LIKE 'Native editor %' AND s.enabled AND r.public_catalog IS NOT NULL ORDER BY s.created_at LIMIT 1",
);
assert(site, "Run the site-insights browser fixture first.");
const [old] = await query(
  "SELECT * FROM site_analytics_settings WHERE site_id=$1",
  [site.id],
);
const entry = site.public_catalog.entries[0],
  origin = "http://localhost:3005",
  root = `${origin}/sites/${site.slug}/`;
const visit = randomUUID(),
  expired = randomUUID(),
  expiredEntry = `rehearsal-${randomUUID()}`;
try {
  assert.equal((await fetch(origin + "/health")).status, 200);
  assert.equal((await fetch(origin + "/api/v1/me")).status, 404);
  assert.equal(
    (await fetch("http://localhost:3006/tls?domain=unverified.invalid")).status,
    403,
  );
  await query(
    "INSERT INTO site_analytics_settings(site_id,settings) VALUES($1,$2) ON CONFLICT(site_id) DO UPDATE SET settings=$2",
    [
      site.id,
      JSON.stringify({
        enabled: true,
        publicViews: true,
        publicDownloads: true,
        publicSiteTotals: true,
        googleMeasurementId: "",
      }),
    ],
  );
  const before = (
    await query(
      "SELECT coalesce(sum(views),0)::int AS views FROM site_analytics_daily WHERE site_id=$1",
      [site.id],
    )
  )[0].views;
  const payload = {
    releaseId: site.live_release_id,
    page: entry.path,
    visitId: visit,
    seconds: 0,
    depth: 90,
    downloads: 1,
  };
  const event = (data: unknown, headers: Record<string, string> = {}) =>
    fetch(root + "_site/analytics/events", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "user-agent": "Research acceptance browser",
        ...headers,
      },
      body: JSON.stringify(data),
    });
  for (const response of await Promise.all([
    event(payload),
    event(payload),
    event(payload),
  ]))
    assert.equal(response.status, 204);
  assert.equal(
    (
      await query(
        "SELECT coalesce(sum(views),0)::int AS views FROM site_analytics_daily WHERE site_id=$1",
        [site.id],
      )
    )[0].views,
    before + 1,
  );
  assert.equal(
    (
      await event(
        { ...payload, visitId: randomUUID() },
        { origin: "https://other.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await event({
        ...payload,
        visitId: randomUUID(),
        privateText: "not accepted",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await event({
        ...payload,
        visitId: randomUUID(),
        referrer: "a".repeat(5000),
      })
    ).status,
    413,
  );
  const html = await (await fetch(root + entry.path)).text();
  assert(html.includes("axiom-site-runtime"));
  const totals = await (
    await fetch(root + "_site/analytics/totals?entry=" + entry.id)
  ).json();
  assert(totals.views >= 1);
  assert(totals.downloads >= 1);
  await query(
    "INSERT INTO site_analytics_visits(site_id,visit_id,release_id,page,day,created_at) VALUES($1,$2,$3,'expired-test',current_date-8,now()-interval '8 days')",
    [site.id, expired, site.live_release_id],
  );
  await query(
    "INSERT INTO site_analytics_daily(site_id,day,entry_id,views) VALUES($1,(current_date-interval '14 months')::date,$2,1)",
    [site.id, expiredEntry],
  );
  await analyticsMaintenance();
  assert.equal(
    (
      await query(
        "SELECT 1 FROM site_analytics_visits WHERE site_id=$1 AND visit_id=$2",
        [site.id, expired],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await query(
        "SELECT 1 FROM site_analytics_daily WHERE site_id=$1 AND entry_id=$2",
        [site.id, expiredEntry],
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await query(
        "SELECT 1 FROM site_analytics_visits WHERE site_id=$1 AND visit_id=$2",
        [site.id, visit],
      )
    ).length,
    1,
  );
  await query(
    "UPDATE site_analytics_settings SET settings='{}' WHERE site_id=$1",
    [site.id],
  );
  assert.equal(
    (await event({ ...payload, visitId: randomUUID() })).status,
    204,
  );
  assert.equal(
    (
      await query(
        "SELECT coalesce(sum(views),0)::int AS views FROM site_analytics_daily WHERE site_id=$1",
        [site.id],
      )
    )[0].views,
    before + 1,
  );
  console.log(
    "PASS standalone publication reader: readiness, private-route denial, domain denial, bounded/origin-checked collection, concurrent deduplication, public counters, immediate disable, seven-day and thirteen-month retention.",
  );
} finally {
  if (old)
    await query(
      "UPDATE site_analytics_settings SET settings=$2,version=$3,started_at=$4,updated_at=$5 WHERE site_id=$1",
      [
        site.id,
        JSON.stringify(old.settings),
        old.version,
        old.started_at,
        old.updated_at,
      ],
    );
  else
    await query("DELETE FROM site_analytics_settings WHERE site_id=$1", [
      site.id,
    ]);
  await pool.end();
}
