import { z } from "zod";

export const siteAnalyticsSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    publicViews: z.boolean().default(false),
    publicDownloads: z.boolean().default(false),
    publicSiteTotals: z.boolean().default(false),
    googleMeasurementId: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^(?:G-[A-Z0-9]{4,20})?$/,
        "Enter a GA4 measurement ID, such as G-ABC1234567, not a script.",
      )
      .default(""),
  })
  .strict();
export type SiteAnalyticsSettings = z.infer<typeof siteAnalyticsSettingsSchema>;
export type SiteReadingMetadata = {
  words: number;
  readingMinutes: number;
  equations: number;
  codeBlocks: number;
  tables: number;
  outline: { id: string; text: string; level: number }[];
};
export type SiteCatalogEntry = {
  id: string;
  title: string;
  summary: string;
  kind: string;
  path: string;
  tags: string[];
  authorIds: string[];
  date?: string;
  firstPublished?: string;
  reading?: SiteReadingMetadata;
};
export type SiteCatalog = {
  version: 1;
  archive?: { style: "timeline" | "list"; includePages: boolean };
  entries: SiteCatalogEntry[];
  authors: { id: string; name: string }[];
};
export const siteEventSchema = z
  .object({
    releaseId: z.uuid(),
    page: z.string().max(500),
    visitId: z.uuid(),
    // Cumulative monotonic values make retried / out-of-order heartbeats harmless.
    seconds: z.number().int().min(0).max(1800).default(0),
    depth: z.number().int().min(0).max(100).default(0),
    downloads: z.number().int().min(0).max(100).default(0),
    citations: z.number().int().min(0).max(100).default(0),
    outbound: z.number().int().min(0).max(100).default(0),
    referrer: z.string().max(253).default(""),
  })
  .strict();
export type SiteEvent = z.infer<typeof siteEventSchema>;
export type SiteMetrics = {
  views: number;
  engaged: number;
  seconds: number;
  completed: number;
  downloads: number;
  citations: number;
  outbound: number;
};
export const emptySiteMetrics = (): SiteMetrics => ({
  views: 0,
  engaged: 0,
  seconds: 0,
  completed: 0,
  downloads: 0,
  citations: 0,
  outbound: 0,
});
export type SiteAnalyticsReport = {
  settings: SiteAnalyticsSettings;
  settingsVersion: number;
  startedAt: string | null;
  from: string;
  to: string;
  supported: boolean;
  live: boolean;
  current: SiteMetrics;
  previous: SiteMetrics;
  days: ({ day: string } & SiteMetrics)[];
  entries: (SiteCatalogEntry & SiteMetrics)[];
  authors: ({
    id: string;
    name: string;
    entries: number;
    words: number;
  } & SiteMetrics)[];
  referrers: { domain: string; views: number }[];
  publishing: {
    entries: number;
    words: number;
    equations: number;
    tables: number;
    codeBlocks: number;
    topics: { tag: string; entries: number }[];
    cadence: { month: string; entries: number }[];
  };
};
export function normalizedReferrer(value: string) {
  const domain = value.toLowerCase().replace(/\.$/, "");
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    ? domain
    : "";
}
export function siteEventDelta(
  next: SiteEvent,
  prior?: Pick<
    SiteEvent,
    "seconds" | "depth" | "downloads" | "citations" | "outbound"
  >,
): SiteMetrics {
  return {
    views: prior ? 0 : 1,
    engaged: next.seconds >= 10 && (!prior || prior.seconds < 10) ? 1 : 0,
    completed:
      next.depth >= 90 &&
      next.seconds >= 10 &&
      (!prior || prior.depth < 90 || prior.seconds < 10)
        ? 1
        : 0,
    seconds: Math.max(0, next.seconds - (prior?.seconds ?? 0)),
    downloads: Math.max(0, next.downloads - (prior?.downloads ?? 0)),
    citations: Math.max(0, next.citations - (prior?.citations ?? 0)),
    outbound: Math.max(0, next.outbound - (prior?.outbound ?? 0)),
  };
}
