# Axiom implementation

> Historical implementation and local-test log. Commands, ports, build IDs and
> rollout status below describe earlier snapshots, not the current release.
> See [current documentation](../README.md) and [verification](../VERIFICATION.md).

## Unified management console — September 11, 2026

Workspaces replaces the small management dialog and consolidates group administration, storage, access and lifecycle. Audit replaces the old file-operation history surface with durable, permission-filtered metadata history and background-operation progress. Trash now includes workspace recovery, expandable file hierarchies, frozen batch previews, chosen restore destinations, conflict policies and reference-safe permanent removal. Forward migrations 13–15 preserve scope and deletion evidence; durable idle/collaborative checkpoints retain named/review versions while automatic bodies expire after 30 days. See [behavior, boundaries and verification](../MANAGEMENT_CONSOLE.md). Earlier release notes below are historical.

## First-party native editor

The desktop refinement supersedes whole-paragraph reveal with caret-local inline syntax, structure-aware deletion, literal-container-safe editing and quieter code controls. It adds shared sidebar/Explorer context actions, recoverable workspace lifecycle management, and access-epoch-based collaboration recovery. Migration 8 adds only workspace lifecycle metadata; Markdown and Yjs remain canonical and unchanged in format. See [the desktop contract](../DESKTOP_REFINEMENT.md) and [typing behavior](../TYPING_INTEGRITY.md). Final release evidence is recorded in the verification guide.

The desktop r9 release is deployed locally on September 9 with a verified fresh backup, an additive audited migration and unchanged research data. Acceptance passes 848 unit tests, 77 Chromium application tests, 25 desktop application scenarios each in Firefox/WebKit, and 24 input/caret scenarios in each engine. One intermittent WebKit default-code-language save during rapid settings navigation remains under investigation; isolated repetitions pass, but its historical cause is not claimed fixed. See [the verification record](../VERIFICATION.md) for build IDs, explicit browser skips and device-testing limits.

The editor-framework runtime is replaced by Axiom's own transaction, source/DOM mapping, composition, rendering, clipboard, completion and command layers. CodeMirror and its Yjs adapter are removed from the dependency tree. The existing Markdown parser, Yjs/Hocuspocus transport, local persistence and durable save acknowledgements remain; no note or document-format migration is required.

Write mode renders real nested lists, tasks and quotes. Tables have direct collaborative cell editing, range selections, guarded context actions, TSV/HTML paste, quiet reorder/resize grips and author-local undo. Code and TeX retain source positions inside containers, have scoped selection and protected fence boundaries, and expose controls on hover/focus. TeX snippets have navigable fields. Browser-owned composition, remote structural deletion and uncommitted metadata have explicit recovery paths.

Every editing surface publishes relative-position awareness, including table cells and same-account devices. Share explains inherited permissions without granting access; collaborator avatars locate another session. Each workbench pane has a pinned footer and a viewport-contained statistics panel. Passive YAML metadata, an inline TOC, sub/superscripts, common emoji aliases and safe underline extend STEM Markdown without enabling arbitrary HTML.

The design system applies to the native surfaces and existing routed settings. Hidden reading/print output is prepared on demand; statistics and mathematical rendering use bounded worker paths. Worker construction/load failures remain visible without disabling source persistence. See [the editor guide](../EDITOR.md), [native release gates](../NATIVE_EDITOR_IMPLEMENTATION.md) and [verification evidence](../VERIFICATION.md). Historical release sections below describe the earlier implementation stages.

Approved scope: original CommonMark/GFM parser, Typora-like live editor and source mode, real-time co-editing, offline cached notes, invite-only accounts, groups/projects/private drafts, citations/PDFs/math/diagrams/backlinks/graph, portable exports, history, native AWS and optional Docker deployment.

Implementation order: parser and conformance; durable collaboration; complete workspace and research interactions; deployment; integration/browser/release checks.

All production document rendering must use the original parser. Axiom owns text input, source selections and editor transactions; specialized libraries handle CRDTs, mathematics, diagram rendering, code highlighting and PDF viewing. Markdown is canonical; mode switches never rewrite content. Native installation is a first-class path.

## Appearance and reading release

Implemented the approved papers-and-reading priority: account-synced preferences, separate per-account device overrides, six palettes with a constrained visual editor and theme JSON import/export, self-hosted semantic typography, adjustable reading layout, protected split-pane PDF reading and private-first annotations, explicit DOI/arXiv lookup, reference editing/links, personal queues/filters/bookmarks/progress, offline opt-in PDFs, local outboxes, conflict handling, and research-data export/storage management.

The database upgrade is additive and versioned in `schema_migrations`. Existing document generations, Markdown, private-draft rules, and collaborative editing are preserved. Preference updates use field-wise conflict detection; authored annotations require explicit conflict resolution. Passive reading positions use last-synchronized replacement semantics.

Remaining beyond the original reading release were user-authored templates, equation navigation, advanced search/graphs and research task/review workflows. The workspace release below now adds task/review workflows and unified resource search. Custom template authoring, richer graph exploration, OCR, external AI and executable notebooks remain follow-ups. AWS/TLS/S3/SMTP and native Linux/Docker runtime validation require the target infrastructure; browser automation does not certify physical Safari/iOS devices.

