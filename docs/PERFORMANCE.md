# Performance and UI regression contracts

Optimize repeated work, not document semantics. Canonical Markdown, source-backed
undo, permission checks, collaborative anchors and recoverable drafts remain
authoritative. A faster measurement is not evidence of correctness by itself.
Use the [UI contract](UI_CONTROLS.md) and [verification log](VERIFICATION.md) for
visual requirements and dated results.

## Runtime boundaries

- Visual reconciliation indexes DOM identities and source placements once per
  pass. Preserve the original first-match behavior and source-anchor resolution;
  do not retain DOM indexes beyond a pass that can replace those nodes.
- Canvas pointer updates are presentation-only and coalesced to animation frames.
  Pointer release flushes the exact final sample before one existing source
  transaction; cancellation writes nothing. Presence is bounded to 20 updates per
  second, with the final value flushed. Camera and peer-cursor changes must not
  rebuild source geometry or mutate a card.
- PDF search shares extraction only within one document proxy. Its normalized
  text LRU is bounded to 16 MiB and 256 pages; close or access loss clears it and
  rejects late results. Search cancellation is not a cache clear. Highlight
  matching uses ordered spans; selecting a different hit does not rebuild every
  page's geometry.
- Read-mode outline tracking measures heading positions after actual layout
  invalidation, then uses animation-frame scheduling and binary lookup while
  scrolling. Source, appearance, font loading, resize, images, equations and
  diagrams invalidate geometry. The progress-save controller stays independent.
- Appearance code loads when needed, while draft owners remain outside its lazy
  boundary. Loading a section must not erase Apply/Cancel state or scratchpad
  content. Chunk size alone is not a cold-navigation latency measurement.
- API and instance checks share a navigation request lifetime. Preparing unload
  cancels reads, not pending writes; page hide cancels remaining requests. Resume
  on pageshow/focus and recheck the dataset. Expected cancellation must not be
  reported as a network failure, nor should genuine failures be suppressed.

## Offline research storage

The per-account database name remains `axiom:<account>:research-v1`; IndexedDB
schema version 2 separates `items` metadata/annotations/reading entries from
`paper-bytes` payloads. The `kind` and `kindGroup` indexes allow routine research
reads without structured-cloning every pinned PDF.

Use `researchSummaries` for routine state, `researchEntries` for research drafts,
and `cachedPaper` for an explicitly selected file. `allResearch` is the deliberate
full-record compatibility/export boundary, not a polling helper. Metadata-only
updates must preserve existing bytes; explicit removal deletes both records.

Version upgrades use one atomic transaction and a cursor, preserving legacy Blob
or typed-array payloads, checksums, pending mutations and errors. A blocked or
quota-failed upgrade must leave the earlier schema usable. Never delete the
database to resolve an upgrade problem. Account guards apply before opening,
before transactions and after completion. Online reading must remain usable when
local storage is denied. Test persistent Blob compatibility separately where a
browser fixture cannot store Blobs; a typed-array pass is not a Blob pass.

## Server work

Batch link resolution and insertion rather than issuing queries per authored
link. Deduplication, case/path resolution, ambiguity, access scope and canonical
source must remain unchanged. Parse each resource's actual format only once.
Callers may skip unchanged saves; `indexNote` itself still reindexes unchanged
source after workspace transfers, without changing timestamps or notifying.

Planning rollups include active descendants of visible parents, not an unrelated
workspace-wide scan. Empty custom-field sets must not issue a large values query.
New indexes require actual query-plan and query/handler evidence, plus a forward
migration; never alter an already released migration to improve a query. Migration
50 adds only a partial reverse-link index for resolved targets. The existing
authored-link primary key, resource name trigram index and full-text GIN indexes
are reused; no speculative duplicate indexes are added.

S3 clients may be shared for identical configuration, but retire them only after
requests and response streams drain. Jobs use bounded concurrency and fair lanes;
shutdown drains owned jobs before closing the database pool. These optimizations
never change credentials, external calls, consent or retry authority.

The worker has at most two active jobs, with separate I/O and local lanes. Long
provider/site work cannot consume the local lane. Existing service-level leases,
cancel checks and uncertain-request non-replay remain the ownership boundary;
the dispatcher does not retry external work. The one-shot drain runs maintenance
once and rechecks earlier empty queues whenever a completed job or maintenance
pass may have enqueued more work. Generation-tagged queue reads cannot report
stale emptiness as completion after that work has changed.

## Server measurement snapshot

