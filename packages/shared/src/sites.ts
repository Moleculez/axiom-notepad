import { z } from "zod";
import {
  siteThemeSchema,
  siteReadingSchema,
  siteArchiveSchema,
} from "./site-design";

export const siteSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use letters, numbers and single hyphens.",
  );
const safeLink = z
  .string()
  .max(2000)
  .refine((v) => {
    if (!v) return true;
    try {
      const u = new URL(v);
      return (
        u.protocol === "https:" && !!u.hostname && !u.username && !u.password
      );
    } catch {
      return false;
    }
  }, "Use a valid HTTPS address without credentials.");
export const siteAuthorSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(120),
    bio: z.string().max(2000).default(""),
    affiliation: z.string().max(200).default(""),
    url: safeLink.default(""),
    orcid: z.string().max(50).default(""),
  })
  .strict();
export const siteEntrySchema = z
  .object({
    id: z.uuid(),
    resourceId: z.uuid(),
    kind: z.enum(["post", "page", "paper", "resource"]),
    slug: siteSlug,
    title: z.string().trim().min(1).max(200),
    summary: z.string().max(2000).default(""),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    authorIds: z.array(z.uuid()).max(20).default([]),
    date: z.iso.date().optional(),
    doi: z.string().max(200).default(""),
    license: z.string().max(100).default(""),
    coverId: z.uuid().nullable().default(null),
    originalDownload: z.boolean().default(false),
    included: z.boolean().default(true),
  })
  .strict();
export const siteSectionSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum([
      "intro",
      "featured",
      "publications",
      "posts",
      "people",
      "research",
      "gallery",
      "resources",
      "markdown",
    ]),
    title: z.string().max(200).default(""),
    text: z.string().max(20000).default(""),
    entryIds: z.array(z.uuid()).max(100).default([]),
    hidden: z.boolean().default(false),
  })
  .strict();
export const siteDesignSchema = z
  .object({
    theme: siteThemeSchema.default("classic"),
    reading: siteReadingSchema.prefault({}),
    archive: siteArchiveSchema.prefault({}),
    template: z
      .enum(["scholar", "notebook", "lab", "journal"])
      .default("scholar"),
    mode: z.enum(["light", "dark", "system"]).default("system"),
    accent: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .default("#315c83"),
    font: z.enum(["theme", "sans", "serif", "latin-modern"]).default("serif"),
    spacing: z.enum(["comfortable", "compact"]).default("comfortable"),
    sections: z.array(siteSectionSchema).max(30).default([]),
  })
  .strict();
export const siteConfigSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    description: z.string().max(2000).default(""),
    identity: z.enum(["personal", "team"]),
    logoId: z.uuid().nullable().default(null),
    authors: z.array(siteAuthorSchema).max(100).default([]),
    entries: z.array(siteEntrySchema).max(500).default([]),
    assetIds: z.array(z.uuid()).max(500).default([]),
    design: siteDesignSchema.prefault({}),
    navigation: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(60),
            entryId: z.uuid().optional(),
            url: safeLink.optional(),
          })
          .strict()
          .refine(
            (v) => !!v.entryId !== !!v.url,
            "Choose a page or an external HTTPS URL.",
          ),
      )
      .max(20)
      .default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    const entryIds = new Set(v.entries.map((e) => e.id));
    if (
      new Set(v.design.sections.map((s) => s.id)).size !==
      v.design.sections.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Section IDs must be unique",
        path: ["design", "sections"],
      });
    if (
      v.design.sections.some((s) =>
        s.entryIds.some((id) => !entryIds.has(id)),
      ) ||
      v.navigation.some((n) => n.entryId && !entryIds.has(n.entryId))
    )
      ctx.addIssue({
        code: "custom",
        message: "Remove references to pages no longer in this draft",
        path: ["navigation"],
      });
    for (const field of ["id", "slug"] as const)
      if (new Set(v.entries.map((e) => e[field])).size !== v.entries.length)
        ctx.addIssue({
          code: "custom",
          message: `Page ${field}s must be unique`,
          path: ["entries"],
        });
    if (new Set(v.authors.map((a) => a.id)).size !== v.authors.length)
      ctx.addIssue({
        code: "custom",
        message: "Author IDs must be unique",
        path: ["authors"],
      });
    for (const e of v.entries)
      if (e.authorIds.some((id) => !v.authors.some((a) => a.id === id)))
        ctx.addIssue({
          code: "custom",
          message: "Choose authors from this site's public profiles",
          path: ["entries"],
        });
  });
