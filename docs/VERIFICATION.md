# Current verification and beta release gates

Updated September 14, 2026. Historical logs are [archived separately](archive/VERIFICATION-2026-09-11.md).
Do not treat historical browser totals or local build IDs as current release evidence.

## September 13–14 documentation and identity release review

This review preserves the working development dataset and port-8080 service.
Mutation tests and fictional showcase capture use a separate local PostgreSQL
database, attachment store and production-build profile on ports **3004/1236**.
The local checks use Node **22.17.0** and npm **11.18.0**; Node 24 remains the
recommended runtime and Docker image target. No public deployment or push was run.

- **1,685 unit tests across 68 files pass**, including shared SVG geometry,
  maskable-icon pixel bounds and 12 documentation-link parser cases.
- TypeScript, ESLint, both theme-pack validators, formatting/diff checks and the
  isolated production build pass. The final build prepares **685 offline assets**.
  Documentation checks cover 42 Markdown guides plus local HTML image/picture
  references and npm script paths; external URLs and fragment anchors are not checked.
- **57 product browser scenarios pass** during the pre-branding review: 30
  file-first/reading-mark/settings/viewer scenarios, five editor-vNext scenarios,
  nine management/productivity API scenarios and all 13 Canvas-platform scenarios.
  This includes collaboration/offline convergence, discussions, create/join group
  flows, workspace lifecycle, Trash, native-file creation and Canvas interactions.
- **Nine branding scenarios pass** on the final candidate, three each in Chromium,
  Firefox and WebKit: auth/workspace identity, light/dark geometry, named controls,
  focus, forced colors, unchanged source, versioned favicon/PNG routes, Apple icon,
  manifest shortcuts and the public social-image asset. The five editor-vNext
  scenarios also pass again after the visual rollout. These reruns are not added
  to the product total a second time.
- Fresh initialization and **18 → 20 upgrade rehearsals pass**, including an
  idempotent migration rerun, retained note/Yjs state and legacy discussion data.
  `scripts/verify/rehearse-current-migrations.ts` creates two new named test
  databases and retains them for inspection; it never migrates the configured
  application database. This is not a full backup/restore or Docker rehearsal.
- Real light/dark editor and Canvas views were captured from fictional content.
  The 1600 × 900 banners, 1200 × 630 social preview and original SVG/PNG logo were
  visually inspected. Assets, source composition and reproducible capture commands
  are in [Showcase](SHOWCASE.md) and [Branding](BRANDING.md).

Private evidence directories are `test-results/release-docs-product-baseline`,
`release-docs-editor-baseline`, `release-docs-management-verified`,
`release-docs-canvas-verified` and `release-docs-final-{chromium,firefox,webkit}`,
all under `test-results/`.
The first product invocation omitted the editor suite's explicit vNext environment
flag, so its preflight failed and four cases were skipped; the separate five-case
rerun passes. Stale management/Canvas test navigation was updated to the current
shared creation dialog and persistent sidebar, then rerun successfully. Earlier
failed harness reports remain retained and are not counted as passing suites.

The cross-browser branding checks do **not** clear the older WebKit navigation
access-control diagnostic below. Physical IME/clipboard, Safari device behavior,
assistive technology, printing, large real workloads and configured external
providers still require target-environment acceptance. The September 11 Docker
rehearsal below is historical, not repeated by this documentation release.

## September 13 note-link icon alignment

- Note icons share the label's font box instead of using a fixed top offset.
  They remain attached to the first line of wrapped aliases; bounded icon ink
  prevents WebKit from painting bars above/below its inline mask.
- **12 production browser scenarios pass** (four each in Chromium, Firefox and
  WebKit), including measured Write/Read alignment for Source Sans 3, Source Serif
  4 and Latin Modern at 14/18/30 px and line heights 1.3/1.75/2.4. Existing theme,
  navigation, source-safety, focus, forced-color and print checks also pass.
  Fresh screenshots are under `test-results/note-link-alignment-production-chromium`,
  `test-results/note-link-alignment-production-firefox` and
  `test-results/note-link-alignment-production-webkit`.
- **742 targeted Markdown/projection unit tests**, TypeScript, ESLint and the
  isolated production build pass. The existing development service on port 8080
  serves the corrected CSS; no editor-source or dependency change was needed.

## September 13 note-link appearance

