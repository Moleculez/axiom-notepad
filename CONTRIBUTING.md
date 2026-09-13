# Contributing to Axiom

Use Node 24 and the committed npm lockfile. Work from the repository root. Do not
seed, reset, migrate experimentally or run mutation tests against another person's
working dataset.

## Layout

```text
apps/web/          Next.js routes, first-party UI and browser adapters
apps/sync/         Single-process collaborative room service
packages/editor/   Canonical-source editing/projection adapters
packages/markdown/ Axiom Markdown parser and renderers
packages/shared/   Server services, authorization, migrations and shared contracts
scripts/dev/       Local setup, fixtures and isolated staging
scripts/build/     Vendored assets, brand/showcase generation and offline manifests
scripts/ops/       Administration, migration, backup, worker and safe cleanup
scripts/verify/    Theme, migration, persistence and integration checks
tests/             Unit, parser fixtures and browser regressions
deploy/            Docker/Compose support and secondary native services
docs/              Current guides, curated assets and dated historical records
```

Three root script shims preserve existing worker/watch and dated staging invocations.
New scripts belong in the directories above; use `npm run staging -- <command>` for
a new isolated local test deployment. Do not move public assets or workspace exports
without tracing runtime import paths.

## Before committing

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run validate:themes
npm run docs:check
```

Build/test deployment separately from an active development build. Browser mutation
tests require an isolated database, attachment root, origin and synchronization port.
See [verification](docs/VERIFICATION.md); a passing unit suite is not browser acceptance.
Record actual results, skipped gates and build identity. Retain failure evidence until
the cause is resolved. Keep private reports, `.env*`, backups and datasets out of Git.

For changes involving the current database sequence, run the non-destructive
fresh/upgrade rehearsal against local PostgreSQL:

```sh
npx tsx scripts/verify/rehearse-current-migrations.ts
```

It creates and retains two uniquely named test databases; it never migrates or
resets the application database from `.env`. The configured local role needs
permission to create databases. This tests schema upgrades, not full backup recovery.

## Documentation and visual assets

Keep README concise and route readers through the [documentation index](docs/README.md).
Update the relevant current guide alongside behavior changes. Preserve dated
evidence as history; label superseded release records instead of presenting their
test totals, ports or dependency decisions as current. The docs checker covers
local Markdown links, reference definitions and HTML image/picture assets; it does
not validate external websites or fragment anchors.

Use [brand criteria](docs/BRANDING.md) and [showcase generation](docs/SHOWCASE.md) for
the shared mark, icons and banners. `npm run brand:build` is deterministic;
`npm run docs:assets` captures a fresh fictional workspace on isolated staging.
Only the reviewed outputs in `docs/assets/` and the public brand folder belong in
Git. Raw screenshots/traces, auth state and capture receipts do not. Check light
and dark artwork visually, including reduced-size readability, before committing.

## Change contracts

- Preserve canonical source, collaborative undo and author attribution. Mode changes
  are view operations, never full-document rewrites. See [editor architecture](docs/EDITOR_VNEXT.md).
- Authorize every server read/write; UI visibility is not access control. Jobs, exports,
  offline copies and previews must use the same resource/space permissions.
- Add forward migrations; never edit an already-applied migration to change its meaning.
  Rehearse upgrades and recovery against a new database and storage destination.
- Keep semantic theme tokens and shared controls. Follow the [theme authoring criteria](docs/THEME_AUTHORING.md)
  for light/dark, typography, focus, reduced motion and accessible contrast.
- Keep optional providers explicit and disabled until configured. Never transmit
  research content as a side effect of simply opening a document.
- Do not claim upstream editor internals are first-party code. Retain third-party
  licenses/notices and document actual dependency boundaries.

No outbound deployment, tag or push is implied by a local commit.
