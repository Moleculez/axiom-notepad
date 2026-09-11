# Canvas v1, theme packs and clean development first run

Verified September 11, 2026. This is a bounded feature release, not complete
Obsidian/Typora/Google Drive parity or a production deployment.

## Implemented

- Named/tagged cards, search, deep links, research templates, clipboard with fresh
  identities, arrangement/distribution, position locks and snap-to-grid.
- Explicit connection sides and keyboard reconnection; right-to-right routing
  avoids endpoint interiors. Double-click edits cards and never creates new ones.
- Writer-elected smart height independent of zoom; manual resizing opts out.
  Fitting reserves space for the floating dock and selection controls.
- Authorized live/pinned file previews, research Markdown/math, media/PDF/Office,
  static/interactive nested canvases, explicit sandboxed webpage loading.
- Anchored card discussions, including commenters without document-edit access.
- PNG/JPG/SVG/PDF, Markdown, JSON Canvas and portable ZIP exports. Visual SVG keeps
  connections as vectors and embeds raster card content; it is not editable vector
  text. ZIP manifests identify exact assets, revisions, checksums and omissions.
- Paper Research and Technical Slate packs with paired palettes, Interface preview,
  static registration and developer authoring/validation criteria.
- Guarded development reset, recoverable backups, one-time owner/group setup and
  dataset-specific browser cache/outbox protection across tabs.

## Evidence

The production candidate uses Milkdown and build `liwgJarITw5rydn11LOZf` in
`apps/web/.next/canvas-v1-20260911`. It was verified against the isolated database
`axiom_canvas_v1_test_20260911`, storage `data/canvas-v1-test-attachments-20260911`,
web port 3004 and synchronization port 1236.
Those temporary test services were stopped after verification; their database,
storage, build and evidence are retained. The main 8080 development service and
the pre-existing port-3002 staging services were left running.

- TypeScript, ESLint, theme manifest/CSS/contrast validation and production build pass.
- 1,506 unit/conformance tests pass across 53 files.
- Final Chromium platform/Canvas/safety acceptance: **23/23**, no skips or scenario retries.
  Report: `playwright-report/canvas-release-final/index.html`; fresh screenshots,
  downloaded images/PDF and other artifacts: `test-results/canvas-release-final/`.
- Six expanded Canvas feature scenarios pass in Firefox on the same candidate.
  Artifacts: `test-results/canvas-release-firefox/`.
- WebKit's traced repeat passes all six scenarios on the same candidate:
  `test-results/canvas-webkit-diagnostic/`. The preceding run completed its
  interactions but failed its final page-error assertion with two access-control
  diagnostics naming interrupted note-load requests. That original failure is
  preserved in `test-results/canvas-release-webkit/`; its intermittent cause is
  not isolated or claimed fixed. Controlled cancellation probes had no unhandled
  rejections, but do not certify the original navigation race.
- Offline edit/reload/reconciliation also passes three consecutive standalone
  runs: `test-results/canvas-offline-durability/`. The test waits for the durable
  local-save acknowledgment before full navigation; forcibly accepting an unsaved
  changes warning is not a durability guarantee.
- Shared media/text/CSV/XLSX/private Office viewer regression passes separately;
  artifacts: `test-results/canvas-viewers/`.
- Setup fault checks pass: bad token, production guard, stale dataset, failure
  after auth-account creation, password-verified recovery, simultaneous completion,
  one owner/group, consumed token and no seeded notes. Test utility:
  `npx tsx scripts/verify/verify-canvas-bootstrap.ts` (creates only an isolated test DB).

Regression tests exposed and corrected hidden `.DS_Store` files breaking service
worker installation, capture insets producing empty card rasters, dock-obscured
resize handles, stale same-page card links, selection rings overridden by themes,
and fetches starting with already-aborted navigation signals. Additional fixes
cover a missing screen-reader-only utility, document-level reconnect recovery,
premature local-save labels and navigation guards for deletion of all content.
Export acceptance checks pixel opacity/variation per card, not only file signatures.

## Main development reset

Only the main local `axiom` database and its exact `data/attachments` storage were
reset, after gracefully stopping the main services and verifying a fresh backup:

`data/before-development-reset-2026-09-11T01-43-43-501Z/`

The backup includes the database dump and ten verified referenced blobs. The
entire previous attachment directory, including orphaned/staging files, remains
under `retired-development-storage/` there. All 27 other local databases, their
storage, existing backups, source code and `.env` were preserved.

Migration 18 is applied. Main development services are running on **8080/1234**.
Post-reset checks find zero users/groups/notes/resources/attachments and empty
active storage. No replacement owner or demo data was created. The one-time token
file is `data/development-setup-token.txt`, mode `0600`; enter it in the first-run
form and choose your own account/group. Do not run `seed` on this instance.

Fresh main-instance smoke: HTTP 200, setup required, five input fields and no
browser page errors. Screenshots and timestamped evidence are in
`test-results/development-first-run/`. See [recovery instructions](DEVELOPMENT_RESET.md).

## Remaining release checks and limits

Physical OS IME, real system clipboard permissions, assistive technology, dense
maximum-size boards and physical Safari are not certified by these automated
tests. The intermittent WebKit navigation diagnostic above remains a release
check. Review theme states at large UI scales/forced colors on target machines.
Office conversion still requires the administrator-configured private converter;
remote websites may refuse embedding. Export bounds and nested-preview limits are
documented in [Canvas architecture](CANVAS_ARCHITECTURE.md). Arbitrary user CSS,
group background images and a complete portable-bundle round-trip importer are
not part of this implementation.
