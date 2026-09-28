import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import { query } from "./db";
import { getAttachment } from "./storage";
import { attachmentStream } from "./storage-streams";
import { SITE_ORIGIN } from "./site-paths";
import { hydrateCatalogMetadata } from "./site-discovery";
import {
  analyticsSettings,
  collectionAllowed,
  collectSiteEvent,
  publicationCatalog,
} from "./site-analytics";
import type { SiteCatalog } from "./site-insights";
import type { PublicationFile } from "./sites";

export const publicationCsp =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'";
const headers = {
  "content-security-policy": publicationCsp,
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "no-referrer",
  "cache-control": "public, max-age=0, must-revalidate",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};
const runtimeMarkup = (value: unknown) =>
  value
    ? `<script type="application/json" id="axiom-site-runtime">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`
    : "";
export function analyticsCsp(google: boolean) {
  return google
    ? publicationCsp
        .replace(
          "script-src 'self'",
          "script-src 'self' https://www.googletagmanager.com",
        )
        .replace(
          "connect-src 'self'",
          "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com",
        )
        .replace(
          "img-src 'self' data: blob:",
          "img-src 'self' data: blob: https://www.googletagmanager.com https://*.google-analytics.com",
        )
    : publicationCsp;
}
const textFile = (mime: string) =>
  /^(text\/html|application\/(rss\+xml|xml)|text\/plain)/.test(mime);
