# Architecture and data boundaries

```
Browser: Axiom editor/UI + own source parser (Milkdown/ProseMirror + CodeMirror surfaces)
   |                       |
   | HTTPS                 | authenticated WebSocket
   v                       v
Next.js API           Hocuspocus / Yjs (one process)
   |                       |
   +------- PostgreSQL ----+
   |            |
   |      Workspace worker (leased jobs)
   |            |
   +--- Protected local blobs or private S3
```

## Document contract

The canonical editable source is `Y.Text('markdown')`. PostgreSQL stores binary Yjs state and an append-only update journal. `notes.body`, plain text, search, and backlinks are derived indexes, not a second independently editable copy. Opening a note never inserts the REST body into an existing CRDT. Visual commands make localized edits; switching modes does not serialize or rewrite the document.

The handwritten block/inline parser exposes UTF-16 source spans. Standard mode covers CommonMark 0.31.2; GFM adds tables, tasks, strikethrough, extended autolinks, and tag filtering. `stem-v1` adds research syntax. Entity decoding, code highlighting, math rendering, and diagram rendering are specialized libraries, not Markdown parsers. Production rendering escapes raw HTML and filters URLs; the conformance renderer's raw-HTML mode is used only by fixtures, never by the UI or export API.

The sync service journals updates, serializes persistence per room, and atomically commits binary state, Markdown/search/link indexes and journal compaction. “Saved on server” means a matching persistence acknowledgment, not simply an open socket. Local edits remain in IndexedDB during disconnection. Named versions remain until explicitly managed; changed active documents get automatic checkpoints approximately every five minutes, with unnamed checkpoints retained for 30 days. This checkpoint policy does not delete immutable uploaded file versions.

The browser's own IndexedDB journal reports a local save only after a strict-durability transaction completes. The distinction between a request succeeding and a transaction committing follows the [IndexedDB transaction contract](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event). A storage/quota failure is visible and retains the in-memory document for export or server synchronization. Browser eviction, manual data clearing, and device failure are still possible; local cache is not a backup.

Parser recursion and operation budgets bound adversarial nesting. Exceptionally complex constructs degrade to escaped literal text with a diagnostic, preserving canonical source. The modern shell receives identity-free SSE invalidations from one pooled PostgreSQL listener and separately authorizes every refreshed read. Session heartbeats close revoked streams. Focus/navigation/periodic refresh remain fallbacks; invalidations never replace an open form draft.

The workbench keeps account/note/generation-scoped Yjs documents and undo managers across tabs. Only the two visible panes own editor views, providers, workers and persistence bindings. Closing tabs releases retained sessions after the local save guard passes. Mode, scroll and outline collapse are view state, not Markdown. Pinned file versions live in route/working-set state.

Restoration creates a fresh generation and CRDT. Existing clients retain their old local source for recovery but cannot merge stale edits into the restored generation. A “Before restore” checkpoint preserves the previous version.

## Authorization

- Notes, folders and files belong to an account-owned personal space, team library or project. Central resource-role checks cover notes/search/comments/history/files/derivatives/exports and collaboration. Personal spaces require their owner; administrators cannot browse others' personal work. Group administration and content roles are separate. Content cleanup also requires readable content, not merely administration authority.
- Mutations require the configured origin. Sessions use Better Auth's cookie/password implementation. Open email signup is blocked; email-bound invitation tokens authorize registration.
- Collaboration tokens are short-lived HMAC capabilities tied to a real session, note and generation. The server sets read-only connections for viewers/commenters and rechecks current role on authentication/refresh. Membership/session validity is rechecked on messages; changes invalidate active rooms. A token issued before downgrade cannot regain write access.
- Metadata edits use optimistic versions. Note nesting must remain acyclic and share project/visibility boundaries.
- Explorer files are limited to 1 GB decimal, with checksummed 8 MiB resumable parts and streamed completion/verification. The legacy attachment/import endpoint retains its 50 MB bound. MIME is determined from bytes; unknown types download as opaque attachments. Raw SVG/HTML are never trusted images.
- Import previews perform no database or blob writes. Archives have path, file-count, expanded-size, UTF-8, hierarchy, and checksum checks. Successful imports create new records transactionally; conflicts never overwrite existing notes.

This is a trusted-group application, not an end-to-end encrypted vault. The server administrator can read research and backups. TLS and disk/bucket encryption are deployment responsibilities. Removing access cannot erase copies already downloaded to someone else's device. Use trusted devices; signing out clears this account's browser note caches. An offline browser cannot revoke its server session until it reconnects.