- Internal `[[note links]]` now share a decorative note icon, accent tint and
  underline in Write/Read. Unresolved links use a dashed underline and an escaped
  descriptive title. Long labels wrap, zero radius remains square, keyboard focus
  stays visible without a doubled ring, and print omits decoration.
- **Nine production browser scenarios pass** (three each in Chromium, Firefox
  and WebKit), covering light/dark appearance, typography, wrapping, hover,
  keyboard/modifier navigation, continued editing, forced colors, reduced motion
  and print. Fresh screenshots are in `test-results/note-link-styles-verified-chromium`,
  `test-results/note-link-styles-verified-firefox` and
  `test-results/note-link-styles-verified-webkit`.
- **1,670 unit tests in 66 files**, TypeScript, ESLint, formatting/documentation
  checks and the isolated production build pass (681 offline assets). No
  dependency, migration or source-format change is required; port 8080 is retained.

## September 13 minimap marker alignment correction

- Cursor/search markers now use measured text-row positions and the same scale
  and scroll offset as the miniature. Single markers no longer snap to arbitrary
  eight-pixel coordinates; offscreen Proportional-mode markers are clipped with
  their content. Position measurements are cached independently of scrolling,
  and folded blocks stay folded.
- **19 Chromium production minimap checks pass**, including seven new alignment
  scenarios and both large-document benchmarks. The seven new scenarios also
  pass in **Firefox and WebKit**. Coverage measures actual caret/search geometry
  in Write/Source with Fit/Fill/Proportional sizing, horizontal movement, wrapped
  lines, scrolling, typing, resizing, embedded code/math and folded code.
- **Four existing Chromium regressions pass** for rich/source offline
  convergence, source-anchored discussions, bookmark operations and nested
  reading-mark targets. **1,668 unit tests in 66 files**, TypeScript, ESLint,
  formatting checks and the isolated production build pass (681 offline assets).
- Fresh screenshots and benchmark evidence are under
  `test-results/minimap-marker-production-chromium`,
  `test-results/minimap-marker-production-firefox`,
  `test-results/minimap-marker-production-webkit` and
  `test-results/minimap-marker-production-regression`. Synthetic median input
  timings are **7.7 → 23.0 ms** (10k source lines) and **10.9 → 12.0 ms** (50k);
  both satisfy the existing bounded-overhead check. These are automated desktop
  checks, not physical IME/clipboard certification. No migration or reset was
  required, and the user's existing development service on port 8080 is retained.

## September 13 viewer fullscreen correction

