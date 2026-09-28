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

Open a workspace and choose **Research**, between **Overview** and **Files**.
Its five views are **Summary**, **Library**, **Reading queue**, **Evidence** and
**Knowledge graph**. Research is no longer in Quick access. Old Research,
library and graph links redirect to the appropriate workspace and view.
The workspace is the scope: no second group/workspace selector is needed.
Search and page through results. Summary includes saved reading positions;
Evidence defaults to your PDF annotations and personal bookmarks; switch to
Shared annotations or All accessible evidence when reviewing a team's sources.

Standalone PDFs do not need a bibliography entry to have a private reading
status. Use Want to read, Reading, Read or Archived. Status changes use the
existing device-local outbox and revision-conflict handling. The queue also
includes accessible references and current PDF versions without a recorded
status, shown as Want to read. Replaced PDF versions retain their own reading
records; annotations and bookmarks still link to their exact versions.

## Manage your reference library

Each workspace owns a separate bibliography. Your personal workspace is private;
team and restricted workspaces follow their own content access. Workspace viewers
can read and maintain their own reading statuses; only workspace editors can
change shared references. A group-management role alone does not grant content
access. The Library table supports title/year/venue sorting,
50-row pages, author/year/tag/status filters and personal saved searches. Select
a title to open the resizable details panel. Fields, original import records,
linked notes, actual citation usage and pinned PDF versions stay together.
Advanced author/year/status fields are behind **Filters**; its indicator shows
when filters are active. In compact desktop split panes, the table prioritizes
title, year and reading status; venue and PDF details remain in the inspector.

Create nested collections, collapse them, and drag selected references onto a
collection. Collections group entries without copying them. Select references to
apply reading statuses, tags and collection membership, copy citations, export
BibTeX/RIS, copy metadata to another library, or move entries to Library Trash.
Restoring a reference preserves its identity. Removing a collection does not
delete its references. Library Trash deliberately has no permanent-purge action.

Import accepts up to 1,000 entries / 2 MB and always previews parsed records,
duplicate matches and renamed keys before writing. Existing references are not
overwritten. DOI/arXiv lookup is explicit and sends only the identifier to its
provider. RIS exports preserve original unmapped RIS fields; BibTeX exports retain
original entry types and untouched fields. Cross-format conversion is not lossless;
the original imported record remains available in Details.

Use Duplicates or select 2–20 entries to review a merge, choosing the retained
entry and each metadata field. Old citation keys and reference URLs redirect to
the retained record; Markdown is not rewritten. Tags, file links and collections
combine, while each reader retains their own latest status. Stale previews and
edits report conflicts. Copying personal metadata into a group requires audience
confirmation and never copies files, annotations, access permissions or history.

## Explore actual connections

The Knowledge graph shows Markdown notes, bibliography entries and PDF versions.
Edges represent explicit note links, citations and linked sources—not AI-inferred
similarity. Search highlights matches; filter by source type, tag or collection,
show unconnected sources, or inspect one/two-hop neighborhoods. Click a node to
inspect; double-click to open. Pan by dragging, zoom with Ctrl/⌘ + wheel, and use
Fit, reset layout, fullscreen or the accessible list. Node positions are local
presentation, not content changes. Export the visible graph as SVG, PNG or JSON.

Graphs are bounded to 1,000 sources / 5,000 connections. Narrow the context when
the truncation notice appears; local neighborhoods/search apply to that loaded
graph. Citation backfill runs in resumable worker batches after upgrade and normal
note saves update the index transactionally. Existing note citation snapshots take
precedence, so moving/copying notes does not silently change their bibliography.

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

## Resolve protected items in Trash

Trash distinguishes **Ready** items from those that **Need attention**. An empty
Trash preview does not delete anything.

For a quick, explicit cleanup of a stored file, choose **Remove protection &
purge…** in its Trash menu or beside it in the deletion preview. One compact
confirmation shows the affected protections and stored versions. It can remove
your reading data, release attachment retention from notes and saved history in
workspaces you manage and edit, and detach library file associations you can edit.
References, notes and revision text are kept. If notes or history link to the
file, acknowledge that those links will stop working. Type **DELETE FOREVER**
and confirm: protection removal and file deletion happen together, or neither
happens if the file, access or protection changed. This shortcut affects one
stored file at a time and cannot be undone.

It cannot override other readers' private records, inaccessible sources, PDF
annotations, task or formal-review evidence, reusable snippets, active image
drafts, unfinished uploads or saved edits awaiting indexing. The preview explains
any remaining blocker; no protection is silently removed.

For selective recovery instead, open **Review protection** to see what is keeping
a file:

- **Your reading data:** review your bookmarks, reading-list entries and saved
  page positions, acknowledge their removal, then choose **Remove my reading
  data & recheck**. This removes only the displayed versions of your own records;
  it does not delete the file, someone else's records or PDF annotations.
- **Notes & saved history:** open the retaining note. Removing a current link
  does not erase saved revisions, suggestions or undo history. Restore the file
  if those revisions still need it. When a retaining note is itself in Trash,
  selecting it and its attachments together permits cleanup only if nothing
  outside that selection retains them.
- **Reference library / research evidence:** open the source to review its file
  association. Formal review evidence remains protected even from quick purge.
  Restricted sources and other readers' private data are not exposed.

Use **Restore file** when you want to keep the evidence. Ordinary restore returns
items to their original folder, falling back to workspace root if that folder is
unavailable; Options can retain them instead. Name conflicts keep both by default.

**Recheck** refreshes protection using saved server edits. It does not synchronize
unsaved notes on other devices. After resolving protection, the confirmation
for ordinary cleanup appears only when there are ready items. Type DELETE FOREVER to remove those items;
everything else stays in Trash. Completed operations can be rechecked without
repeating completed deletions or adding newly trashed files. There is no automatic
expiry, and total stored size is not guaranteed reclaimed space (blobs may be shared).

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
- Migration **38** makes bibliography and collections workspace-owned. Original
  IDs stay in the main/personal workspace; other workspaces receive independent
  copies of references they already cite or link, including aliases and required
  collection ancestors. Original Markdown and citation snapshots are unchanged.
  Reading states remain private. Older pending local reading edits resolve their
  owning workspace before syncing; inaccessible edits remain available for export.
- Canonical APIs accept `spaceId`; compatibility group-only calls resolve only to
  the group's main workspace. Never use a group role to authorize library content.

Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run docs:check`, and an
isolated production build. The focused browser suite
`tests/e2e/documentation-research.spec.ts` refuses any origin other than disposable
staging on port 3008. Start its web, sync **and worker** services; uploads remain
in verification until the worker is running. Never run mutation tests on working
research data. Browser testing does not replace physical IME, clipboard, assistive
technology or deployment-specific acceptance.