Offline sign-out stores a pending-revocation marker before clearing caches, locks other open tabs, and retries server sign-out on reconnect or before any new sign-in. A cached session cannot silently resurrect while revocation is pending.

## Offline limits

The production service worker caches only the public application shell and immutable code/font assets—not API responses or private files. IndexedDB stores opened documents per account and generation. Small metadata caches support navigation. First-time sign-in, unopened notes, unpinned attachments/PDFs, new notes, membership, group import/export, and server history require connectivity. Do not treat offline caches as the sole backup.

PDF copies are per-paper opt-in, stored as binary arrays in the account's `research-v1` IndexedDB database; legacy Blob copies remain readable. SHA-256 is checked on pin and load. Online viewing does not require writable research storage. Pins are reauthorized on opening, reconnect/focus, and periodic visible-tab checks. A denial removes the cached PDF and synchronized annotation copies; unsynchronized personal work remains available for export. Offline copies cannot be remotely recalled.

Reading records and annotations use an account-scoped transaction-committed outbox. Server revisions and mutation IDs detect stale writes and retries. Annotation sharing requires an online action; annotations begin private and only their authors may edit them. Administrators can remove another author's shared annotation but cannot read their private annotations. Shared annotations inherit the underlying paper's current access boundary. Copying a private annotation into shared Markdown warns the user because the inserted text then follows the note's sharing rules.

Preferences are validated semantic values, not executable CSS. Account preferences synchronize via optimistic revisions and a three-way field merge. Overlapping changes require a choice; device overrides are never uploaded. Self-hosted fonts, role-specific CSS variables, and native view reconfiguration keep typography separate from document content and collaboration lifecycles. The public HTML is account-neutral; a guarded local prepaint cache restores appearance only for its matching cached account.

The settings split, preview visibility and search filters are component-local view
state, not new preference fields. Its scratchpad owns an in-memory Yjs document
without a provider, account persistence or note/file identity. Preference changes
reconfigure the existing sample view; hiding it preserves the session. Profile
and notification forms use independent saved baselines and their existing APIs,
not the Appearance/Writing draft controller. See [settings behavior](SETTINGS.md).

Appearance schema v2 adds Frost/Graphite and bounded material controls. The reader normalizes v1 profiles/caches using the old defaults, preserving custom fields. New profiles use sans-serif typography and glass chrome. Migration 2 adds only `user_preferences.previous_preferences`. The authenticated, no-store preference PATCH accepts optional `savePrevious`; snapshot capture and the new preference version commit in the same compare-and-swap statement. Retries with the same mutation ID cannot overwrite the snapshot. Restoring uses the same revision/merge path; no privileged restore endpoint exists. Writes from v1 clients receive HTTP 426 to prevent dropping fields they cannot represent. Portable palette JSON remains version 1.

Appearance schema v3 added `latinModern`; v4 adds `documentDecorations: none | latex`
without database DDL or default typography changes. Exact old LaTeX Article
signatures upgrade with decorations enabled; other old profiles use none. Current
clients now advertise `X-Axiom-Appearance-Schema: 5` on bundle requests. Legacy GETs
receive v2/v3/v4 only if the current and previous appearance can be represented;
otherwise 426. The account-scoped prepaint cache includes the decoration mode.
Legacy appearance writes are rejected before mutation. Writing remains schema v2.
LaTeX Article and Paper Ink/Night Paper are independent optional type/color presets.
Fonts are local WOFF2 assets included in the offline build; personal HTML embeds
their bytes and license. Engine rollback must retain this compatibility layer.

Schema v5 adds a statically registered `themePack` ID with paired base palettes.
User overrides and high-contrast presets stay authoritative; packs are trusted,
scoped CSS compiled into the application, never loaded from user-supplied URLs.
The settings Interface workbench and build-time manifest/CSS/contrast validator
share the same tokens. See [theme authoring](THEME_AUTHORING.md).

Canvas now uses internal schema v1 with explicit JSON Canvas interchange, modular
geometry/sizing/preview/export boundaries and nested collaborative text. Migration
18 adds snapshot options for durable exports and a per-database identity. A
development replacement fences old browser caches/outboxes before account views
mount. See [Canvas architecture](CANVAS_ARCHITECTURE.md) and
[development reset and first run](DEVELOPMENT_RESET.md).

The canonical document index derives section numbers from actual heading ancestry.
`section-numbers.ts` supplies shared display-only attributes for rich node decorations,
Read mode and export. Active source headings retain their canonical key, but no
generated text is put in the editable schema, Markdown, TOC labels or anchor IDs.
The shared decoration stylesheet renders accessible-name-neutral `§ n.n` labels.

