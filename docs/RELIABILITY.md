# Reliable daily-use beta

Stage 1 hardens existing workflows before adding more editors or unrestricted
automation. This is test/release infrastructure and targeted regression repair,
not a claim that every product feature or physical-device gate is complete.

For complete Stage 3–4 software acceptance, use
[`npm run verify:stages:acceptance`](STAGE_ACCEPTANCE.md). It adds prerequisite
refusal, both SQL gates, real-worker races, all three desktop engines, nonempty
recovery coverage and a recorded historical-source scale budget. It does not
automatically pass operator review or enable live providers.

## One-command authenticated acceptance

```sh
npm ci
npx playwright install chromium firefox webkit
npm run verify:reliability -- --project=chromium
# Full desktop engine matrix:
npm run verify:reliability -- --project=chromium --project=firefox --project=webkit
```

The runner does not load `.env`. It starts a fresh local Embedded PostgreSQL
cluster on 54339, creates its own test database, migrates it, builds an isolated
optimized application, provisions a fictional account and starts web/sync/worker
on **3004/1236**. Fault injection uses **1235**; synthetic assistant acceptance uses
the loopback-only fixture on **8096**, with a test-only key/allowlist. Occupied or
inaccessible ports cause refusal;
existing processes are never stopped. Only the runner's owned child handles and
process groups are stopped on completion/interruption, including wrapper
descendants. An exclusive runtime lock refuses competing runs; abandoned locks
require deliberate inspection rather than automatic removal.

PostgreSQL `pg_dump` and `pg_restore` must be installed and at least as new as the
test server (the bundled local server is PostgreSQL 18). `PG_BIN` can name their
directory; common Homebrew libpq directories are discovered on macOS. Missing or
old tools fail recovery rather than silently skipping it. CI uses its own
PostgreSQL 16 service and matching client tools. An explicit
`AXIOM_RELIABILITY_DATABASE_URL` may replace Embedded PostgreSQL **only** with a
local `/postgres` control database dedicated to this run; never supply production
or a shared database server.

### What is checked

- Existing authenticated editor mode/source fidelity, peer undo, offline/reconnect,
  nested equations, anchored discussion and export/Read behavior.
- Editable LaTeX snapshot exports, lossless bibliography history/merge review,
  frozen paper evidence and immutable milestone/reference task handoffs. Local
  compilation and 43→44 upgrade rehearsal have [separate gates](RESEARCH_WRITING.md).
- Explorer authorization, stale writes, quota, uploads, versions, copy/move,
  recoverable Trash, protection removal and purge safeguards.
- Native Markdown/folder/ZIP imports, resume, conflict and private cancellation.
- Workspace planning, recovered drafts and 5,000-row Gantt virtualization.
- Goal/metadata/occurrence archive pages, body-free summaries and authorized lazy
  details, tied/microsecond cursors, the 200-goal total cap, retained stale drafts
  and revoked read access. A held peer refresh during pointerdown rehearses stable
  pagination controls. The isolated 44→current index upgrade uses
  `npm run verify:planning-archives:migration`.
- Shared controls/settings/Canvas layout, all interface treatments and large text.
- Exact-batch assistant approval, narrowing/removal, reviewed output caps, unknown
  usage, source-key membership, native snapshot inspection, revocation and private
  file/task/plan changes. No real provider is contacted. The separate
  `npm run verify:assistant:migration` checks fresh/46→current/rerun SQL and private
  receipt/ledger cleanup, not concurrent leases.
- Actual sync-process crashes, failed-save acknowledgments, binary journal recovery
  and graceful persistence drain.
- Real paired database/blob backup and restore into a **new** database/storage
  pair: exact notes, Yjs snapshots/journals, history, tasks, goals, metadata changes,
  routines/occurrences, accounts, reference
  provenance, frozen reviews, research-task links, private assistant contexts,
  runs/reviews/dispatches/change receipts and migration receipts, plus
  every backed-up blob's bytes and SHA-256. Repeated restore into a non-empty pair
  must fail; the source pair must remain unchanged. A drained synthetic fixture
  populates all 21 required ledgers and a blob; empty tables cannot pass recovery.

