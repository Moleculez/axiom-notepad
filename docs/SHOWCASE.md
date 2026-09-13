# Product showcase and asset workflow

The README shows Axiom's real editor and Canvas, captured from a fictional
**Spectral Lab** workspace. Mira Chen, Elias Ray, their notes and annotations are
demonstration content. The screenshots are not imported mockups or evidence of
complete third-party app parity. Current verification lives in [Verification](VERIFICATION.md).

## Ready-to-use assets

| Asset                                                                                                                                | Size        | Purpose                                     |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------- |
| [Light banner](assets/showcase/banner-light.png) / [dark banner](assets/showcase/banner-dark.png)                                    | 1600 × 900  | README and product presentation             |
| [Social preview](assets/showcase/social-preview.png)                                                                                 | 1200 × 630  | Neutral public link preview                 |
| [Light editor](assets/showcase/editor-light.png) / [dark editor](assets/showcase/editor-dark.png)                                    | 1600 × 1040 | Actual equation-rich note and annotation UI |
| [Light Canvas](assets/showcase/canvas-light.png) / [dark Canvas](assets/showcase/canvas-dark.png)                                    | 1600 × 1040 | Actual connected cards and file evidence    |
| [Ink logo](assets/brand/mark-ink.svg) / [reversed logo](assets/brand/mark-paper.svg) / [mineral logo](assets/brand/mark-mineral.svg) | Vector      | Original shared mark                        |

![Axiom light demonstration banner](assets/showcase/banner-light.png)

The README's `picture` element selects a separately captured dark banner, not a
color filter over a light screenshot. The public social image is a copy of the
reviewed 1200 × 630 asset, available at `/brand/social-preview.png`. It is ready
for a repository's social-preview setting or a deployment-specific landing page;
this workflow does not update external repository settings or generate private
note previews. No deployment hostname is baked into the artwork.

## Regenerate from isolated staging

Use Node 24, the committed lockfile, local PostgreSQL and Playwright Chromium.
Run from the repository root. The capture script only accepts
`http://localhost:3004`, refuses production mode and creates a new demonstration
group on each run. Start that endpoint with the guarded staging runner, not a
working instance with its port changed. No development reset or seed is required.

```sh
npm ci
npx playwright install chromium
npm run brand:build
npm run staging -- init
```

On a **new** staging database, create a separate owner once. Record the generated
password locally; do not commit it or use a working research account:

```sh
npm run staging -- admin --email showcase-owner@axiom.test --name "Showcase owner"
```

Build while that staging web service is stopped:

```sh
npm run staging -- build
```

Start each process in its own terminal:

```sh
npm run staging -- sync
npm run staging -- worker
npm run staging -- web
```

The defaults are a separate `axiom_release_test` database, attachment store under
`data/release-test-attachments`, `.next/release-test` build and ports 3004/1236.
They do not replace development on 8080. Do not override these to point to live
data. Export `TEST_OWNER_EMAIL` and `TEST_OWNER_PASSWORD` for the staging owner in
your local shell, then run:

```sh
npm run docs:assets
npm run docs:check
```

The generator signs in, creates two fictional collaborators, two notes and a
four-card Canvas, waits for server-confirmed saves and rendered math, then captures
light and dark views. It checks that note source remains unchanged and that the
captured page reports no uncaught errors. A local receipt is retained at
`data/documentation-showcase/latest.json`; fixture accounts, identifiers and
credentials must stay out of documentation and Git. Repeated captures add new
staging content instead of resetting or deleting prior fixtures.

## Composition and review

[The editable banner layout](assets/banner.html) composes the raw screenshots in
HTML/CSS. It loads installed Inter fonts locally, uses the shared SVG logo and
has light, dark and social layouts. `scripts/build/docs-assets.ts` renders it with
Playwright; no image-generation service or external font request is involved.
Geometry/icon regeneration is deterministic. Browser captures can vary slightly
with font rasterization, browser version and asynchronous interface state.

Before committing a recapture:

1. Inspect both themes and the smaller social image at actual and reduced sizes.
   Confirm equations, text, annotation cards and Canvas connections are readable.
2. Keep the fictional-demonstration caption. Remove sensitive names, paths,
   credentials, private content and browser chrome by fixing the fixture/capture,
   not by hiding an accidental leak beneath an overlay.
3. Show only controls and capabilities present in the captured application.
   Do not redraw UI to imply unfinished functionality.
4. Keep each PNG below 600 KB where practical; this set is roughly 1.8 MB before
   the public social copy. Avoid committing raw traces or duplicate test galleries.
5. Run docs checks and inspect the image paths in the README. The checker validates
   both `img src` and `source srcset`; GitHub's theme selection is progressive enhancement.

App icons, maskable safe zones, color usage and versioned PWA updates are governed
by [Branding](BRANDING.md). Font and dependency notices remain in their existing
locations. This workflow adds no application or asset license grant.