Completed quote prefixes are hidden in a per-line, view-only source map. Ordinary
quote bodies remain literal; empty bodies have a mapped insertion point. The
same source-edit adapter expands multiline paste/IME replacements once, preserving
CRLF and explicit nested quote depth. Backspace unwraps one paragraph level, never
the whole adjacent equation/table container. No parser dialect or Yjs schema changes.

The table of contents derives a real ancestor stack from the parser's outline, retaining source offsets and unique IDs. The native DOM/source map exposes caret and visible-source positions without replacing the Yjs provider. Read mode measures headings inside the visible reading mount only. Collapse state lives in the current document session, outside both canonical Markdown and account preferences.

The editor registry in `packages/shared/src/editor.ts` is serializable and shared by command dispatch, slash/palette UI, hints and preference validation. Migration 3 adds `user_editor_preferences`; authenticated GET/PATCH use private/no-store responses, per-account scope, mutation idempotence and compare-and-swap revisions. The local controller holds an account-scoped outbox and merges independent fields/platform-command bindings. Editor preferences are independent of appearance restore points.

`packages/markdown/src/editing.ts` and `apps/web/lib/native-editor/transactions.ts` produce canonical source-range changes. Semantic lists, quotes, code, TeX and table cells share one first-party contenteditable surface and source map. `beforeinput` routes cancellable edits into Yjs; composition and noncancellable input reconcile browser-owned DOM text against relative-position bookmarks. A deleted/conflicting composition container retains a full recoverable Markdown draft. Uncommitted language/callout-title fields use guarded commits and the same recovery path. Structural edits form explicit author-local undo boundaries in the retained Yjs undo manager. Async table/attachment insertion captures relative positions and checks selected source before applying. Changing mode/preferences reconfigures the view without reconnecting the provider.

Awareness publishes relative source positions directly, including table/code/math selections and other sessions of the same account. Remote equation editing displays a block indicator when local TeX is closed; it never forces that local surface open. Each workbench pane keeps its footer outside the document scroller. Language-aware counts run in a versioned worker, and hidden reading/print HTML is prepared only when needed.

DOI/arXiv lookup occurs only after a user's explicit request. The server sends the validated identifier to fixed official endpoints; note text, PDFs, credentials and account identifiers are not sent. Responses have time/size limits, XML entity rejection, and a preview-before-save flow. arXiv requests are paced and serialized across users. Manual reference entry remains available if a provider is unavailable.

Cached worker scripts use synthetic responses to retain their original bootstrap URL, including Turbopack's fragment configuration. Forwarding a cached response URL changes a worker's location; see [service-worker response URL behavior](https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith). Offline tests assert that the Markdown worker still runs, not just that cached text appears.

## Scope and operations

The design targets small research groups (roughly 50 members and up to 10 simultaneous editors on a note). Ten-client convergence is an acceptance test, not a public-internet load/SLA guarantee. Text is limited to one million characters per note. Code blocks are displayed, never executed. Bibliography metadata is group-shared; there is no automatic external AI-provider upload or paper scraping.

There is no billing, checkout, public signup/sharing or arbitrary user-defined database system. Research projects have bounded board/list/calendar task workflows, recurrences, dependencies, snapshot-bound reviews and discussions. PostgreSQL DATE values remain calendar strings to prevent time-zone shifts during JSON round trips. Email requires explicit preferences and SMTP configuration.

Workspace jobs use lease identities, fenced heartbeats and final writes; old attempts cannot mark a new lease complete. Exports have a per-job lock and reauthorize every required resource before publication/download. Backup inventory and `pg_dump` share one database snapshot and a shared blob lock. File cleanup takes the exclusive lock, rejects pending document journals and protects live/snapshot references before queuing exact unreferenced-blob deletion. Shared immutable blobs have distinct version identities and are backed up once. Restore never overwrites the source database; unfinished multipart sessions are cancelled in the restored copy because staging is not part of a backup.

Password MFA uses TOTP/recovery codes. Optional institutional OIDC requires explicit same-email account linking, a verified fresh email claim, PKCE and signed ID-token checks; signup/implicit linking remain disabled. Institutional MFA is an upstream responsibility, separate from local password MFA.

Portable exports contain current Markdown, hierarchy, linked version bytes/checksums and BibTeX. Full account/history restoration uses the separate backup utility. See [workspace behavior and limits](WORKSPACE.md).