The browser matrix is scoped by `reliability.config.ts`. It does **not** silently
recertify every historical E2E spec, provider behavior or all large research files.
Changing `--grep`/test arguments narrows acceptance; the private receipt records
the exact arguments and completed phases, never fabricates an all-suite pass.

## Fail-closed mutation boundaries

Protected browser configs require an explicit registered profile, exact local
database name, local storage directory, 3004 origin and 1236 synchronization port.
Before fixtures write, `/health` must attest the same database/storage fingerprint.
The running server checks its **actual** PostgreSQL database and real storage path;
symlink redirects, mismatches, redirects and unavailable schema cause refusal.
Ordinary deployment health exposes neither this identity nor database credentials.

The staging wrapper validates **all** targets before creating files/databases.
Working build paths, 8080/1234 and unregistered profiles are rejected. It strips
SMTP, institutional-login and research-provider credentials; extensions staging
alone uses its documented local deterministic provider. Extension/import flags
remain off in reliability staging and unchanged in the working app.

For an already running, explicitly provisioned profile:

```sh
npm run plugins:staging -- test --config imports.config.ts --project=chromium
npm run plugins:staging -- test --config planning.config.ts --project=chromium
npm run plugins:staging -- test --config plugins.config.ts --project=chromium
npm run staging -- test tests/e2e/editor-vnext.spec.ts
```

Bare `test:e2e`, `test:imports`, `test:planning` and `test:plugins` intentionally
refuse a missing isolated identity. A port-only override is insufficient.
`test:dev` remains a separate **read-only** smoke on the working service; never add
file/account mutations to it. Older bespoke suites need their own reviewed target
contract before joining the reliability matrix.

## Browser-local editor and performance

```sh
npm run test:editor
npm run test:editor:performance
```

Both start/reuse only the `.env`-free editor laboratory on 3003; there are no
accounts, database, uploads or real notes. The lab uses the actual production
styles and canonical-source editor with in-memory collaborative peers. The new
mixed-research fixture covers LF/CRLF, metadata, lists/tasks, nested quotes,
equations, code, tables, footnotes and link definitions through repeated view
switches and empty-block removal with peer-preserving undo.

Performance is an explicit, single-worker same-machine benchmark, not a noisy
concurrent CI speed claim: 50 input-to-frame samples at top/middle/end of 100k and
980k-character notes. The report includes browser/Node/platform, source size,
engine and raw samples. Current budgets are p95 <50ms / <200ms respectively for
the default editor with a source peer. This is not PDF/Canvas/portfolio load
acceptance or a physical-keystroke latency measurement.

## Evidence and remaining gates

Private fixtures, backups and receipts remain under ignored `data/reliability-*`.
Each runner keeps browser captures in its own `data/reliability-*/browser-results`
directory, so a focused follow-up never erases a full matrix. Direct staging-wrapper
runs use `data/reliability-results`, which Playwright replaces on the next invocation.
Performance attachments are under `data/editor-performance-results`. Run-specific
artifacts are retained for diagnosis, not
automatically purged, promoted to working data or committed. Authenticated traces
are disabled by default. Opt-in diagnostic traces (`--trace=retain-on-failure`)
can include fixture credentials and must remain private. The CI workflow uploads
only fixture screenshots and content-free receipts for seven days, never traces,
database files, backups or environment credentials.
No deployment permission is granted to the reliability workflow.

[Verification](VERIFICATION.md) records executed results. The workflow being added
locally does not mean GitHub has run it. [Physical editor acceptance](EDITOR_VNEXT_ACCEPTANCE.md),
Safari's system clipboard/IME, assistive technology, real-provider quality,
private OCR/conversion, S3, real mixed/large PDF/Canvas/portfolio performance and
production-domain recovery remain distinct operator/human gates. Keep the beta
label until required release evidence has been collected.
