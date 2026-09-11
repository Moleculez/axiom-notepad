# Current verification and beta release gates

September 11, 2026. Historical logs are [archived separately](archive/VERIFICATION-2026-09-11.md).
Do not treat historical browser totals or local build IDs as current release evidence.

## Release preparation

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
