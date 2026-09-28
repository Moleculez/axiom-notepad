import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { query } from "./db";
import { exportRelease, serveRelease } from "./site-http";
import { HttpError, spaceAccess } from "./access";
import { flushNote, notifyWorkspace } from "./documents";
import {
  requireScope,
  workspaceJson as json,
  workspaceMutation,
} from "./workspace-service";
import { recordSiteActivity as recordActivity } from "./site-activity";
import {
  defaultSiteConfig,
  publicationFileMime,
  siteConfigSchema,
  siteSlug,
  sourceIds,
  type SiteConfig,
  type SiteSnapshot,
  type SourceSnapshot,
} from "./sites";
import { publicationHostname, verifyPublicationDomain } from "./site-domains";
import { siteAnalyticsApi, analyticsSettings } from "./site-analytics";
import { designPreview, designAsset } from "./site-design-preview";

const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const mutation = z.object({
  mutationId: z.uuid(),
  version: z.number().int().positive().optional(),
});
async function siteRow(client: PoolClient, spaceId: string) {
  const {
    rows: [row],
  } = await client.query(
    "SELECT * FROM workspace_sites WHERE space_id=$1 FOR UPDATE",
    [spaceId],
  );
  if (!row) throw new HttpError(404, "Set up this workspace's website first.");
  return row;
}
async function snapshot(
  client: PoolClient,
  userId: string,
  spaceId: string,
  config: SiteConfig,
): Promise<SiteSnapshot> {
  await requireScope(client, userId, spaceId, "edit");
  const ids = sourceIds(config);
  const { rows } = await client.query(
    `SELECT r.id,r.name,r.kind,r.version,r.current_version_id,n.body,n.source_format,n.generation,a.storage_key,a.mime,a.bytes,p.settings
    FROM resources r LEFT JOIN notes n ON n.id=r.note_id LEFT JOIN attachments a ON a.id=r.current_version_id LEFT JOIN tool_projects p ON p.resource_id=r.id
    WHERE r.id=ANY($1::uuid[]) AND r.space_id=$2 AND r.deleted_at IS NULL AND r.kind IN ('note','file')`,
    [ids, spaceId],
  );
  const sources: SourceSnapshot[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    format: r.source_format ?? (r.kind === "note" ? "markdown" : "file"),
    version: r.version,
    ...(r.kind === "note"
      ? { body: r.body, generation: r.generation, settings: r.settings ?? {} }
      : {
          versionId: r.current_version_id,
          storageKey: r.storage_key,
          mime: publicationFileMime(r.name, r.mime),
          bytes: Number(r.bytes),
        }),
  }));
  if (rows.length !== ids.length) {
    const {
      rows: [published],
    } = await client.query(
      "SELECT r.id,r.snapshot FROM workspace_sites s JOIN site_releases r ON r.id=s.live_release_id WHERE s.space_id=$1 AND r.published_at IS NOT NULL AND r.status='ready'",
      [spaceId],
    );
    for (const id of ids.filter((id) => !sources.some((s) => s.id === id))) {
      const retained = (
        published?.snapshot as SiteSnapshot | undefined
      )?.sources.find((s) => s.id === id);
      if (!retained)
        throw new HttpError(
          409,
          "A selected resource is missing, trashed, or outside this workspace, and has no retained published copy. Remove it from the draft or restore the source.",
        );
      sources.push({ ...retained, publicationReleaseId: published.id });
    }
  }
  const imageIds = [
    config.logoId,
    ...config.entries.filter((e) => e.included).map((e) => e.coverId),
  ].filter(Boolean);
  if (
    imageIds.some(
      (id) =>
        !sources.some(
          (s) =>
            s.id === id &&
            (s.mime?.startsWith("image/") ||
              s.mime === "application/vnd.axiom.image+zip"),
        ),
    )
  )
    throw new HttpError(
      400,
      "Site logos and covers must be image files from this workspace.",
    );
  if (
    sources.some((s) => s.format === "file" && (!s.storageKey || !s.versionId))
  )
    throw new HttpError(409, "A selected file has no completed version.");
  if (sources.reduce((n, s) => n + (s.bytes ?? 0), 0) > 2_000_000_000)
    throw new HttpError(
      413,
      "A publication release can include up to 2 GB of source files.",
    );
  // Only bibliography entries actually cited by selected content are retained.
  const texts = sources.map((s) => s.body ?? "").join("\n");
  const { rows: refs } = await client.query(
    `SELECT b.cite_key,b.title,b.authors,b.year,b.url FROM bibliography b JOIN spaces s ON s.group_id=b.group_id WHERE s.id=$1
    UNION ALL SELECT p.cite_key,p.data->>'title',p.data->>'authors',p.data->>'year',p.data->>'url' FROM personal_citations p WHERE p.note_id=ANY($2::uuid[])`,
    [spaceId, ids],
  );
  const references = Object.fromEntries(
    refs
      .filter((r) => texts.includes("@" + r.cite_key))
      .map((r) => [
        r.cite_key,
        { title: r.title, authors: r.authors, year: r.year, url: r.url },
      ]),
  );
  const result = {
    config,
    sources,
    references,
    createdAt: new Date().toISOString(),
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 25_000_000)
    throw new HttpError(413, "The text in this release exceeds 25 MB.");
  return result;
}
export async function sitesApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  if (path[0] !== "spaces" || path[2] !== "site") return null;
  const spaceId = z.uuid().parse(path[1]),
    section = path[3],
    id = path[4],
    op = path[5],
    method = request.method;
  const space = await spaceAccess(userId, spaceId, "read");
  if (method === "POST" && section === "design-preview")
    return json({ html: await designPreview(request, spaceId) });
  if (method === "GET" && section === "design-assets")
    return designAsset(path.slice(4));
  if (section === "analytics")
    return siteAnalyticsApi(request, spaceId, userId, id);
  if (method === "GET" && !section) {
    const [site] = await query(
      "SELECT * FROM workspace_sites WHERE space_id=$1",
      [spaceId],
    );
    if (!site)
      return json({
        site: null,
        canManage: space.can_manage,
        canEdit: space.role === "editor",
        suggested: defaultSiteConfig(space.name, space.kind === "personal"),
      });
    const [releases, domains, status] = await Promise.all([
      query(
        // Never hide cleanup candidates behind a long published history. The
        // review cap counts unpublished drafts, which must all remain reachable.
        "SELECT id,status,fingerprint,created_at,published_at,error,warnings,created_by FROM site_releases WHERE site_id=$1 AND (published_at IS NULL OR id=$2 OR id IN (SELECT id FROM site_releases WHERE site_id=$1 AND published_at IS NOT NULL ORDER BY created_at DESC LIMIT 100)) ORDER BY created_at DESC",
        [site.id, site.live_release_id],
      ),
      query(
        "SELECT id,hostname,token,status,verified_at,error FROM site_domains WHERE site_id=$1",
        [site.id],
      ),
      query(
        "SELECT id,version,deleted_at IS NULL AS available FROM resources WHERE id=ANY($1::uuid[]) AND space_id=$2",
        [sourceIds(siteConfigSchema.parse(site.config)), spaceId],
      ),
    ]);
    return json({
      site: {
        ...site,
        config: siteConfigSchema.parse(site.config),
        releases,
        domains,
        canManage: space.can_manage,
        canEdit: space.role === "editor",
        sourceStatus: sourceIds(siteConfigSchema.parse(site.config)).map(
          (id) =>
            status.find((s) => s.id === id) ?? {
              id,
              available: false,
              version: 0,
            },
        ),
        publicUrl: `${process.env.APP_URL}/sites/${site.slug}/`,
        domainTarget: process.env.PUBLISH_DOMAIN_TARGET ?? null,
      },
    });
  }
  if ((method === "GET" || method === "HEAD") && section === "releases" && id) {
    const [release] = await query(
      "SELECT r.* FROM site_releases r JOIN workspace_sites s ON s.id=r.site_id WHERE s.space_id=$1 AND r.id=$2",
      [spaceId, z.uuid().parse(id)],
    );
    if (!release) throw new HttpError(404, "Release not found.");
    if (op === "preview" || op === "export") {
      if (release.status !== "ready")
        throw new HttpError(409, "This preview is not ready yet.");
      const base = new URL(request.url);
      if (op === "export") {
        await spaceAccess(userId, spaceId, "manage");
        const origin = z
          .url()
          .max(2000)
          .parse(base.searchParams.get("baseUrl"));
        try {
          const google =
            base.searchParams.get("includeGoogle") === "1"
              ? (await analyticsSettings(release.site_id)).settings
                  .googleMeasurementId
              : "";
          return await exportRelease(id, origin, google);
        } catch (error) {
          throw new HttpError(
            400,
            error instanceof Error ? error.message : "Export unavailable.",
          );
        }
      }
      const previewBase = `${base.origin}/api/v1/spaces/${spaceId}/site/releases/${id}/preview`;
      if (!base.pathname.endsWith("/") && path.length === 6)
        return Response.redirect(previewBase + "/", 307);
      // The API router decodes segments. Keep the original encoded path used by
      // static tag URLs rather than accidentally decoding an encoded slash.
      const suffix = base.pathname.split(`/releases/${id}/preview/`)[1] ?? "";
      return serveRelease(request, id, suffix, previewBase, true);
    }
    return json(release);
  }
  const raw = await request.json();
  if (Buffer.byteLength(JSON.stringify(raw)) > 3_000_000)
    throw new HttpError(413, "Website configuration is too large.");
  const key = mutation.parse(raw);
  if (method === "POST" && section === "review") {
    await spaceAccess(userId, spaceId, "edit");
    const [existing] = await query(
      "SELECT config FROM workspace_sites WHERE space_id=$1",
      [spaceId],
    );
    if (existing)
      for (const sourceId of sourceIds(
        siteConfigSchema.parse(existing.config),
      )) {
        const [note] = await query<{ id: string; generation: number }>(
          "SELECT n.id,n.generation FROM resources r JOIN notes n ON n.id=r.note_id WHERE r.id=$1 AND r.space_id=$2 AND r.deleted_at IS NULL",
          [sourceId, spaceId],
        );
        if (note) {
          try {
            await flushNote(note);
          } catch {
            throw new HttpError(
              503,
              "Cannot confirm the latest saved document. Reconnect synchronization, then build a new preview.",
            );
          }
        }
      }
  }
  let verifiedDomain: string | undefined;
  if (method === "POST" && section === "domains" && op === "verify") {
    await spaceAccess(userId, spaceId, "manage");
    const [domain] = await query(
      "SELECT d.* FROM site_domains d JOIN workspace_sites s ON s.id=d.site_id WHERE s.space_id=$1 AND d.id=$2",
      [spaceId, z.uuid().parse(id)],
    );
    if (!domain) throw new HttpError(404, "Domain not found.");
    await verifyPublicationDomain(domain.hostname, domain.token);
    verifiedDomain = domain.token;
  }
  const result = await workspaceMutation(
    userId,
    key.mutationId,
    "site:" + method + ":" + path.join("/"),
    raw,
    async (client) => {
      const manage =
        (method === "POST" && !section) ||
        section === "domains" ||
        ["publish", "rollback", "unpublish"].includes(section ?? "");
      await requireScope(client, userId, spaceId, manage ? "manage" : "edit");
      if (method === "POST" && !section) {
        const input = z
          .object({ slug: siteSlug, config: siteConfigSchema })
          .parse(raw);
        if (
          input.config.identity !==
          (space.kind === "personal" ? "personal" : "team")
        )
          throw new HttpError(400, "Site identity must match its workspace.");
        const {
          rows: [created],
        } = await client.query(
          "INSERT INTO workspace_sites(space_id,slug,config) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
          [spaceId, input.slug, JSON.stringify(input.config)],
        );
        if (!created)
          throw new HttpError(
            409,
            "This workspace already has a website, or this site address is taken. Choose another address.",
          );
        await recordActivity(client, {
          spaceId,
          userId,
          kind: "site",
          title: "Created a private website draft",
        });
        return created;
      }
      const site = await siteRow(client, spaceId);
      if (method === "PATCH" && !section) {
        if (site.version !== key.version)
          throw new HttpError(
            409,
            "The website draft changed. Reload before saving.",
          );
        const config = siteConfigSchema.parse(raw.config);
        if (config.identity !== site.config.identity)
          throw new HttpError(400, "Site identity cannot be changed.");
        await client.query(
          "UPDATE workspace_sites SET config=$2,version=version+1,updated_at=now() WHERE id=$1",
          [site.id, JSON.stringify(config)],
        );
        await recordActivity(client, {
          spaceId,
          userId,
          kind: "site",
          title: "Updated website draft",
        });
        return { saved: true };
      }
      if (method === "POST" && section === "review") {
        if (site.version !== key.version)
          throw new HttpError(409, "Save and review the current draft first.");
        const {
          rows: [count],
        } = await client.query(
          "SELECT count(*)::int AS total FROM site_releases WHERE site_id=$1 AND published_at IS NULL",
          [site.id],
        );
        if (count.total >= 100)
          throw new HttpError(
            409,
            "There are 100 unpublished release drafts. Remove unused drafts before requesting another review.",
          );
        const data = await snapshot(
          client,
          userId,
          spaceId,
          siteConfigSchema.parse(site.config),
        );
        await client.query(
          "INSERT INTO site_releases(id,site_id,created_by,snapshot,fingerprint) VALUES($1,$2,$3,$4,$5)",
          [key.mutationId, site.id, userId, JSON.stringify(data), hash(data)],
        );
        await recordActivity(client, {
          spaceId,
          userId,
          kind: "site",
          title: "Submitted a frozen website release for review",
        });
        return { id: key.mutationId };
      }
      if (
        method === "POST" &&
        ["publish", "rollback"].includes(section ?? "")
      ) {
        const input = z
          .object({
            releaseId: z.uuid(),
            fingerprint: z.string().length(64),
            consent: z.literal(true),
          })
          .parse(raw);
        const {
          rows: [release],
        } = await client.query(
          "SELECT * FROM site_releases WHERE id=$1 AND site_id=$2 FOR UPDATE",
          [input.releaseId, site.id],
        );
        if (
          !release ||
          release.status !== "ready" ||
          release.fingerprint !== input.fingerprint
        )
          throw new HttpError(
            409,
            "Review this completed release before publishing.",
          );
        if (section === "rollback" && !release.published_at)
          throw new HttpError(
            409,
            "Only previously published releases can be restored.",
          );
        if (!release.published_at) {
          const ids = (release.snapshot as SiteSnapshot).sources
            .filter((s) => !s.publicationReleaseId)
            .map((s) => s.id);
          const {
            rows: [access],
          } = await client.query(
            "SELECT count(*)::int AS total FROM resources WHERE id=ANY($1::uuid[]) AND space_id=$2 AND deleted_at IS NULL",
            [ids, spaceId],
          );
          if (access.total !== ids.length)
            throw new HttpError(
              409,
              "A reviewed source was removed or moved. Build a new preview.",
            );
        }
        await client.query(
          "UPDATE workspace_sites SET live_release_id=$2,enabled=true,updated_at=now() WHERE id=$1",
          [site.id, release.id],
        );
        await client.query(
          "UPDATE site_releases SET published_at=coalesce(published_at,now()) WHERE id=$1",
          [release.id],
        );
        await client.query(
          "INSERT INTO site_entry_publications(site_id,entry_id,first_published_at) SELECT $1,(entry->>'id')::uuid,coalesce($3::timestamptz,now()) FROM jsonb_array_elements($2::jsonb) entry WHERE coalesce((entry->>'included')::boolean,true) ON CONFLICT DO NOTHING",
          [
            site.id,
            JSON.stringify(release.snapshot.config.entries),
            release.published_at,
          ],
        );
        await recordActivity(client, {
          spaceId,
          userId,
          kind: "site",
          title:
            section === "rollback"
              ? "Restored a published website release"
              : "Published a reviewed website release",
        });
        return { published: true };
      }
      if (method === "POST" && section === "unpublish") {
        await client.query(
          "UPDATE workspace_sites SET enabled=false,updated_at=now() WHERE id=$1",
          [site.id],
        );
        await recordActivity(client, {
          spaceId,
          userId,
          kind: "site",
          title: "Unpublished website",
        });
        return { unpublished: true };
      }
      if (method === "POST" && section === "domains" && !id) {
        const hostname = publicationHostname(z.string().parse(raw.hostname));
        const token = randomBytes(24).toString("hex");
        const created = await client.query(
          "INSERT INTO site_domains(site_id,hostname,token) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
          [site.id, hostname, token],
        );
        if (!created.rowCount)
          throw new HttpError(
            409,
            "This site already has a domain, or that domain belongs to another site. Disconnect the old mapping first.",
          );
        await recordActivity(client, {
          spaceId,
          userId,
          kind: "site",
          title: "Added pending website domain",
        });
        return { created: true };
      }
      if (section === "domains" && id) {
        if (method === "POST" && op === "verify") {
          const r = await client.query(
            "UPDATE site_domains SET status='verified',verified_at=now(),error=NULL WHERE site_id=$1 AND id=$2 AND token=$3 RETURNING id",
            [site.id, z.uuid().parse(id), verifiedDomain],
          );
          if (!r.rowCount)
            throw new HttpError(
              409,
              "Domain configuration changed. Verify again.",
            );
          await recordActivity(client, {
            spaceId,
            userId,
            kind: "site",
            title: "Verified website domain ownership and routing",
          });
          return { verified: true };
        }
        if (method === "DELETE") {
          await client.query(
            "DELETE FROM site_domains WHERE id=$1 AND site_id=$2",
            [z.uuid().parse(id), site.id],
          );
          await recordActivity(client, {
            spaceId,
            userId,
            kind: "site",
            title: "Disconnected website domain",
          });
          return { removed: true };
        }
      }
      if (method === "DELETE" && section === "releases" && id) {
        await requireScope(client, userId, spaceId, "manage");
        const {
          rows: [release],
        } = await client.query(
          "SELECT published_at FROM site_releases WHERE id=$1 AND site_id=$2 FOR UPDATE",
          [z.uuid().parse(id), site.id],
        );
        if (!release || release.published_at)
          throw new HttpError(
            409,
            "Only unpublished draft releases can be removed.",
          );
        await client.query("DELETE FROM site_releases WHERE id=$1", [id]);
        return { removed: true };
      }
      throw new HttpError(404, "Unknown website operation.");
    },
  );
  await notifyWorkspace();
  return json(result);
}