The October 7 audit compared baseline commit `afd0065` with the bounded server
changes on the same Node 22.17.0 runtime, using three warmups and twenty retained
samples. The initial synthetic corpus contained 1,000 target notes, 100,100 links,
50,003 folders and 5,001 tasks; indexing added 1,000 links before later context
timings. Permission checks, literal wildcard/Unicode directory
filters, ambiguity, UUID/title collisions, fragments and unchanged-source
reindexing retained their semantic results.

| Synthetic handler | Baseline p95 | Candidate p95 | SQL statements before → after |
| --- | ---: | ---: | ---: |
| Index 100 distinct links | 51.04 ms | 21.76 ms | 208 → 10 |
| Index 1,000 distinct links | 462.24 ms | 205.36 ms | 2,008 → 10 |
| Planning page containing a parent | 13.40 ms | 8.05 ms | 10 → 6 |
| Leaf-only planning page | 7.82 ms | 7.63 ms | 9 → 5 |
| Literal directory-name filter | 15.69 ms | 6.76 ms | 2 → 2 |

Indexing counts include the fixture transaction and verification query, not just
the two link statements. The batched resolver still evaluates each distinct
target; the measured improvement removes round trips, not all target-resolution
work. This is server/SQL timing, not network or input-to-paint latency. Both
handlers used the same fixture-only parent index during that recorded corpus
comparison; subsequent probe runs drop it before handler timings.

A separate reverse-link SQL fixture justified migration 50: raw lookup p95 fell
from 4.50 to 0.30 ms, and the exact permission-filtered context-link query fell
from 16.26 to 5.20 ms. A second fixture verified atomic migration rollback,
repeatable 49 → 50 upgrades, exact Markdown/Yjs bytes and the complete link
count/hash; its query p95 values were 4.88 → 0.74 and 13.89 → 5.04 ms. These
follow-up timings ran while other validation could be active, and are not a
whole-page acceptance benchmark. Query plans show the reverse lookup using a
bitmap combination of the primary key and the new partial index.

The complete note-context handler did **not** improve in the original fixture
(117.24 → 126.29 ms p95), so do not claim an end-to-end context-page speedup from
the index. A candidate resource-parent index did not improve 100-folder insertion
(16.37 → 17.49 ms p95) and was rejected. Retain setup failures as diagnostics;
they are not passing benchmark evidence.

## Reproducible gates

Use isolated staging, the browser-local editor lab or the static showcase. Never
run mutation tests, migrations, seeds or cleanup against working notes/storage.
Retain private receipts and screenshots in ignored `data/` paths, not public
documentation assets.

```sh
npm run typecheck
npm run lint
npm run validate:ui
npm run validate:themes
npm run docs:check
npm test
npm run showcase:build
npm run test:showcase
npm run test:editor -- research-storage.spec.ts
npm run test:editor:performance
npm run verify:reliability -- ui-controls.spec.ts interface-harmony.spec.ts
node --import tsx scripts/verify/backend-performance.ts
node --import tsx scripts/verify/backlink-index-performance.ts
```

The backend probe creates and stops its own retained PostgreSQL fixture on port
54349, without loading `.env`. It compares real baseline/current handlers on the
same host using three warmups and twenty measured samples, query counts,
permission/ambiguity fixtures and semantic hashes. Record baseline commit,
runtime, dataset, plans and exact outcomes; a probe that fails during setup is
diagnostic evidence, not an accepted performance result. Avoid concurrent builds
or benchmarks during timing. A p95 regression over 20% requires investigation,
not an adjusted threshold.

The smaller backlink probe owns a separate fresh cluster on the same private port
and checks the exact permission-filtered SQL plus migration rollback/idempotency.
Run the two server probes sequentially; both refuse an occupied port and stop
their own cluster, retaining private receipts with samples and query plans.

The editor benchmark measures synthetic browser input to the next animation frame
on 100k/980k-character fixtures, with p95 budgets of 50/200 ms. It checks source
convergence as well; this is not physical input/device latency or network timing.
Algorithm counters and synthetic pointer bursts complement
the benchmark, but do not certify real-device IME, clipboard or accessibility.

Visual acceptance includes screenshots in all three desktop engines, all five
interface styles, light/dark, 15/22px UI text, radius zero, no shadows, keyboard,
forced colors and reduced motion. Inspect text ranges, adjacent control edges,
wrapping, focus insets, scroll ownership and fixed footers—not only element
presence. Record executed gates and remaining manual checks in Verification.
