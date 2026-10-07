# Stage 3–4 software acceptance

This gate finishes acceptance for [lab planning](PLANNING_LAB.md) and the
[grounded assistant/MCP](WORKSPACE_ASSISTANT.md). It adds no new editor, automatic
publication or unrestricted agent authority. A runner being implemented is not
evidence that its database, browser or performance assertions passed.

## Run from a local terminal

Use **Node 24**, the repository lockfile, the three installed desktop browser
engines and PostgreSQL client tools at least as new as the bundled PostgreSQL 18
server. The host must permit local listeners, process groups and PostgreSQL shared
memory. Do not run a second staging or acceptance process concurrently.

```sh
node --version                 # must report v24.x for this gate
npm ci
npx playwright install chromium firefox webkit
# If needed: export PG_BIN=/absolute/path/to/postgres-client/bin
npm run verify:stages:acceptance -- --preflight-only
npm run verify:stages:acceptance
```

Preflight checks Node, browser executables, server/client versions, the historical
baseline commit and isolated ports **3004, 1236, 1235, 8096 and 54339**. It does not
start a database, application or provider. Missing prerequisites or occupied/denied
ports stop the run; the runner never kills a service to make a port available.
Client tools and browser system libraries are operator prerequisites, not silently
installed by the gate. A missing historical commit requires a checkout containing
that history; it is not replaced with a fabricated baseline.

No `.env` is loaded. An environment allowlist excludes application database,
storage, authentication, provider/cloud credentials, proxies, preload flags and
ambient test overrides. The local gate deliberately ignores
`AXIOM_RELIABILITY_DATABASE_URL`; it owns a fresh local cluster. The lower-level
[reliability runner](RELIABILITY.md) has a separate explicit CI control-database
contract. Never supply a working database or redirect mutation tests to 8080.

## Phases and evidence

1. **Static:** TypeScript, lint, unit tests, shared UI/theme validation and local
   documentation links.
2. **Planning SQL:** normal fresh/45→current/rerun migration controller, exact
   document/state preservation, property projection, manual-time isolation and
   coalescing outbox assertions.
3. **Assistant SQL:** fresh/46→current/rerun, preserved canonical source and private
   contexts, receipt uniqueness, legacy pause and retention/cleanup assertions.
4. **Runtime:** an optimized isolated build with its actual build ID, attested
   disposable database/storage, synthetic accounts, actual production workers,
   loopback provider, all three desktop engines, synchronization durability and
   populated paired recovery.
5. **Scale:** the same disposable runtime measures common server workflows against
   historical source before draining, then the coordinator validates its report.
   Browser rendering/scroll checks are separate from server timing.

No phase is skipped into a pass. A preflight-only or focused-engine run is scoped
evidence, not complete acceptance. For diagnosis:

```sh
npm run verify:stages:acceptance -- --project=firefox
```

Unknown narrowing options such as `--grep` are rejected by this coordinator. The
lower-level reliability runner still supports scoped diagnostic arguments and
records them as such.

### Real workers and races

The ordinary staging worker is drained before test-owned worker processes begin.
They call production functions and actual PostgreSQL transactions. IPC barriers
are test-only process instrumentation, not public HTTP fault endpoints. They
preserve the promise and callback query paths, hold the originating transaction,
and never supply mocked SQL results. Waits are bounded; failures stay failures.

`races.json` records completed checks and any failure. Coverage includes:

- Two automation workers waiting on real locks, one committed event proposal,
  crash-before-commit rollback/recovery and a genuinely overlapping task write.
- Daily local-day idempotency across spring/fall DST with a controlled fixture
  clock, plus authority-loss rule pausing. These are real worker/SQL runs, not a
  physical wall-clock waiting test.
- Another member's time correction, reason/current-version requirements and
  actor/filter-bound continuation pages.
- Concurrent same-receipt approval, two dispatch workers, before/after local
  checkpoints, confirmed local recovery with zero extra provider requests and
  unconfirmed-request classification without automatic retry.
- Expiry before/after approval, provider configuration changes, competing provider
  quota slots, cancellation/retention versus approval and access loss after consent.
- Actual native MCP adapter reads with PostgreSQL grants: scoped search/read,
  cursor mismatch, revoked grant and no ability to approve assistant consent.
  This does not certify a remote client's OAuth login or transport setup.