See `docs/READING.md` for behavior and `docs/VERIFICATION.md` for measured checks and limitations.

## Modern workspace design release

Implemented the approved expressive-glass, sans-throughout direction: Frost/Graphite palettes; bounded Glass/Solid materials with accessibility fallbacks; refined navigation, toolbars, library/overview/auth surfaces; role-specific rounded controls; and opaque document/PDF reading surfaces. Existing typography, reading width, density, pane sizes and accessibility customization remain available.

Native dialogs now have explicit viewport centering, shared compact/standard/wide/settings sizes, internal scrolling, grouped visible actions, focus wrapping/restoration, Escape handling, and genuine-backdrop-only dismissal. The editor outline is a reusable nested list with real-depth indentation, collapse/expand controls, per-note session state, and live caret/scroll section tracking in all three modes. Deep links reveal ancestors without changing the Markdown or collaborative provider.

Appearance v2 normalizes older profiles without restyling other accounts. An additive snapshot column supports an opt-in, account-scoped previous appearance through the existing revision-checked preference API. The modern-look action retains saved themes, text sizes, reading metrics, accessibility choices and device overrides. Palette JSON remains compatible.

## Research editor release

Implemented the approved editor-focused upgrade: a shared 69-command registry, Mod-/ Write/Source toggle with the legacy alias, searchable slash insertion and command palette, a table-size picker, account-synced platform-specific shortcut customization, conflict-aware offline editor preferences, in-place math previews/snippets, editable highlighted code with language/copy/indent/wrap/line-number controls, source-mapped table cells and structure/TSV operations, and styled quote/callout editing. Research insertions cover theorem/proof/definition/lemma/question blocks, citations, footnotes, equation references and linked notes.

Source-range commands and widget edits preserve canonical Markdown and the existing Yjs session. Table cell ranges track collaborative changes; deleted/conflicting cells and uncommitted block metadata use retained-text recovery. Existing appearance/restore-point behavior remains separate. The editor chrome follows the shared semantic colors and sans typography, with opaque reading surfaces, responsive block containers, centered dialogs and dynamically sizing note titles.

Migration 3 adds only the per-account editor-preference table. See [editor behavior and limitations](../EDITOR.md) and [measured verification](../VERIFICATION.md). This does not add spreadsheet formulas, executable notebooks, graphical equation construction or external AI services.

## Unified research workspace release

Implemented the approved balanced design system, six-page app toolbar and contextual Explorer tree; account-owned personal spaces; inherited team/project resource roles; nested folders/notes/files; persistent document tabs and two-pane editor/PDF work; immutable versions, checksummed resumable 1 GB transfers, quotas, reference-aware manual cleanup and streaming portable exports. The original Markdown/Yjs editor, saved history, appearance and research reading tools are preserved.

Research projects include board/list/calendar tasks, subtasks/dependencies, assignments, estimates, milestones, recurrence, discussions, snapshot-bound reviews, workload, activity and in-app/email preference controls. Account pages cover researcher profiles/normalized avatars, people, devices, password MFA/recovery codes, groups/ownership/departure, storage, offline research and exports. Optional OIDC requires an explicit existing-account link with a verified matching email and does not enable public signup.

Migrations 4–7 are additive. The background worker, streamed database/blob backups, lease-fenced jobs, live workspace invalidations and account-neutral production offline shells are included. See [workspace behavior and limits](../WORKSPACE.md), [design criteria](../DESIGN_SYSTEM.md) and [release gates](../WORKSPACE_RELEASE.md). External infrastructure remains separately configurable and unverified until tested in its intended environment.

## Contextual editor and settings refinement

The settings center now uses grouped, searchable navigation instead of the Explorer tree. Appearance and writing drafts survive category changes, preview locally, and apply together through a versioned, revision-checked bundle API. Cancel and the Apply/Discard/Stay leave guard preserve the prior document state. Exact numeric fields, per-category resets, contextual writing previews, per-account offline recovery and conflict choices complete the preference workflow. No database migration is needed; writing schema v1 is normalized to v2 without rewriting stored profiles until Apply.

The editor now has 84 registered commands, keyboard-accessible portal menus and selection formatting, with a persistent toolbar available as an opt-in. Tables use lightweight inline Markdown editors, mapped rectangular selections, safe multiline TSV/HTML paste, context-only structural actions, quiet reorder/resize handles and the parent Yjs undo stack. Code blocks have hover/focus controls, bounded line operations, indentation/bracket assists and independent default/per-block display settings.

Local MathJax 4.1.3 replaces direct KaTeX rendering across editor, reading and HTML-export surfaces. SVG and accessible MathML are generated with isolated macro state, AMS/chemistry and explicit opt-in physics, no external TeX packages, bounded queues/caches and isolated export workers. Last-valid equation previews remain visibly stale on errors; the equation inspector searches TeX/labels and reports reference problems. The parser uses a conservative indexed fast path with full-parser fallback and randomized differential coverage. These are Typora-inspired interactions, not a claim of complete Typora compatibility. See [the editor guide](../EDITOR.md), [refinement checklist](../editor-refinement.md) and [verification evidence](../VERIFICATION.md).
