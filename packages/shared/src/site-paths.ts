import { posix } from "node:path";
import { createHash } from "node:crypto";
import type { SiteEntry } from "./sites";

export const SITE_ORIGIN = "https://axiom-publication.invalid";
export const publicKey = (id: string) => id.replaceAll("-", "");
export const resourcePath = (id: string) =>
  `resources/${publicKey(id)}/index.html`;
export const tagPath = (tag: string) =>
  `tags/${
    tag
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "topic"
  }-${createHash("sha256").update(tag).digest("hex").slice(0, 10)}/index.html`;
export const entryPath = (entry: Pick<SiteEntry, "kind" | "slug">) =>
  `${entry.kind === "page" ? "pages" : entry.kind === "post" ? "posts" : entry.kind === "paper" ? "papers" : "research"}/${entry.slug}/index.html`;
export const relativePath = (from: string, to: string) =>
  (posix.relative(posix.dirname(from), to) || "index.html").replace(
    /index\.html$/,
    "",
  ) || "./";
export const fileRelative = (from: string, to: string) =>
  posix.relative(posix.dirname(from), to) || posix.basename(to);
