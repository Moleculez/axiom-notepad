# Axiom

A self-hosted research workspace for groups in AI, mathematics, physics and STEM.
Collaborative notes, files and research tools, without billing or commerce.
This release targets a **controlled research-group beta**, not complete Typora,
Google Drive or Photoshop parity.

Axiom's customized editor preserves canonical Markdown across visual/source editing.
It owns its parser, source transactions, block interactions and UI, and uses
Milkdown/ProseMirror and CodeMirror as underlying editing libraries. The current Axiom
editor is the default in both development and production. The older native engine is
an explicit rollback path—not a second user-facing product. See [the architecture and
exact dependency boundary](docs/EDITOR_VNEXT.md).

## Start locally

Use Node.js 24 (Node 22.17 is also supported for development) and npm.

```sh
npm ci
npm run setup
npm run db:local
```

Leave PostgreSQL running. In another terminal:

```sh
npm run db:migrate
npm run admin
npm run dev
```

Open **http://localhost:8080**. `setup` preserves an existing `.env`; `admin`
creates the first owner/group without demo content. For a fresh installation,
choose your own credentials. Use invitation links to add colleagues.

If this checkout has already been explicitly reset, do not rerun admin/seed: use the
one-time local first-run flow described in [development reset and recovery](docs/DEVELOPMENT_RESET.md).
Never reset, seed or run browser mutation suites against your working research data.

The development web, sync and worker processes start together. Keep `PORT`,
`APP_URL` and `BETTER_AUTH_URL` consistent when changing ports. Do not interchange
`localhost` and `127.0.0.1`: cookie and origin boundaries are intentional.
Development output uses `.next/dev-8080`, separate from `AXIOM_DIST_DIR` production
builds. Editor rollback requires an explicit `NEXT_PUBLIC_AXIOM_EDITOR_ENGINE=native`
and a new build.

## Included workflows

- Research writing: collaborative Markdown, rich/source/read modes, math/chemistry,
  tables/code, nested quotes/lists, footnotes, citations, Mermaid, outline,
  anchored discussions, versions, local persistence and server-confirmed saves.
- Workspace and file management: resource tabs, list/grid Explorer, folders,
  drag/move/copy, selection menus, immutable versions, resumable uploads,
  protected previews, Audit, workspace administration and guarded Trash recovery.
- Groups and accounts: invitations, administrative/content roles, profiles/avatars,
  membership and ownership flows, sessions, password MFA/recovery and optional
  explicitly linked institutional identity.
- File-specific views: Math Studio, layered Image Studio, Text Studio, shared media/text/
  CSV/XLSX/PDF viewers, reading annotations, reference libraries and task/review workflows.
- [Reading marks](docs/READING_MARKS.md): editable bookmarks, right-margin navigation,
  private-first Markdown/math annotation cards, offline drafts and shared discussion.
- [Document minimap](docs/MINIMAP.md): opt-in visual/source miniatures, scroll-only
  navigation, unified research markers and configurable appearance with live preview.
- [Image/Mermaid viewer](docs/VISUAL_VIEWER.md): intrinsic zoom, comparison,
  metadata, figure inspection, exports and private-first placement annotations.
- Canvas: collaborative rich-text and file cards, names/tags, side-aware connections,
  positioning/alignment, locks/automatic height, protected previews, card discussions
  and PNG/JPG/SVG/PDF/Markdown/JSON Canvas/portable ZIP exports.
- Personal appearance: semantic light/dark palettes, reviewed Paper Research and
  Technical Slate packs, typography/layout controls, account/device overrides,
  theme import/export and live writing/interface previews.
- Integration and offline work: scoped OAuth/MCP access, installable PWA shell,
  explicitly selected offline content, reconnect/recovery controls and exports.
  Provider-assisted OCR/AI and private Office conversion stay disabled until configured.

See the [documentation index](docs/README.md) for behavior and feature limits.
All file types open directly in resource tabs: `/workbench/notes/:id`,
`/canvas/:id`, `/math/:id`, `/image/:id`, `/text/:id` and media/document views
under the same `/workbench` prefix. Explorer's New menu creates notes, canvases,
equations, drawings and text files together. Old `/tools` links redirect; there is
no separate Tools landing or creation tab. See [file-first navigation](docs/FILE_WORKBENCH.md).
The [theme authoring criteria](docs/THEME_AUTHORING.md) define consistent tokens,
typography, controls, accessibility, licensing and acceptance checks for developers.

## Deployment

The primary path is **Docker Compose on one Linux host**, with Caddy HTTPS,
PostgreSQL 16, web, one sync service and a background worker.

```sh
cp .env.production.example .env.production
chmod 600 .env.production
# Edit the origin and replace every secret placeholder before continuing.
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production build db web
docker compose --env-file .env.production up -d
docker compose --env-file .env.production exec web node --import tsx scripts/ops/admin.ts
```

Read [deployment, backups and upgrades](docs/DEPLOYMENT.md) before using real data.
Production configuration never loads the development `.env` into containers.
Only HTTPS/HTTP are public. Sync also binds to host loopback for an
[existing host Nginx proxy](docs/DEPLOYMENT.md#existing-host-nginx); database and sync
internal APIs must not be exposed to the internet.
Native Linux/systemd installation is a [secondary option](docs/NATIVE_DEPLOYMENT.md).
No cloud deployment, image publication or external service configuration is implied.

## Verification and maintenance

```sh
npm run typecheck
npm run lint
npm test
npm run validate:themes
npm run docs:check
npm run clean:generated     # inventory only; add --apply after review
```

Build separately from a running release and run browser mutation tests only in an
isolated deployment. [Verification](docs/VERIFICATION.md) distinguishes fresh evidence
from historical runs and lists remaining device/provider gates.
[Contributing](CONTRIBUTING.md) explains project structure and change contracts;
[maintenance](docs/MAINTENANCE.md) explains safe cleanup and regeneration.

Private configuration, databases, attachments, backups, caches, screenshots and
traces are excluded from Git. A server database backup without its matching stored
files is not a complete recovery plan.
