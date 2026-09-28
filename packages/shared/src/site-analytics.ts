import { z } from "zod";
import { query, transaction } from "./db";
import { HttpError } from "./access";
import {
  workspaceMutation,
  requireScope,
  workspaceJson as json,
} from "./workspace-service";
import { recordSiteActivity } from "./site-activity";
import { notifyWorkspace } from "./documents";
import { buildSiteCatalog, catalogDate } from "./site-discovery";
import {
  siteAnalyticsSettingsSchema,
  siteEventSchema,
  siteEventDelta,
  normalizedReferrer,
  emptySiteMetrics,
  type SiteCatalog,
  type SiteMetrics,
  type SiteAnalyticsReport,
} from "./site-insights";
import type { SiteSnapshot } from "./sites";

export async function publicationCatalog(
  releaseId: string,
): Promise<SiteCatalog | null> {
  const [release] = await query(
    "SELECT site_id,public_catalog FROM site_releases WHERE id=$1",
    [releaseId],
  );
  if (!release) return null;
  const dates = await query(
    "SELECT entry_id,to_char(first_published_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day FROM site_entry_publications WHERE site_id=$1",
    [release.site_id],
  );
  const map = new Map(dates.map((d) => [d.entry_id, d.day]));
  let catalog: SiteCatalog = release.public_catalog;
  if (!catalog) {
    const [legacy] = await query(
      "SELECT snapshot FROM site_releases WHERE id=$1",
      [releaseId],
    );
    catalog = buildSiteCatalog(legacy.snapshot as SiteSnapshot);
  }
  return {
    ...catalog,
    entries: catalog.entries.map((e) => ({
      ...e,
      firstPublished: map.get(e.id) ?? e.firstPublished,
    })),
  };
}
export async function analyticsSettings(siteId: string) {
  const [row] = await query(
    "SELECT * FROM site_analytics_settings WHERE site_id=$1",
    [siteId],
  );
  return {
    settings: siteAnalyticsSettingsSchema.parse(row?.settings ?? {}),
    version: row?.version ?? 0,
    startedAt: row?.started_at ?? null,
  };
}
export function collectionAllowed() {
  const hostname = new URL(process.env.APP_URL || "http://localhost:8080")
    .hostname;
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname))
    return process.env.SITE_ANALYTICS_LOCAL_TEST === "1";
  return process.env.NODE_ENV === "production";
}
const metricKeys = Object.keys(emptySiteMetrics()) as (keyof SiteMetrics)[];
const add = (to: SiteMetrics, from: Record<string, unknown>) => {
  for (const key of metricKeys) to[key] += Number(from[key] ?? 0);
};
const day = (date: Date) => date.toISOString().slice(0, 10);
export function analyticsRange(params: URLSearchParams, now = new Date()) {
  const to = z.iso.date().parse(params.get("to") || day(now));
  const from = z.iso
    .date()
    .parse(params.get("from") || day(new Date(Date.parse(to) - 29 * 86400000)));
  const span = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (span < 1 || span > 397 || to > day(now))
    throw new HttpError(
      400,
      "Choose a past or current date range of up to thirteen months.",
    );
  return {
    from,
    to,
    previousFrom: day(new Date(Date.parse(from) - span * 86400000)),
  };
}
export async function analyticsReport(
  site: { id: string; live_release_id: string | null; enabled: boolean },
  params: URLSearchParams,
): Promise<SiteAnalyticsReport> {
  const settings = await analyticsSettings(site.id),
    range = analyticsRange(params);
  const catalog = site.live_release_id
    ? await publicationCatalog(site.live_release_id)
    : null;
  const [support] = site.live_release_id
    ? await query(
        "SELECT public_catalog IS NOT NULL AS supported FROM site_releases WHERE id=$1",
        [site.live_release_id],
      )
    : [];
  const authors = catalog?.authors ?? [];
  const entries = (catalog?.entries ?? []).filter(
    (e) =>
      (!params.get("entry") || e.id === params.get("entry")) &&
      (!params.get("author") || e.authorIds.includes(params.get("author")!)) &&
      (!params.get("tag") || e.tags.includes(params.get("tag")!)) &&
      (!params.get("kind") || e.kind === params.get("kind")),
  );
  const filtered = ["entry", "author", "tag", "kind"].some(
    (k) => !!params.get(k),
  );
  const ids = [...entries.map((e) => e.id), ...(filtered ? [] : [""])];
  const rows = await query(
    "SELECT * FROM site_analytics_daily WHERE site_id=$1 AND day BETWEEN $2::date AND $3::date AND entry_id=ANY($4::text[]) ORDER BY day",
    [site.id, range.previousFrom, range.to, ids],
  );
  const current = emptySiteMetrics(),
    previous = emptySiteMetrics(),
    byEntry = new Map(entries.map((e) => [e.id, emptySiteMetrics()]));
  const days = new Map<string, SiteMetrics>(),
    referrers = new Map<string, number>();
  for (
    let time = Date.parse(range.from);
    time <= Date.parse(range.to);
    time += 86400000
  )
    days.set(day(new Date(time)), emptySiteMetrics());
  for (const row of rows) {
    if (row.day < range.from) {
      add(previous, row);
      continue;
    }
    add(current, row);
    add(days.get(row.day)!, row);
    const value = byEntry.get(row.entry_id);
    if (value) add(value, row);
    referrers.set(
      row.referrer || "Direct / unknown",
      (referrers.get(row.referrer || "Direct / unknown") ?? 0) +
        Number(row.views),
    );
  }
  const topics = new Map<string, number>(),
    cadence = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of new Set(entry.tags))
      topics.set(tag, (topics.get(tag) ?? 0) + 1);
    const month = catalogDate(entry).slice(0, 7);
    if (month) cadence.set(month, (cadence.get(month) ?? 0) + 1);
  }
  return {
    settings: settings.settings,
    settingsVersion: settings.version,
    startedAt: settings.startedAt,
    ...range,
    supported: !!support?.supported,
    live: site.enabled,
    current,
    previous,
    days: [...days].map(([day, values]) => ({ day, ...values })),
    entries: entries
      .map((e) => ({ ...e, ...byEntry.get(e.id)! }))
      .sort((a, b) => b.views - a.views || a.title.localeCompare(b.title)),
    authors: authors.map((a) => {
      const authored = entries.filter((e) => e.authorIds.includes(a.id)),
        metrics = emptySiteMetrics();
      for (const e of authored) add(metrics, byEntry.get(e.id)!);
      return {
        ...a,
        entries: authored.length,
        words: authored.reduce((n, e) => n + (e.reading?.words ?? 0), 0),
        ...metrics,
      };
    }),
    referrers: [...referrers]
      .map(([domain, views]) => ({ domain, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 100),
    publishing: {
      entries: entries.length,
      words: entries.reduce((n, e) => n + (e.reading?.words ?? 0), 0),
      equations: entries.reduce((n, e) => n + (e.reading?.equations ?? 0), 0),
      tables: entries.reduce((n, e) => n + (e.reading?.tables ?? 0), 0),
      codeBlocks: entries.reduce((n, e) => n + (e.reading?.codeBlocks ?? 0), 0),
      topics: [...topics].map(([tag, entries]) => ({ tag, entries })),
      cadence: [...cadence]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, entries]) => ({ month, entries })),
    },
  };
}
export function analyticsCsv(report: SiteAnalyticsReport) {
  const cell = (value: unknown) =>
    `"${String(value ?? "")
      .replace(/^(?:\s*[=+@-]|[\t\r\n])/, "'$&")
      .replaceAll('"', '""')}"`;
  return [
    [
      "Article",
      "Type",
      "Words",
      "Views",
      "Engaged views",
      "Active seconds",
      "Scroll completions",
      "Download clicks",
      "Citation copies",
      "Outbound clicks",
    ],
    ...report.entries.map((e) => [
      e.title,
      e.kind,
      e.reading?.words ?? "",
      e.views,
      e.engaged,
      e.seconds,
      e.completed,
      e.downloads,
      e.citations,
      e.outbound,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
export async function siteAnalyticsApi(
  request: Request,
  spaceId: string,
  userId: string,
  action?: string,
) {
  const [site] = await query<{
    id: string;
    live_release_id: string | null;
    enabled: boolean;
  }>(
    "SELECT id,live_release_id,enabled FROM workspace_sites WHERE space_id=$1",
    [spaceId],
  );
  if (!site) throw new HttpError(404, "Create a website first.");
  // Workspace membership alone does not disclose private editorial analytics.
  await transaction(async (client) => {
    const scope = await requireScope(client, userId, spaceId, "read");
    if (!scope.manage && scope.role !== "editor")
      throw new HttpError(
        403,
        "Website analytics are available to editors and managers.",
      );
  });
  if (request.method === "GET") {
    if (action === "settings") return json(await analyticsSettings(site.id));
    const params = new URL(request.url).searchParams,
      report = await analyticsReport(site, params);
    if (params.get("format") === "csv")
      return new Response(analyticsCsv(report), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="website-analytics.csv"',
          "cache-control": "private, no-store",
        },
      });
    return json(report);
  }
  if (request.method !== "PATCH" || action !== "settings")
    throw new HttpError(405, "Unsupported analytics operation.");
  const input = z
    .object({
      mutationId: z.uuid(),
      version: z.number().int().nonnegative(),
      settings: siteAnalyticsSettingsSchema,
    })
    .parse(await request.json());
  const result = await workspaceMutation(
    userId,
    input.mutationId,
    "website-analytics-settings",
    { ...input, spaceId },
    async (client) => {
      await requireScope(client, userId, spaceId, "manage");
      await client.query(
        "SELECT id FROM workspace_sites WHERE id=$1 FOR UPDATE",
        [site.id],
      );
      const {
        rows: [old],
      } = await client.query(
        "SELECT version FROM site_analytics_settings WHERE site_id=$1 FOR UPDATE",
        [site.id],
      );
      if ((old?.version ?? 0) !== input.version)
        throw new HttpError(
          409,
          "Analytics settings changed. Reload before saving.",
        );
      await client.query(
        "INSERT INTO site_analytics_settings(site_id,settings,started_at) VALUES($1,$2,CASE WHEN $3 THEN now() END) ON CONFLICT(site_id) DO UPDATE SET settings=$2,version=site_analytics_settings.version+1,started_at=CASE WHEN $3 THEN coalesce(site_analytics_settings.started_at,now()) ELSE site_analytics_settings.started_at END,updated_at=now()",
        [site.id, JSON.stringify(input.settings), input.settings.enabled],
      );
      await recordSiteActivity(client, {
        spaceId,
        userId,
        kind: "site",
        title: "Updated website analytics and privacy settings",
      });
      return { saved: true };
    },
  );
  await notifyWorkspace();
  return json(result);
}

const limits = new Map<string, { minute: number; count: number }>();
function allowRequest(siteId: string) {
  const minute = Math.floor(Date.now() / 60000),
    entry = limits.get(siteId);
  if (limits.size > 10000)
    for (const [id, value] of limits)
      if (value.minute < minute) limits.delete(id);
  if (!entry || entry.minute !== minute) {
    limits.set(siteId, { minute, count: 1 });
    return true;
  }
  return ++entry.count <= 2400;
}
async function boundedJson(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    throw new HttpError(413, "Analytics event is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing event.");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const value = await reader.read();
      if (value.done) break;
      bytes += value.value.length;
      if (bytes > 4096) {
        await reader.cancel();
        throw new HttpError(413, "Analytics event is too large.");
      }
      chunks.push(value.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    reader.releaseLock();
  }
}
export async function collectSiteEvent(
  request: Request,
  site: { id: string; live_release_id: string },
  origin: string,
) {
  const response = (status = 204) =>
    new Response(null, { status, headers: { "cache-control": "no-store" } });
  if (
    !collectionAllowed() ||
    request.headers.get("dnt") === "1" ||
    request.headers.get("sec-gpc") === "1" ||
    /bot|spider|crawler|headless|preview/i.test(
      request.headers.get("user-agent") ?? "",
    )
  )
    return response();
  if (request.headers.get("origin") !== new URL(origin).origin)
    return response(403);
  if (!allowRequest(site.id)) return response(429);
  try {
    const event = siteEventSchema.parse(await boundedJson(request));
    if (event.releaseId !== site.live_release_id) return response();
    await transaction(async (client) => {
      // Same order as manager settings/publication transactions. Disabling or
      // unpublishing waits for, then fences, all in-flight event writes.
      const {
        rows: [current],
      } = await client.query(
        "SELECT s.live_release_id,s.enabled,r.public_catalog FROM workspace_sites s JOIN site_releases r ON r.id=s.live_release_id WHERE s.id=$1 AND axiom_space_state(s.space_id) IN ('active','archived') FOR SHARE OF s",
        [site.id],
      );
      if (
        !current?.enabled ||
        current.live_release_id !== event.releaseId ||
        !current.public_catalog
      )
        return;
      const {
        rows: [config],
      } = await client.query(
        "SELECT settings FROM site_analytics_settings WHERE site_id=$1 FOR SHARE",
        [site.id],
      );
      if (!siteAnalyticsSettingsSchema.parse(config?.settings ?? {}).enabled)
        return;
      const {
        rows: [file],
      } = await client.query(
        "SELECT path FROM site_release_files WHERE release_id=$1 AND path=$2 AND mime LIKE 'text/html%' AND NOT download",
        [event.releaseId, event.page],
      );
      if (!file || event.page === "404.html") return;
      const catalog = current.public_catalog as SiteCatalog;
      const entryId =
        catalog.entries.find((e) => e.path === event.page)?.id ?? "";
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`site-visit:${site.id}:${event.visitId}`],
      );
      const {
        rows: [previous],
      } = await client.query(
        "SELECT * FROM site_analytics_visits WHERE site_id=$1 AND visit_id=$2 FOR UPDATE",
        [site.id, event.visitId],
      );
      if (
        previous &&
        (previous.page !== event.page ||
          previous.release_id !== event.releaseId)
      )
        return;
      if (
        previous &&
        Date.now() - new Date(previous.created_at).getTime() > 86400000
      )
        return;
      const merged = {
        ...event,
        ...Object.fromEntries(
          ["seconds", "depth", "downloads", "citations", "outbound"].map(
            (key) => [
              key,
              Math.max((event as any)[key], Number(previous?.[key] ?? 0)),
            ],
          ),
        ),
      };
      // Clamp active time to elapsed wall time as well as the protocol cap.
      merged.seconds = previous
        ? Math.min(
            merged.seconds,
            Math.ceil(
              (Date.now() - new Date(previous.created_at).getTime()) / 1000,
            ),
          )
        : 0;
      const delta = siteEventDelta(merged, previous);
      if (
        metricKeys.every((key) => delta[key] === 0) &&
        previous?.depth >= merged.depth
      )
        return;
      const referrer = previous?.referrer ?? normalizedReferrer(event.referrer);
      const ref = referrer === new URL(origin).hostname ? "" : referrer;
      const stamp = previous?.day ?? day(new Date());
      await client.query(
        "INSERT INTO site_analytics_visits(site_id,visit_id,release_id,page,entry_id,day,referrer,seconds,depth,downloads,citations,outbound) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(site_id,visit_id) DO UPDATE SET seconds=$8,depth=$9,downloads=$10,citations=$11,outbound=$12,updated_at=now()",
        [
          site.id,
          event.visitId,
          event.releaseId,
          event.page,
          entryId,
          stamp,
          ref,
          merged.seconds,
          merged.depth,
          merged.downloads,
          merged.citations,
          merged.outbound,
        ],
      );
      await client.query(
        "INSERT INTO site_analytics_daily(site_id,day,entry_id,referrer,views,engaged,seconds,completed,downloads,citations,outbound) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(site_id,day,entry_id,referrer) DO UPDATE SET views=site_analytics_daily.views+$5,engaged=site_analytics_daily.engaged+$6,seconds=site_analytics_daily.seconds+$7,completed=site_analytics_daily.completed+$8,downloads=site_analytics_daily.downloads+$9,citations=site_analytics_daily.citations+$10,outbound=site_analytics_daily.outbound+$11",
        [site.id, stamp, entryId, ref, ...metricKeys.map((k) => delta[k])],
      );
      await client.query(
        "INSERT INTO site_analytics_totals(site_id,entry_id,views,downloads) VALUES($1,$2,$3,$4) ON CONFLICT(site_id,entry_id) DO UPDATE SET views=site_analytics_totals.views+$3,downloads=site_analytics_totals.downloads+$4",
        [site.id, entryId, delta.views, delta.downloads],
      );
    });
    return response();
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return response(400);
    if (error instanceof HttpError) return response(error.status);
    console.error("Publication analytics collection unavailable.");
    return response(503);
  }
}
export async function analyticsMaintenance() {
  // Older local databases remain readable until the explicit upgrade step.
  const [exists] = await query(
    "SELECT to_regclass('site_analytics_visits') AS present",
  );
  if (!exists.present) return;
  await query(
    "DELETE FROM site_analytics_visits WHERE created_at<now()-interval '7 days'",
  );
  await query(
    "DELETE FROM site_analytics_daily WHERE day<(current_date-interval '13 months')::date",
  );
}
