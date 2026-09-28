import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Readable } from "node:stream";
import JSZip from "jszip";
import sharp from "sharp";
import { query, transaction } from "./db";
import { getAttachment, removeAttachment } from "./storage";
import { attachmentStream, putGeneratedStream } from "./storage-streams";
import { requireScope, recordActivity } from "./workspace-service";
import { reserveCapacity } from "./uploads-api";
import { escapeHtml as esc } from "@axiom/markdown";
import {
  entryCards,
  entryPath,
  homeBody,
  publicKey,
  resourcePath,
  renderPublicResource,
  siteDocument,
  tagPath,
  SITE_ORIGIN,
  type PublicRenderContext,
} from "./site-render";
import type { SiteSnapshot, PublicationFile } from "./sites";
import { publicationSvg } from "./site-svg";
import {
  buildSiteCatalog,
  archiveMarkup,
  topicsMarkup,
} from "./site-discovery";

export async function processSiteRelease() {
  const [schema] = await query(
    "SELECT to_regclass('site_releases') AS present",
  );
  if (!schema.present) return false;
  await query(
    "WITH expired AS (UPDATE site_releases SET status='failed',error='Publication build interrupted. Submit a new review; the live site was not changed.',lease_until=NULL WHERE status='building' AND lease_until<now() RETURNING id) DELETE FROM site_release_files WHERE release_id IN (SELECT id FROM expired)",
  );
  const record = await transaction(async (client) => {
    const {
      rows: [row],
    } = await client.query(
      "SELECT r.*,s.space_id,s.slug FROM site_releases r JOIN workspace_sites s ON s.id=r.site_id WHERE r.status='queued' ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1",
    );
    if (!row) return null;
    await client.query(
      "UPDATE site_releases SET status='building',lease_until=now()+interval '3 minutes' WHERE id=$1",
      [row.id],
    );
    return row;
  });
  if (!record) return false;
  const keys: string[] = [],
    files: PublicationFile[] = [],
    warnings = new Set<string>();
  let bytes = 0;
  const heartbeat = setInterval(() => {
    void query(
      "UPDATE site_releases SET lease_until=now()+interval '3 minutes' WHERE id=$1 AND status='building'",
      [record.id],
    ).catch(() => {});
  }, 30000);
  const started = Date.now();
  const emit = async (
    path: string,
    data: string | Uint8Array | Readable,
    mime: string,
    download = false,
  ) => {
    if (Date.now() - started > 300000)
      throw new Error(
        "Publication exceeded its five-minute build limit. Publish fewer large resources.",
      );
    const key = randomUUID();
    keys.push(key);
    const saved = await putGeneratedStream(
      key,
      data instanceof Readable
        ? data
        : Readable.from([typeof data === "string" ? Buffer.from(data) : data]),
      mime,
    );
    bytes += saved.bytes;
    if (bytes > 3_000_000_000)
      throw new Error("Generated website exceeds the 3 GB release limit.");
    files.push({ path, storage_key: key, mime, download, ...saved });
    // Durable receipt for cleanup and backup while a build is in progress.
    await transaction(async (client) => {
      await reserveCapacity(client, record.space_id, saved.bytes, false);
      await client.query(
        "INSERT INTO site_release_files(release_id,path,storage_key,mime,bytes,sha256,download) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [record.id, path, key, mime, saved.bytes, saved.sha256, download],
      );
    });
  };
  try {
    await transaction(async (client) => {
      await requireScope(client, record.created_by, record.space_id, "edit");
      await reserveCapacity(client, record.space_id, 0, true);
    });
    const snapshot = record.snapshot as SiteSnapshot,
      assets = new Map<string, string>(),
      originals = new Map<string, string>();
    const publicationDates = await query<{ entry_id: string; day: string }>(
      "SELECT entry_id,to_char(first_published_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day FROM site_entry_publications WHERE site_id=$1",
      [record.site_id],
    );
    const catalog = buildSiteCatalog(
      snapshot,
      Object.fromEntries(publicationDates.map((e) => [e.entry_id, e.day])),
    );
    for (const source of snapshot.sources) {
      if (source.publicationReleaseId) {
        warnings.add(
          "Some private sources are unavailable. This release retains their exact previously published content; it does not read moved or deleted private files.",
        );
        const [retained] = await query(
          "SELECT r.id FROM site_releases r JOIN workspace_sites s ON s.id=r.site_id WHERE r.id=$1 AND s.space_id=$2 AND r.published_at IS NOT NULL AND r.status='ready'",
          [source.publicationReleaseId, record.space_id],
        );
        if (!retained)
          throw new Error(
            "The retained public source is no longer available. Restore or remove that source before reviewing again.",
          );
      }
      if (!source.storageKey) {
        if (
          snapshot.config.entries.some(
            (e) =>
              e.included && e.resourceId === source.id && e.originalDownload,
          )
        ) {
          const extension =
            source.format === "canvas"
              ? "canvas"
              : source.format === "math"
                ? "tex"
                : source.format === "markdown"
                  ? "md"
                  : "txt";
          const path = `downloads/${publicKey(source.id)}/source.${extension}`;
          await emit(path, source.body ?? "", "application/octet-stream", true);
          originals.set(source.id, path);
          warnings.add(
            "Source downloads include the exact approved source, including any metadata it contains.",
          );
        }
        continue;
      }
      const key = publicKey(source.id),
        mime = source.mime ?? "application/octet-stream";
      let path = "";
      if (source.publicationReleaseId) {
        const previous = await query<PublicationFile>(
          "SELECT * FROM site_release_files WHERE release_id=$1 AND (path LIKE $2 OR path LIKE $3)",
          [
            source.publicationReleaseId,
            `assets/${key}.%`,
            `downloads/${key}/%`,
          ],
        );
        const asset = previous.find((f) => f.path.startsWith("assets/"));
        if (asset) {
          await emit(
            asset.path,
            await attachmentStream(asset.storage_key),
            asset.mime,
          );
          assets.set(source.id, asset.path);
          if (source.versionId) assets.set(source.versionId, asset.path);
        }
        if (
          snapshot.config.entries.some(
            (e) =>
              e.included && e.resourceId === source.id && e.originalDownload,
          )
        ) {
          const original = previous.find((f) => f.download);
          if (!original)
            throw new Error(
              `${source.name}: the private original is unavailable. Disable original download or restore the source.`,
            );
          await emit(
            original.path,
            await attachmentStream(original.storage_key),
            original.mime,
            true,
          );
          originals.set(source.id, original.path);
        }
        continue;
      }
      if (
        mime.startsWith("image/") ||
        mime === "application/vnd.axiom.image+zip"
      ) {
        if ((source.bytes ?? 0) > 50_000_000)
          throw new Error(`${source.name}: image preview exceeds 50 MB.`);
        let data = await getAttachment(source.storageKey);
        if (mime === "application/vnd.axiom.image+zip") {
          const zip = await JSZip.loadAsync(data),
            preview = zip.file("preview.png");
          const size = (
            preview as unknown as { _data?: { uncompressedSize?: number } }
          )?._data?.uncompressedSize;
          if (!preview || !size || size > 50_000_000)
            throw new Error("Image project has no safe flattened preview.");
          data = await preview.async("uint8array");
        }
        if (mime === "image/svg+xml") {
          data = publicationSvg(data);
          warnings.add(
            "SVGs are flattened using a restricted vector subset. Check figures for visual differences; embedded images and CSS are omitted.",
          );
        }
        const png = await sharp(data, { limitInputPixels: 40_000_000 })
          .rotate()
          .png()
          .toBuffer();
        path = `assets/${key}.png`;
        await emit(path, png, "image/png");
      } else if (mime === "application/pdf" || /^(audio|video)\//.test(mime)) {
        path = `assets/${key}.${mime === "application/pdf" ? "pdf" : "media"}`;
        await emit(path, await attachmentStream(source.storageKey), mime);
        warnings.add(
          "Published PDFs and media expose their complete bytes and embedded metadata. Inspect originals before approval.",
        );
      }
      if (path) {
        assets.set(source.id, path);
        if (source.versionId) assets.set(source.versionId, path);
      }
      if (
        snapshot.config.entries.some(
          (e) => e.included && e.resourceId === source.id && e.originalDownload,
        )
      ) {
        const original = `downloads/${key}/${source.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150) || "file"}`;
        await emit(
          original,
          await attachmentStream(source.storageKey),
          "application/octet-stream",
          true,
        );
        originals.set(source.id, original);
        warnings.add(
          "Original downloads may contain hidden content, annotations or metadata that is not shown in the public preview.",
        );
      }
    }
    const context: PublicRenderContext = { snapshot, assets, warnings };
    const html = async (
      path: string,
      title: string,
      body: string,
      entry?: SiteSnapshot["config"]["entries"][number],
    ) =>
      emit(
        path,
        siteDocument(snapshot, path, title, body, entry, catalog),
        "text/html; charset=utf-8",
      );
    const allEntries = snapshot.config.entries.filter((e) => e.included),
      entries = allEntries.sort((a, b) =>
        (b.date ?? "").localeCompare(a.date ?? ""),
      );
    for (const source of snapshot.sources) {
      const selected = entries.filter((e) => e.resourceId === source.id);
      for (const entry of [undefined, ...selected]) {
        const path = entry ? entryPath(entry) : resourcePath(source.id);
        let body: string;
        if (
          source.publicationReleaseId &&
          source.format === "file" &&
          !assets.has(source.id)
        ) {
          const [previous] = await query<PublicationFile>(
            "SELECT * FROM site_release_files WHERE release_id=$1 AND path=$2",
            [source.publicationReleaseId, resourcePath(source.id)],
          );
          if (!previous)
            throw new Error("The retained resource preview is unavailable.");
          const page = Buffer.from(
            await getAttachment(previous.storage_key),
          ).toString("utf8");
          body =
            page.match(/<main id="content">([\s\S]*?)<\/main>/)?.[1] ??
            "<p>Preview unavailable.</p>";
          // This is a generated, sanitized public page at the same URL depth,
          // not arbitrary imported HTML. Original download is appended below.
          body = body.replace(
            /<p><a download href="[^"]*">Download original<\/a><\/p>/g,
            "",
          );
        } else
          body = await renderPublicResource(source, path, context, async () => {
            if ((source.bytes ?? 0) > 50_000_000)
              throw new Error(`${source.name}: content preview exceeds 50 MB.`);
            return source.storageKey
              ? getAttachment(source.storageKey)
              : new Uint8Array();
          });
        const { posix } = await import("node:path"),
          download = originals.get(source.id);
        await html(
          path,
          entry?.title ?? source.name,
          body +
            (download
              ? `<p><a download href="${esc(posix.relative(posix.dirname(path), download))}">Download original</a></p>`
              : ""),
          entry,
        );
      }
    }
    await html("index.html", snapshot.config.title, await homeBody(context));
    await html(
      "archive/index.html",
      "Archive",
      `<!--axiom:archive-->${archiveMarkup(catalog)}<!--/axiom:archive-->`,
    );
    await html("tags/index.html", "Topics", topicsMarkup(catalog));
    for (const tag of new Set(entries.flatMap((e) => e.tags))) {
      const path = tagPath(tag);
      await html(
        path,
        tag,
        `<h1>${esc(tag)}</h1>${entryCards(
          entries.filter((e) => e.tags.includes(tag)),
          path,
        )}`,
      );
    }
    for (const author of snapshot.config.authors) {
      const path = `authors/${author.id}/index.html`;
      await html(
        path,
        author.name,
        `<h1>${esc(author.name)}</h1><p>${esc(author.affiliation)}</p><p>${esc(author.bio)}</p>${author.url ? `<a href="${esc(author.url)}" rel="noreferrer">Website</a>` : ""}${author.orcid ? `<p>ORCID: ${esc(author.orcid)}</p>` : ""}${entryCards(
          entries.filter((e) => e.authorIds.includes(author.id)),
          path,
        )}`,
      );
    }
    await html(
      "search/index.html",
      "Search",
      '<h1>Search this site</h1><label>Search publications and pages<input type="search" data-site-search placeholder="Title, topic, author…"></label><div data-search-results></div>',
    );
    await emit(
      "search.json",
      JSON.stringify(
        entries.map((e) => ({
          title: e.title,
          summary: e.summary,
          tags: e.tags,
          path: entryPath(e).replace(/index.html$/, ""),
          authors: snapshot.config.authors
            .filter((a) => e.authorIds.includes(a.id))
            .map((a) => a.name),
        })),
      ),
      "application/json",
    );
    const escapeXml = (s: string) => esc(s).replace(/&#39;/g, "&apos;");
    await emit(
      "feed.xml",
      `<?xml version="1.0"?><rss version="2.0"><channel><title>${escapeXml(snapshot.config.title)}</title><link>${SITE_ORIGIN}/</link><description>${escapeXml(snapshot.config.description)}</description>${entries
        .filter((e) => e.kind !== "page")
        .map(
          (e) =>
            `<item><title>${escapeXml(e.title)}</title><link>${SITE_ORIGIN}/${entryPath(e).replace(/index.html$/, "")}</link><guid>${SITE_ORIGIN}/${entryPath(e).replace(/index.html$/, "")}</guid><description>${escapeXml(e.summary)}</description></item>`,
        )
        .join("")}</channel></rss>`,
      "application/rss+xml",
    );
    await emit(
      "sitemap.xml",
      `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files
        .filter(
          (f) =>
            f.mime.startsWith("text/html") && !f.path.startsWith("resources/"),
        )
        .map(
          (f) =>
            `<url><loc>${SITE_ORIGIN}/${escapeXml(f.path.replace(/index.html$/, ""))}</loc></url>`,
        )
        .join("")}</urlset>`,
      "application/xml",
    );
    await emit(
      "robots.txt",
      `User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`,
      "text/plain",
    );
    await html(
      "404.html",
      "Page unavailable",
      "<h1>This page is unavailable</h1><p>It may have been unpublished or moved.</p>",
    );
    const root = resolve(process.cwd(), "apps/publish/dist");
    const copy = async (dir: string, prefix: string) => {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, item.name),
          dest = prefix + item.name;
        if (item.isDirectory()) await copy(path, dest + "/");
        else if (item.isFile()) {
          const mime =
            item.name.endsWith(".js") || item.name.endsWith(".mjs")
              ? "text/javascript"
              : item.name.endsWith(".css")
                ? "text/css"
                : item.name.endsWith(".woff2")
                  ? "font/woff2"
                  : item.name.endsWith(".wasm")
                    ? "application/wasm"
                    : "application/octet-stream";
          await emit(dest, await readFile(path), mime);
        }
      }
    };
    await copy(root, "_site/");
    await transaction(async (client) => {
      await requireScope(client, record.created_by, record.space_id, "edit");
      const {
        rows: [state],
      } = await client.query(
        "SELECT status FROM site_releases WHERE id=$1 FOR UPDATE",
        [record.id],
      );
      if (state?.status !== "building")
        throw new Error("Build was cancelled or expired.");
      // Files in this build are already included in publication usage below.
      await reserveCapacity(client, record.space_id, 0, false);
      await client.query(
        "UPDATE site_releases SET status='ready',warnings=$2,lease_until=NULL,public_catalog=$3 WHERE id=$1",
        [record.id, JSON.stringify([...warnings]), JSON.stringify(catalog)],
      );
      await recordActivity(client, {
        spaceId: record.space_id,
        userId: record.created_by,
        kind: "site",
        title: "Website preview ready for review",
      });
    });
  } catch (error) {
    await query(
      "UPDATE site_releases SET status='failed',error=$2,lease_until=NULL WHERE id=$1",
      [
        record.id,
        (error instanceof Error ? error.message : "Build failed").slice(
          0,
          1000,
        ),
      ],
    );
    await query("DELETE FROM site_release_files WHERE release_id=$1", [
      record.id,
    ]);
    await Promise.all(keys.map((key) => removeAttachment(key).catch(() => {})));
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
