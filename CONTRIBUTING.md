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
packages/mindmap/  Native Markdown hierarchy, guarded source commands, layout and export
packages/shared/   Server services, authorization, migrations and shared contracts
packages/plugin-sdk/ Typed browser extension API (no server execution)
examples/plugins/  First-party extension authoring examples
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
npm run validate:ui
npm run validate:themes
npm run docs:check
```

Build/test deployment separately from an active development build. Browser mutation
tests require an isolated database, attachment root, origin and synchronization port.
See [verification](docs/VERIFICATION.md); a passing unit suite is not browser acceptance.
The [mind-map contract](docs/MINDMAP.md) documents shared production/showcase
bindings, source-preserving moves, bounded exports and its disposable SQL/browser
gates. A presentation view must not create a second collaborative document.
The [reliability runner](docs/RELIABILITY.md) builds and exercises a fresh
authenticated test installation without loading `.env`, then rehearses sync crash
recovery and a real paired database/blob restore. Run `npm run verify:reliability`;
never set a mutation suite's URL to 8080. Bare E2E configs now fail closed without
both an isolated target identity and a matching server health attestation.
Record actual results, skipped gates and build identity. Retain failure evidence until
the cause is resolved. Keep private reports, `.env*`, backups and datasets out of Git.

For Stage 3–4 work, use `npm run verify:stages:acceptance` from a Node 24 local
terminal. The [stage acceptance contract](docs/STAGE_ACCEPTANCE.md) covers all
desktop engines, real worker races, populated recovery and historical same-host
scale measurements. A focused/preflight run or generated screenshot is not full
acceptance; record operator review separately. The coordinator never upgrades or
restarts the working installation.

For Stage 5 file interoperability, use [portable collections](docs/PORTABLE_COLLECTIONS.md)
and `npm run verify:collections:migration`. Import/export and queued extension
expiry tests use the guarded extension profile. Do not migrate working data or
enable third-party gates to obtain a passing test; independent security review
and full desktop acceptance remain separate.

For changes involving the current database sequence, run the non-destructive
fresh/upgrade rehearsal against local PostgreSQL:

```sh
npx tsx scripts/verify/rehearse-current-migrations.ts
```

It creates and retains uniquely named test databases; it never migrates or
resets the application database from `.env`. The configured local role needs
permission to create databases. This tests schema upgrades, not full backup recovery.

Planning Intake mutations have a guarded local API rehearsal and browser suite:

```sh
npx tsx scripts/verify/verify-workspace-planning.ts
npm run plugins:staging -- migrate
npm run plugins:staging -- build
npm run plugins:staging -- web
# In another terminal, with the isolated profile running on 3004:
npm run plugins:staging -- test --config planning.config.ts
```

The browser fixtures use only the fictional extension-staging account and the
`axiom_plugins_test` database. Never point these tests at a real deployment.

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
  The [UI control contract](docs/UI_CONTROLS.md) governs sliders, native
  checkbox/switch semantics, hints/notices, action groups, dialog focus and
  text-scaled geometry. Use the shared components instead of page-local resets.
  Run `validate:ui` and inspect the real Interface specimen in every style.
- Keep optional providers explicit and disabled until configured. Never transmit
  research content as a side effect of simply opening a document.
- Extensions use the [API v1 contract](docs/EXTENSIONS.md): immutable package
  identity, default-off gates, opaque workers, native declarative panels and
  human-reviewed writes. Never import package code into the app/server realm,
  grant same-origin privileges, add unreviewed CSS/HTML or expose native Apply to
  a worker. Run `npm run plugins:staging -- test --config plugins.config.ts` only against
  the guarded isolated profile. Package examples with `npm run plugin:pack`.
- Do not claim upstream editor internals are first-party code. Retain third-party
  licenses/notices and document actual dependency boundaries.

No outbound deployment, tag or push is implied by a local commit.
