# In-app guide and evidence workbench

## Find the guide

**Docs** sits immediately to the left of **Search & commands** in the app toolbar.
It opens `/workbench/docs` inside the authenticated workbench, keeping the workspace
sidebar in place. Thirty guides cover the Markdown editor, Canvas, PDF research,
studios and viewers, files, groups, planning, publishing, the assistant, MCP,
offline behavior and appearance. These are user guides, not public website pages.

Chapter navigation, full-text guide search, section links and breadcrumbs support
direct article URLs such as `/workbench/docs/editor/math`. Search & commands also
finds guide titles and feature keywords. The shortcuts article uses the editor's
actual command registry and the current account's effective keyboard preferences.

Editor examples reuse the Settings scratchpad, with Write/Source/Read, Reset and
Copy Markdown. The Canvas example uses the real card, connection, layout and
undo engine. Open an example explicitly; leaving its article or closing it
discards the document. Only the active example is mounted. Neither example
creates files, opens a sync provider, stores a document in IndexedDB, uploads
content, calls an AI provider or fetches workspace-file previews. External media
and workspace actions are disabled. Copy/download exports are explicit actions.

## Work with evidence

**Reference library** is now in sidebar Quick access. Its existing shared
bibliography, imports, lookups and citation links remain available. Research is
an evidence workbench with **Overview**, **Reading queue** and **Evidence** views.
Choose Personal or a group, optionally narrow a group to a workspace, search,
and page through the results. Overview includes saved reading positions;
Evidence defaults to your PDF annotations and personal bookmarks; switch to
Shared annotations or All accessible evidence when reviewing a team's sources.

Standalone PDFs do not need a bibliography entry to have a private reading
status. Use Want to read, Reading, Read or Archived. Status changes use the
existing device-local outbox and revision-conflict handling. The queue also
includes accessible references and current PDF versions without a recorded
status, shown as Want to read. Replaced PDF versions retain their own reading
records; annotations and bookmarks still link to their exact versions.

## Create a synthesis deliberately

1. Select up to 50 papers, references or PDF annotations. Bookmarks and reading
   progress are navigation aids, not synthesis sources.
2. Choose **Create from evidence**, name the new file, choose Research note or
   Evidence Canvas, and select an editable destination workspace.
3. Preview the exact draft. Notes contain question/evidence/findings/open-question
   sections. Canvas creates question, quotation and pinned source cards with
   provenance connections. Its preview is an isolated, read-only Canvas.
4. When private evidence is copied into a shared workspace, explicitly acknowledge
   the audience change. Source links do not grant access to originals.
5. Create the new file. Cancel and preview never create a file. A changed source,
   destination or permission requires a fresh preview. Retry uses the same file
   identity and mutation key, rather than creating another copy.

This is deterministic scaffolding, **not AI synthesis or a scientific conclusion**.
Copied annotation text is escaped as evidence rather than interpreted as embedded
Markdown commands. Shared annotations are visible only to readers of their
source; private annotations are only available to their author. The server, not
the browser's selection, supplies the authoritative evidence text.

## Contributor contracts

- `packages/shared/src/documentation.ts` is the lightweight route/search catalogue;
  `apps/web/content/doc-articles.ts` contains bundled Markdown and safe samples.
  Add both together and keep the catalogue test passing. Do not add executable
  MDX, account identifiers, secrets or remote demonstration assets.
- `EditorPlayground` is shared by Settings and Docs. `CanvasSurface` accepts a
  document session; only the connected `CanvasStudio` wrapper invokes the cloud
  document hook. New Canvas capabilities must respect the sandbox boundary.
- `research/workbench` uses a bounded, keyset-paginated query with shared scope
  predicates. It does not load full note bodies or make a request per row.
- Synthesis preview/create reuse the same resolver and deterministic builder.
  Creation uses existing file idempotency, capacity, audit and collaboration
  initialization. A server-only creation guard locks evidence and rechecks its
  hash and permissions inside that transaction. Do not move this check to the UI.
- Existing reading tables support PDF statuses; no new database migration is
  required for this increment. Current migration level is **34**.

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run docs:check`, and an
isolated production build. The focused browser suite
`tests/e2e/documentation-research.spec.ts` refuses any origin other than disposable
staging on port 3008. Start its web, sync **and worker** services; uploads remain
in verification until the worker is running. Never run mutation tests on working
research data. Browser testing does not replace physical IME, clipboard, assistive
technology or deployment-specific acceptance.