- The fullscreen button previously targeted the native dialog, which is an
  [incompatible fullscreen element](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen#compatible_elements).
  It now targets an inner shell containing the title, close action and viewer
  controls. Only this viewer's fullscreen session is tracked and cleaned up.
- Unsupported or denied native requests expand the viewer to the browser window.
  Escape restores the normal view before closing it; the close action also exits
  fullscreen. Existing source content and annotation state are retained.
- **15 Chromium production scenarios pass** (14 viewer workflows plus sharing
  dialog regression), together with **four Firefox and four WebKit fullscreen
  scenarios**. Tests exercise images/Mermaid, valid native targets when available,
  viewport geometry, visible controls, zoom, exit/re-entry, Escape, close cleanup,
  and explicitly unavailable/rejected fullscreen APIs. Earlier viewer totals did
  not exercise this button and are not evidence of the previous implementation.
- **1,663 unit tests**, TypeScript, ESLint and the production build pass (681
  offline assets). Fresh images/traces are in
  `test-results/visual-fullscreen-production-chromium`,
  `test-results/visual-fullscreen-production-firefox` and
  `test-results/visual-fullscreen-production-webkit`. These are automated desktop
  checks, not OS-level shortcut certification. No migration or reset was needed;
  the existing development service on port 8080 is preserved.

## September 13 image and Mermaid viewer

- **1,663 unit tests in 66 files**, TypeScript, ESLint, both theme packs and the
  isolated production build pass (681 offline build assets). Documentation checks
  resolve 171 local references across 40 documents; `git diff --check` passes.
- **10 Chromium, 10 Firefox and 10 WebKit viewer workflows pass** against the
  current production candidate. Coverage includes Write/Read image and Mermaid
  opening, source-safe context menus, Alt+Enter, cursor return, intrinsic zoom,
  initially linked/relinked comparison and Fit, metadata decoding, PNG/SVG export,
  vector markup, placement isolation, private/shared ACLs, reply ownership,
  moderation, optimistic conflicts, offline editing and replay after closing,
  rich annotation bodies, undo/redo, canvas card identity, stored images and
  access revalidation after trashing a file.
- **16 existing Chromium regressions pass**, covering collaboration/offline
  convergence, source-backed discussions, stable equations, quoted equations and
  export, bookmarks/annotation cards, permissions, conflicts, floating-card
  appearance and sharing-dialog keys. Evidence is under
  `test-results/visual-viewer-regression-verified`.
- These checks caught and fixed duplicate rich-editor keys, an initial no-op
  annotation write that could interfere with sharing, privacy changes hidden by
  a stale local revision, atom-focus keyboard navigation, unlinked initial
  comparison transforms, and page-unload read lifetimes. Read cancellation is
  separately tested not to interrupt writes or block a canceled navigation.
- Fresh screenshots/traces are under `test-results/visual-viewer-chromium-verified`,
  `test-results/visual-viewer-firefox-verified` and
  `test-results/visual-viewer-webkit-verified`. Light/dark views, comparison,
  Mermaid export and annotation inspectors were visually reviewed; square corners,
  disabled shadows, horizontal containment and the fixed footer are checked.
- Additive migration **20** is applied to staging and local development without a
  data reset. The existing port-8080 development service remains running. This is
  not a public deployment, mobile redesign, physical clipboard/IME or
  assistive-technology certification. The older WebKit permission-change
  `sync-token` diagnostic below is not superseded by these viewer-only checks.

See [the viewer contract](VISUAL_VIEWER.md) for controls, metadata privacy,
non-destructive exports, annotation recovery and implementation limits.

## September 13 document minimap

- **1,635 unit tests in 65 files**, TypeScript, ESLint, both theme packs and the
  isolated production build pass (675 offline build assets). The minimap adds no
  editor dependency or SQL migration; appearance preferences advance to schema 8.
- **12 Chromium minimap checks pass**, plus a final targeted invalid-width
  recovery rerun. **10 Firefox and 10 WebKit minimap workflows pass**. Coverage
  includes opt-in behavior, Write/Source/Read, live settings preview/cancel/reset,
  account persistence and offline recovery, schema-7 stale-writer protection,
  click/drag/wheel/keyboard navigation, rapid End/Enter, mapped-selection focus
  restoration, live equation editors, folds, side changes, compact panes, print
  exclusion, tab cleanup, search/presence and private/shared annotation markers.
- **17 existing Chromium editor/reading-mark/Appearance regressions pass**,
  including actual two-client/offline convergence, anchored discussions, quoted
  equations and export, bookmark/annotation operations, permissions, privacy,
  conflict handling, folding and fixed-footer geometry.
- Source benchmarks use 10,000 and 50,000 short ASCII payload lines, a 1440×1000
  desktop viewport, and synthetic `beforeinput` → next-animation-frame timings.
  Recorded median baseline → enabled times are **10.0 → 21.7 ms** (10k) and
  **10.8 → 10.6 ms** (50k). Both meet the test's bounded-overhead threshold;
  lower timings in one run are noise, not evidence of a speedup. Both use a
  **120×814** canvas. Fit-map scrolling does not repaint the bitmap; geometry
  measurement checks pass. This is not a universal latency guarantee for every
  Markdown structure, machine, input method or document size.
- Fresh screenshots and JSON benchmark reports are under
  `test-results/minimap-desktop-final`. Final width recovery is under
  `test-results/minimap-width-recovery-final`; cross-browser evidence is under
  `test-results/minimap-firefox-final` and `test-results/minimap-webkit-final`.
  Existing-editor evidence is under `test-results/minimap-regression-final`.
  Light/dark views and the settings scratchpad were visually reviewed, including
  square corners, no shadows and a compact desktop pane.
- These are isolated desktop checks, not a new deployment, mobile redesign,
  physical IME/clipboard or assistive-technology certification. The earlier
  WebKit permission-change diagnostic below is not closed by the minimap suite.
  The normal development service on port 8080 is preserved.

See [the minimap contract](MINIMAP.md) for controls, privacy, density limits,
rendering architecture and theme-authoring boundaries.

## September 13 reading marks and annotation cards

- **1,621 unit tests in 64 files**, TypeScript, ESLint, both theme packs and the
  isolated production build pass (672 offline build assets). Documentation checks
  resolve 156 local references across 38 documents; `git diff --check` passes.
- **18 Chromium checks pass**: 17 editor/reading-mark/Appearance scenarios and one
  MCP authorization workflow. Coverage includes bookmark edit/delete/Undo, robust
  anchors and reattachment, nested/folded targets, private drafts, tab switching,
  read-only private authoring, sharing/replies/tombstones, offline edits/deletion
  before first acknowledgement, conflict recovery without accidental publication,
  route-variant privacy and MCP private-thread isolation. Existing shared editing,
  source-anchored discussions and dark/enlarged layout checks remain green.
- **Nine Firefox reading-mark workflows pass. Eight of nine WebKit workflows
  pass.** WebKit completes the read-only/private-sharing assertions but fails the
  accumulated page-error assertion on a `sync-token` access-control diagnostic
  during the permission-change reload. Editor-lifecycle request cancellation did
  not eliminate it; it remains a browser release gate, not passing acceptance.
- Fresh screenshots and traces are in `test-results/reading-marks-production-final`,
  `test-results/reading-marks-firefox-final`, `test-results/reading-marks-webkit-final`
  and `test-results/reading-marks-mcp-final`. Dark floating cards were visually
  reviewed with square corners and shadows disabled, including math/code bodies,
  visible actions and viewport containment.
- Additive migration **19** was applied to the isolated staging database and the
  local development database without resetting data. The existing development
  service on port 8080 remains running. This is scoped desktop verification, not
  a new public deployment or physical IME/assistive-technology certification.

See [the reading marks contract](READING_MARKS.md) for usage, privacy, recovery
limits and migration instructions.

## September 13 folding-gutter follow-up

- **1,610 unit tests in 63 files**, TypeScript, ESLint, theme validation and the
  isolated production build pass. Folding adds no Monaco runtime dependency.
- **400 Chromium editor-lab checks pass**, with the opt-in benchmark skipped,
  plus **76 focused Firefox/WebKit checks**. A **54-case three-engine focused
  rerun** passes after final control-order/geometry and caret-boundary fixes.
  This covers collapsed projection
  mapping, nested/footnote folds, local history and source invariance, peer edits,
  navigation, permissions, hover/keyboard focus and print lifecycle restoration.
  Folding the only/last block and backward range replacement are checked without
  invalid text-selection warnings.
- **Three full-app Chromium checks pass** for guide preferences, light/dark/large
  metadata geometry and real two-client editing while one client's code stays
  folded. Fresh screenshots: `test-results/editor-folding-current`; editor runs:
  `data/editor-folding-chromium-final`, `data/editor-folding-cross-browser`, and
  `data/editor-folding-caret`. This is not physical IME/printing certification.

## September 13 block-editing follow-up

- **1,599 unit tests in 62 files**, TypeScript, ESLint, both theme packs, documentation
  links and the isolated production build pass (669 offline build assets).
- **382 Chromium editor-lab checks pass**, with the opt-in benchmark skipped.
  **158 focused Firefox/WebKit checks pass**, with two Chromium-only CDP composition
  cases skipped. Coverage includes list triggers/nesting, empty-block Backspace,
  parent-aware separators, peer edits, undo, permissions, LF/CRLF, metadata and
  view-only range guides. Screenshots are in `data/editor-lab-results` and
  `data/editor-lab-boundaries-cross-browser`.
- **10 full-app Chromium checks pass** against an isolated production server on
  port 3004: guide preference preview/cancel/reset/reload, stale schema protection,
  metadata light/dark/large-type geometry, retained Settings drafts, offline
  preference convergence and interface layout. Evidence is in
  `test-results/block-editing-acceptance`. The narrow/mobile scenario was excluded;
  no new mobile acceptance is claimed.
- These are scoped editor/settings checks, not a fresh deployment rehearsal or
  physical-input certification. See [the editor contract](EDITOR_VNEXT.md) and the
  remaining target-device gates below. Development data was not reset for testing.

## September 11 release preparation (earlier evidence)

- Generated cleanup safeguards pass unit tests. The reviewed cleanup removed 94
  obsolete builds/cache targets (28.62 GiB logical bytes); current services, private
  data, backups and all test evidence were retained.
- Vitest is pinned to 4.1.11. The dependency audit after the update reports no known
  vulnerabilities; this is not a security certification.
- Development and production defaults now select the same current Axiom editor.
  The dependency boundary and explicit legacy rollback are documented in
  [editor architecture](EDITOR_VNEXT.md).
- TypeScript, ESLint, all **1,529 tests in 56 files**, both reviewed theme packs and
  the local documentation/npm-script link checks pass. A production build with 643
  offline assets succeeds. Build workers now exclude database/provider credentials
  and disable eager OAuth registration during compilation.
- Fresh isolated browser checks pass **23 Chromium** scenarios covering Canvas,
  Explorer, collaboration, MCP, offline/recovery and themes, plus **6 Firefox** Canvas
  scenarios. Screenshots/traces are in `test-results/beta-release-current` and
  `test-results/beta-release-firefox`, with corresponding HTML reports.
- The fresh **WebKit run passes 5 of 6**, then fails the accumulated page-error check
  on the same navigation access-control diagnostic. The failure is retained in
  `test-results/beta-release-webkit`; it is not counted as passing acceptance.
- The fresh isolated Docker Compose rehearsal passes on Docker Desktop: Node 24,
  PostgreSQL 16 and Caddy HTTPS; first owner and invitation/join; two-browser editing;
  upload/checksum/preview; Canvas; Trash restore/purge; background export; restart
  persistence; and backup verification/restoration into a separate database and
  storage volume. Restored canonical note/Canvas content and every stored blob
  checksum match. The private receipt is
  `data/deployment-rehearsal-sxggrC/receipt.json`; fresh browser evidence is under
  `test-results/deployment-current/workflow` and `test-results/deployment-current/restart`.
  Earlier failed harness attempts remain alongside them and are not passing evidence.
  This is a local container rehearsal, not acceptance on a public Linux host.

## Reproduce checks

```sh
npm run typecheck
npm run lint
npm test
npm run validate:themes
npm run docs:check
AXIOM_DIST_DIR=.next/release-candidate npm run build
```

The isolated local staging helper supports `init`, `migrate`, `admin`, `build`, `web`,
`sync` and `worker`. Its default database is `axiom_release_test`, web port 3004, sync
1236 and private storage `data/release-test-attachments`; use separate terminals for
long-running services. It refuses the configured live database and remote PostgreSQL.
Production rehearsal uses fresh, separately named Compose resources, never `.local-db`.
Run `npm run test:deployment` with Docker available and localhost ports 8181/8443 free;
see [the isolation and cleanup contract](DEPLOYMENT.md#isolated-deployment-rehearsal).

Existing browser suites may enforce a specific isolated origin. The historical
root staging wrappers preserve those profiles, but new work should use the shared
runner. Test owner credentials can be supplied with `TEST_OWNER_EMAIL` and
`TEST_OWNER_PASSWORD`; do not seed the main instance to satisfy older tests.

For the current editor and branding checks, with isolated staging already running:

```sh
TEST_APP_URL=http://localhost:3004 NEXT_PUBLIC_AXIOM_EDITOR_ENGINE=milkdown \
  npx playwright test tests/e2e/editor-vnext.spec.ts tests/e2e/branding.spec.ts
# Repeat branding with TEST_BROWSER=firefox and TEST_BROWSER=webkit.
npx tsx scripts/verify/rehearse-current-migrations.ts
```

The migration rehearsal needs a local PostgreSQL role with database-creation
permission. Its new databases are deliberately retained, not silently dropped.
For artwork generation, use the separate [showcase workflow](SHOWCASE.md).

## Required operator acceptance

- Fresh migration, first owner, invitation/join and permission boundaries.
- Two-browser editing, acknowledged persistence, restart and offline recovery.
- Upload/checksum/download/preview, completed background export, Trash restore and
  protected permanent deletion, workspace/group administration, Canvas persistence.
- Backup verification and restoration into a different database and storage root.
- HTTPS origin/cookies/WebSockets, no public internal APIs, no development secrets or
  data in images, persistent volumes, least-privilege database account.

## Still not certified

Physical OS IME and cross-application clipboard, physical Safari, assistive technology,
native printing and dense mixed-research workload performance need target-device
acceptance. Real SMTP, S3, institutional OIDC, OCR/AI and Office-provider behavior need
their configured environment. Multi-host sync, a Canvas portable-ZIP importer and
arbitrary user CSS are not delivered by this release preparation.

The earlier Canvas WebKit run had an intermittent navigation access-control diagnostic;
the traced repeat passed. The original failure and repeat traces remain private under
`test-results/canvas-release-webkit` and `test-results/canvas-webkit-diagnostic`.
Its root cause is not proven, and cleanup does not relabel it fixed. Complete Typora
parity and unrestricted production readiness are not claimed.