export type SiteConfig = z.infer<typeof siteConfigSchema>;
export type SiteEntry = z.infer<typeof siteEntrySchema>;
export type SiteDesign = z.infer<typeof siteDesignSchema>;
export type SourceSnapshot = {
  /** Reuse this workspace's reviewed public copy when its private source is gone. */
  publicationReleaseId?: string;
  id: string;
  name: string;
  format: string;
  body?: string;
  versionId?: string;
  storageKey?: string;
  mime?: string;
  bytes?: number;
  generation?: number;
  version: number;
  settings?: Record<string, unknown>;
};
/** Active formats remain inert in private storage. Publication only promotes
 * recognized inputs into a bounded sanitizer or escaped-text renderer. */
export function publicationFileMime(name: string, mime?: string | null) {
  if (
    /\.svg$/i.test(name) &&
    (!mime ||
      [
        "application/octet-stream",
        "application/xml",
        "text/xml",
        "text/plain",
      ].includes(mime))
  )
    return "image/svg+xml";
  if (
    (!mime || mime === "application/octet-stream") &&
    /\.(txt|md|markdown|tex|csv|tsv|json|xml)$/i.test(name)
  )
    return "text/plain";
  return mime ?? "application/octet-stream";
}
export type SiteSnapshot = {
  config: SiteConfig;
  sources: SourceSnapshot[];
  references: Record<
    string,
    { title: string; authors: string; year?: string; url?: string }
  >;
  createdAt: string;
};
export type SiteRelease = {
  id: string;
  status: "queued" | "building" | "ready" | "failed";
  fingerprint: string;
  created_at: string;
  published_at: string | null;
  error: string | null;
  warnings: string[];
  created_by: string;
  snapshot?: SiteSnapshot;
};
export type SiteDomain = {
  id: string;
  hostname: string;
  token: string;
  verified_at: string | null;
  status: "pending" | "verified";
  error: string | null;
};
export type WorkspaceSite = {
  id: string;
  space_id: string;
  slug: string;
  config: SiteConfig;
  version: number;
  live_release_id: string | null;
  enabled: boolean;
  releases: SiteRelease[];
  domains: SiteDomain[];
  canManage: boolean;
  canEdit: boolean;
  publicUrl: string;
  domainTarget: string | null;
  sourceStatus?: { id: string; available: boolean; version: number }[];
};
export type PublicationFile = {
  path: string;
  storage_key: string;
  mime: string;
  bytes: number;
  sha256: string;
  download: boolean;
};
export const siteTemplates = [
  ["scholar", "Scholar", "A personal academic homepage"],
  ["notebook", "Notebook", "A chronological research blog"],
  ["lab", "Research Lab", "People, research areas and publications"],
  ["journal", "Journal", "Publication-first editorial layout"],
] as const;
export function defaultSiteConfig(
  title: string,
  personal: boolean,
): SiteConfig {
  return siteConfigSchema.parse({
    title,
    identity: personal ? "personal" : "team",
    design: {
      theme: "latex-paper",
      font: "theme",
      template: personal ? "scholar" : "lab",
      sections: [
        { id: crypto.randomUUID(), kind: "intro", title, text: "" },
        {
          id: crypto.randomUUID(),
          kind: "publications",
          title: "Publications",
        },
        { id: crypto.randomUUID(), kind: "posts", title: "From the notebook" },
        {
          id: crypto.randomUUID(),
          kind: "people",
          title: personal ? "About" : "Our people",
        },
      ],
    },
  });
}
export function sourceIds(config: SiteConfig) {
  return [
    ...new Set([
      ...config.entries
        .filter((e) => e.included)
        .flatMap((e) => [e.resourceId, ...(e.coverId ? [e.coverId] : [])]),
      ...config.assetIds,
      ...(config.logoId ? [config.logoId] : []),
    ]),
  ];
}
