import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { z } from "zod";
import { HttpError } from "./access";
import { siteConfigSchema, siteEntrySchema, type SiteSnapshot } from "./sites";
import { homeBody, publicMarkdown, siteDocument } from "./site-render";

const specimen = `# Abstract
Clear typography makes complex ideas easier to follow. This specimen uses the same renderer, mathematics and styles as your published website.

## A simple model
For a state $x$, a useful energy function is

$$
E(x)=\\frac{1}{2}x^\\top A x - b^\\top x.
$$

### Interpretation
An elegant argument should remain readable on screen and on paper.[^margin]

> A good model reveals structure without hiding uncertainty.

## Results
| Method | Error | Iterations |
| :--- | ---: | ---: |
| Baseline | 0.042 | 120 |
| Proposed | 0.018 | 64 |

### Reproducibility
\`\`\`python
def energy(x, A, b):
    return 0.5 * x @ A @ x - b @ x
\`\`\`

## Discussion
Read the evidence, compare the assumptions, and build on what is reproducible. The archive and topic pages help connect these ideas to earlier work.

[^margin]: Footnotes become margin notes in the Tufte theme on sufficiently wide screens. On smaller screens and in print, the original notes remain available.
`;
export async function designPreview(request: Request, spaceId: string) {
  const input = z
    .object({ config: siteConfigSchema, view: z.enum(["home", "article"]) })
    .parse(await request.json());
  // Only an explicit draft and a fixed specimen: never read private source files.
  const config = { ...input.config, logoId: null };
  const entry = siteEntrySchema.parse({
    id: "20000000-0000-4000-8000-000000000001",
    resourceId: "20000000-0000-4000-8000-000000000002",
    title: "On clarity, structure and discovery",
    slug: "specimen",
    kind: "paper",
    included: true,
    summary: "A research reading specimen for your website’s visual language.",
    tags: ["Research", "Mathematics"],
    authorIds: config.authors.slice(0, 2).map((a) => a.id),
    date: "2026-09-28",
  });
  const snapshot: SiteSnapshot = {
    config: input.view === "article" ? { ...config, entries: [entry] } : config,
    createdAt: "2026-09-28T00:00:00Z",
    sources: [
      {
        id: entry.resourceId,
        name: "Specimen",
        format: "markdown",
        version: 1,
        body: specimen,
      },
    ],
    references: {},
  };
  const context = {
    snapshot,
    assets: new Map<string, string>(),
    warnings: new Set<string>(),
  };
  const body =
    input.view === "home"
      ? await homeBody(context)
      : await publicMarkdown(specimen, "index.html", context);
  const assetBase = `/api/v1/spaces/${spaceId}/site/design-assets/`;
  return siteDocument(
    snapshot,
    "index.html",
    input.view === "home" ? config.title : entry.title,
    body,
    input.view === "article" ? entry : undefined,
  )
    .replaceAll('="_site/', `="${assetBase}`)
    .replace("<!--axiom:runtime-->", "")
    .replace(
      "</head>",
      "<style>.site-header nav a,.site-identity,.site-tags a,.article-authors a,.site-post-navigation a,.site-footer a,.publication-list a,.site-people a{pointer-events:none}</style></head>",
    );
}
export async function designAsset(parts: string[]) {
  const path = parts.join("/");
  if (!/^(?:chunks\/)?[a-zA-Z0-9_.-]+\.(?:css|js|woff2)$/.test(path))
    throw new HttpError(404, "Preview asset not found.");
  const mime = {
    ".css": "text/css",
    ".js": "text/javascript",
    ".woff2": "font/woff2",
  }[extname(path)]!;
  try {
    return new Response(
      new Uint8Array(await readFile(resolve("apps/publish/dist", path))),
      {
        headers: {
          "content-type": mime,
          "cache-control": "private, no-cache",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch {
    throw new HttpError(
      404,
      "Run npm run publish:assets to prepare design previews.",
    );
  }
}
