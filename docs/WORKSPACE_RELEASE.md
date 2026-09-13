# Unified workspace implementation

> Historical September 8, 2026 release record. Navigation and deployment
> checkpoints below are not current operating instructions. Use the
> [workspace guide](WORKSPACE.md), [file-first workbench](FILE_WORKBENCH.md),
> [deployment guide](DEPLOYMENT.md) and [current verification](VERIFICATION.md).

Approved: calm/balanced design, top app navigation, unified Explorer, tabs and split view, account-owned personal work, project-boundary viewer/commenter/editor access, 1 GB resumable uploads, manual completed-file/version cleanup, advanced research project management, and configurable invite-only institutional OIDC.

## Delivery gates

- [x] Design system, primitives, routed shell and navigation
- [x] Central resource authorization and personal-space migration
- [x] Explorer, immutable file versions, streaming/resumable uploads and storage pages
- [x] Document tabs/split view and compatibility with the existing research editor
- [x] Project tasks/calendar/reviews/activity and durable background jobs
- [x] Profiles, people, administration, security and OIDC configuration
- [x] Migration/backup rehearsal, accessibility, browser and durability verification
- [x] Safe production cutover and documented external configuration requirements

Preserve original Markdown/parser, note IDs and Yjs generations/history, legacy attachment bytes/URLs, annotations/citation contexts, account preferences and restore points. No migration runs on the live database before an isolated rehearsal. New project and file features must enforce authorization on the server, including WebSockets and derivatives. Existing private documents must never become group-readable.

## Operational checkpoints

Pre-change verified backup: `data/before-workspace-20260908` (includes a source archive). Production web remains on port 3001; production sync remains on 1234. Isolated development/verification uses web 3002, sync 1235, a separate database and attachment root. Do not overwrite existing backup or restore targets.

Institutional identity is undecided: ship OIDC configuration and mock-provider tests, retain existing login, and do not claim verification against a real university provider. No public sharing, billing, OCR/AI, executable notebooks, SAML/SCIM or Office-suite editing is included.

## Accepted local release — September 8, 2026

All 771 unit tests, 66 Chromium scenarios, 41 Firefox scenarios and 39 supported WebKit scenarios passed; two WebKit offline-reload cases remain explicitly skipped. Crash/failure recovery and streaming backup/restore rehearsals passed. See [the verification record](VERIFICATION.md) for scope and limitations.

The live web and sync processes were gracefully stopped before taking the fresh verified `data/before-workspace-deploy-20260908` database/blob backup. It also contains the matching prior source/build archive, private configuration and migration audit. Migrations 4–7 and their idempotent rerun preserved all 12 notes, 12 document records, 28 snapshots, two attachments, appearance/editor preferences, bibliography and reading records. The original annotation and reference-to-file records were separately compared against the pre-migration dump.

The release runs at `http://localhost:3001`, sync on 1234, with the workspace worker running. Build `EgP_Q6Pud3fvf37rl2m1m` is selected by `AXIOM_DIST_DIR=.next/workspace-release-20260908` in the private local `.env`. The previous default build remains untouched; old hashed assets are retained in the new build. Future local build/start commands read the same release setting, including offline asset generation.

Live sign-in, all principal destinations, the original editor, mode shortcuts and both protected file checksums passed without browser errors or document/preference writes. The smoke-check session was signed out afterward. No live verification fixtures were created. Internet-facing hosting, real institutional OIDC, S3 and SMTP still require target-environment configuration and verification.