- Saved partial-receipt fixtures exercise concurrent same-ID remaining-only
  preparation, completed-parent reuse, uncertain/stale/private refusals and no
  publication before review. They are explicitly fixtures, not a new claim that
  an application crash completed their operations.

The provider serves deterministic synthetic responses only on loopback. Its call
counter verifies request counts; this is not real billing, retention or model
quality acceptance. No live provider credentials cross this boundary.

### Recovery must be populated

After services drain, an owned synthetic fixture adds canonical CRLF Markdown,
Yjs state and a binary journal, a snapshot and a checksummed attachment. It also
adds property definitions/projections, shared time/correction history, a paused
rule/outbox/proposal, held/confirmed/uncertain assistant work and a partially
completed change set with completed/pending/uncertain actions and a remaining-only
receipt. No provider is called during fixture creation.

All 21 required ledgers must be nonempty and the attachment manifest must contain
blobs. The real backup CLI restores into a **new** database and storage pair.
Complete records and every blob's bytes/hash must match. A second restore must
refuse to overwrite the nonempty destination, and both pairs must remain unchanged.
Empty-table equality is never accepted as Stage 3–4 recovery evidence.

### Reproducible scale budget

The deterministic fixture recipe creates **5,000 tasks per workspace**, **20
selected workspaces** and **100,000 selected portfolio tasks**. Both sources use
the same corpus, host, current dependency lockfile and migrated schema. Baseline
shared-server source is read from **commit `7cd2cc5`** with `git archive` into the
private run directory. No branch checkout, working-tree reset or historical data
restore is performed. The dependency-lock hash is recorded: this compares
historical handler source on the current dependencies, not an old full deployment.

For body-free planning, portfolio summary and capacity, each source gets **three
warmups and twenty measured iterations**. Raw timing/query counts, semantic-result
hashes and peak RSS are retained. Measured results must agree and candidate p95
must be no more than **120%** of baseline p95. Failed iterations and outliers are
not discarded. Timings cover authorization, SQL and JSON serialization/reading,
not network latency or physical input-to-paint. New-only lab property summaries
are reported separately and receive no fictitious historical regression claim.

An authenticated browser test independently verifies actual 5,000-row database
data, bounded mounted Gantt rows and scrolling to a distant task. Its screenshot
and elapsed navigation sample are not presented as a p95 benchmark.

## Private receipts and operator review

The coordinator retains `receipt.json` and `OPERATOR_REVIEW.md` under ignored
`data/stage-acceptance-*`. Source commit, dirty-tree code fingerprint, environment,
browser list and each phase's state/error/artifact are explicit. Runtime evidence
is under its own `data/reliability-*/` directory: build ID, `races.json`, raw scale
reports, recovery fixtures/backup and `browser-results/` images. Artifact reads
reject path escapes and symlink redirects. Failure/interruption receipts are not
relabeled as passing evidence.

Exclusive locks refuse simultaneous runs. An abandoned lock is not automatically
stolen: inspect its PID and retained evidence, ensure its owned processes stopped,
then deliberately remove only that exact lock before retrying. Never kill a
process by name/port or clean a broad data directory. Owned process groups cover
staging wrappers and their descendants on interruption. The user's exact existing
`next-env.d.ts` selection is restored after the isolated build, including an
already-dirty file. Acceptance does not change working migrations or restart 8080.

Even `software: passed` leaves `acceptance: pending-operator-review`. The generated
checklist requires inspection of **current actual images** for all registered interface
styles, light/dark, 22px text, wrapping, scroll ownership and footer visibility;
keyboard/Space/Escape/focus-return behavior; forced colors/reduced motion; and a
recorded screen-reader/platform pass. Record reviewer/date/source/build identity,
image filenames and findings. Do not claim this human review from screenshot
generation alone.

Physical IME/clipboard, external provider limits/billing/retention/quality, S3,
deployment-domain networking and production recovery remain distinct gates. This
command never commits, pushes, deploys, promotes fixture data or advances Stage 5.

Actual executed results belong in [Verification](VERIFICATION.md). Stages 3 and 4
remain pending on the [roadmap](PRODUCTIVITY_ROADMAP.md) until their evidence and
operator review are accepted.