export function publicationPath(value: string) {
  if (
    value.length > 2000 ||
    /[\\\u0000-\u001f]/.test(value) ||
    value.split("/").some((v) => v === ".." || v === ".")
  )
    return null;
  return value.endsWith("/") || !value ? value + "index.html" : value;
}
export async function serveRelease(
  request: Request,
  releaseId: string,
  path: string,
  origin: string,
  preview = false,
  runtime?: Record<string, unknown>,
) {
  const safe = publicationPath(path);
  if (!safe) return new Response("Not found", { status: 404, headers });
  const [file] = await query<PublicationFile>(
    "SELECT path,storage_key,mime,bytes,sha256,download FROM site_release_files WHERE release_id=$1 AND path=$2",
    [releaseId, safe],
  );
  if (!file) return new Response("Page not found", { status: 404, headers });
  const out: Record<string, string> = {
    ...headers,
    "content-type": file.mime,
    ...(preview
      ? {
          "cache-control": "private, no-store",
          "x-robots-tag": "noindex, nofollow",
        }
      : {}),
    etag: `"${file.sha256}-${Buffer.from(origin).toString("base64url")}"`,
  };
  // Operational privacy controls and first-publication metadata are not stored
  // in the immutable document blobs. Avoid stale conditional HTML responses.
  if (file.mime.startsWith("text/html")) {
    delete out.etag;
    out["cache-control"] = "no-store";
    out["content-security-policy"] = analyticsCsp(
      !preview && !!runtime?.googleMeasurementId,
    );
  }
  if (file.download)
    out["content-disposition"] = `attachment; filename="${safe
      .split("/")
      .at(-1)!
      .replace(/["\r\n]/g, "_")}"`;
  if (!preview && request.headers.get("if-none-match") === out.etag)
    return new Response(null, { status: 304, headers: out });
  if (textFile(file.mime)) {
    let data = Buffer.from(await getAttachment(file.storage_key))
      .toString("utf8")
      .replaceAll(SITE_ORIGIN, origin.replace(/\/$/, ""));
    if (data.includes("<!--axiom:runtime-->")) {
      const catalog = await publicationCatalog(releaseId);
      if (catalog) data = hydrateCatalogMetadata(data, catalog);
      data = data.replace(
        "<!--axiom:runtime-->",
        preview ? "" : runtimeMarkup(runtime),
      );
    }
    return new Response(request.method === "HEAD" ? null : data, {
      headers: out,
    });
  }
  const total = Number(file.bytes),
    raw = request.headers.get("range");
  let range: { start: number; end: number } | undefined;
  if (raw) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(raw);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, {
        status: 416,
        headers: { ...out, "content-range": `bytes */${total}` },
      });
    const start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2])),
      end = m[1] && m[2] ? Math.min(total - 1, Number(m[2])) : total - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= total
    )
      return new Response(null, {
        status: 416,
        headers: { ...out, "content-range": `bytes */${total}` },
      });
    range = { start, end };
    out["content-range"] = `bytes ${start}-${end}/${total}`;
  }
  out["accept-ranges"] = "bytes";
  out["content-length"] = String(range ? range.end - range.start + 1 : total);
  return new Response(
    request.method === "HEAD"
      ? null
      : (Readable.toWeb(
          await attachmentStream(file.storage_key, range),
        ) as ReadableStream),
    { status: range ? 206 : 200, headers: out },
  );
}
export async function exportRelease(
  releaseId: string,
  origin: string,
  googleMeasurementId = "",
) {
  const parsed = new URL(origin);
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      "Use an HTTP(S) deployment URL without credentials, query or fragment.",
    );
  const files = await query<PublicationFile>(
    "SELECT * FROM site_release_files WHERE release_id=$1 ORDER BY path",
    [releaseId],
  );
  const zip = new ZipFile();
  const catalog = await publicationCatalog(releaseId);
  for (const file of files) {
    if (textFile(file.mime))
      zip.addBuffer(
        Buffer.from(
          hydrateCatalogMetadata(
            Buffer.from(await getAttachment(file.storage_key)).toString("utf8"),
            catalog ?? { version: 1, entries: [], authors: [] },
          )
            .replaceAll(SITE_ORIGIN, parsed.href.replace(/\/$/, ""))
            .replace(
              "<!--axiom:runtime-->",
              runtimeMarkup(
                googleMeasurementId
                  ? { googleMeasurementId, enabled: false, static: true }
                  : null,
              ),
            ),
        ),
        file.path,
      );
    else
      zip.addReadStreamLazy(
        file.path,
        { compress: false, size: Number(file.bytes) },
        (done) => {
          void attachmentStream(file.storage_key).then(
            (s) => done(null, s),
            (e) => done(e as Error, Readable.from([])),
          );
        },
      );
  }
  zip.addBuffer(
    Buffer.from(
      `Serve this folder with a static HTTP server. Directory URLs require index.html resolution. All research viewers and approved resources are bundled locally. Public copies cannot be retracted by unpublishing the source Axiom site. First-party analytics and live counters are not exported.${googleMeasurementId ? " The optional Google tag loads only after visitor consent; configure these CSP directives on your host: " + analyticsCsp(true) : " No analytics are enabled."}\n`,
    ),
    "HOSTING.txt",
  );
  zip.end();
  return new Response(
    Readable.toWeb(zip.outputStream as Readable) as ReadableStream,
    {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="axiom-site.zip"',
        "cache-control": "private, no-store",
      },
    },
  );
}
export async function publicSiteRequest(request: Request) {
  const url = new URL(request.url),
    host = url.hostname.toLowerCase();
  const app = new URL(process.env.APP_URL || "http://localhost:8080");
  let site, path, origin;
  if (host === app.hostname || host === "localhost" || host === "127.0.0.1") {
    const match = /^\/sites\/([a-z0-9-]+)(\/.*)?$/.exec(url.pathname);
    if (!match) return new Response("Not found", { status: 404, headers });
    [site] = await query(
      "SELECT s.*,d.hostname AS domain FROM workspace_sites s LEFT JOIN site_domains d ON d.site_id=s.id AND d.status='verified' WHERE s.slug=$1 AND s.enabled AND axiom_space_state(s.space_id) IN ('active','archived')",
      [match[1]],
    );
    if (site?.domain)
      return Response.redirect(
        `https://${site.domain}${match[2] || "/"}${url.search}`,
        302,
      );
    if (!match[2]) {
      url.pathname += "/";
      return Response.redirect(url, 308);
    }
    path = match[2].slice(1);
    origin = `${app.origin}/sites/${match[1]}`;
  } else {
    [site] = await query(
      "SELECT s.* FROM workspace_sites s JOIN site_domains d ON d.site_id=s.id WHERE d.hostname=$1 AND d.status='verified' AND s.enabled AND axiom_space_state(s.space_id) IN ('active','archived')",
      [host],
    );
    path = url.pathname.slice(1);
    origin = `https://${host}`;
  }
  if (!site?.live_release_id)
    return new Response("This site is not published.", {
      status: 404,
      headers,
    });
  if (path!.startsWith("_site/analytics/")) {
    const endpoint = path!.slice("_site/analytics/".length);
    if (endpoint === "events" && request.method === "POST")
      return collectSiteEvent(
        request,
        { id: site.id, live_release_id: site.live_release_id },
        origin!,
      );
    if (request.method !== "GET")
      return new Response(null, { status: 405, headers });
    const { settings } = await analyticsSettings(site.id);
    const [release] = await query(
      "SELECT public_catalog FROM site_releases WHERE id=$1",
      [site.live_release_id],
    );
    const catalog = release?.public_catalog as SiteCatalog | null;
    if (endpoint === "config")
      return Response.json(
        {
          releaseId: site.live_release_id,
          enabled: !!catalog && collectionAllowed() && settings.enabled,
          googleMeasurementId:
            catalog && collectionAllowed() ? settings.googleMeasurementId : "",
          publicViews: settings.publicViews,
          publicDownloads: settings.publicDownloads,
          publicSiteTotals: settings.publicSiteTotals,
        },
        { headers: { ...headers, "cache-control": "no-store" } },
      );
    if (endpoint === "totals") {
      const entry = url.searchParams.get("entry"),
        valid = catalog?.entries.map((e) => e.id) ?? [];
      if (
        !catalog ||
        (!settings.publicViews && !settings.publicDownloads) ||
        (entry ? !valid.includes(entry) : !settings.publicSiteTotals)
      )
        return new Response(null, {
          status: 404,
          headers: { ...headers, "cache-control": "no-store" },
        });
      const [totals] = await query(
        "SELECT coalesce(sum(views),0) AS views,coalesce(sum(downloads),0) AS downloads FROM site_analytics_totals WHERE site_id=$1 AND entry_id=ANY($2::text[])",
        [site.id, entry ? [entry] : ["", ...valid]],
      );
      return Response.json(
        {
          ...(settings.publicViews ? { views: Number(totals.views) } : {}),
          ...(settings.publicDownloads
            ? { downloads: Number(totals.downloads) }
            : {}),
        },
        { headers: { ...headers, "cache-control": "no-store" } },
      );
    }
    return new Response(null, { status: 404, headers });
  }
  if (!["GET", "HEAD"].includes(request.method))
    return new Response(null, { status: 405, headers });
  // Do not attach operational data to scripts, images, downloads or old releases.
  const safe = publicationPath(path!);
  let runtime: Record<string, unknown> | undefined;
  if (safe?.endsWith(".html")) {
    const { settings } = await analyticsSettings(site.id);
    runtime = {
      ...settings,
      enabled: settings.enabled && collectionAllowed(),
      googleMeasurementId: collectionAllowed()
        ? settings.googleMeasurementId
        : "",
      releaseId: site.live_release_id,
      base: origin,
    };
  }
  return serveRelease(
    request,
    site.live_release_id,
    path!,
    origin!,
    false,
    runtime,
  );
}
