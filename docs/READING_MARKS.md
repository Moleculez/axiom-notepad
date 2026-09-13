# Reading marks and annotation cards

Reading marks belong beside the document, not inside its Markdown. They do not
change the source, collaboration cursor, shared undo history or exported note.

## Bookmarks

Hover a block and open its right-margin **…** menu, then choose **Bookmark block**.
The menu offers actual parent containers for nested lists, quotes and footnotes.
**Alt+Shift+R** opens the current block's reading menu from the editor. The Reading
marks panel also offers **Bookmark position**, using the selected passage or
current block. Empty documents support a point bookmark.

The bookmark panel supports label/tag/color editing, search, location/recent
sorting, previous/next navigation, individual and selected deletion, Undo, explicit
conflict review, and Markdown/JSON export. The same manager is available under
Settings → Storage → Offline research. Reattachment is performed in
the document: choose Reattach, then the new block's menu → Attach here.

Margin icons identify marked blocks. The far-right overview navigates marks
throughout the note; nearby marks are grouped into a chooser. Hover/focus previews
are passive, and never enter source mode or move the document selection. Clicking
explicitly navigates. Appearance → General controls margin marks and the overview
independently; hiding either does not delete saved marks.
When the [document minimap](MINIMAP.md) is enabled, it owns the overview lane; the
standalone rail returns when the minimap is off. Saved-mark visibility remains
controlled by the reading-marks overview preference.

New block/passage bookmarks use encoded Yjs relative positions and document
generation. Edits before the mark rebase its position. Deleted/replaced content or
a different generation becomes **Needs reattachment**, never a fuzzy match to
unrelated prose. Older heading/scroll bookmarks keep their existing fallback.

## Annotations

Choose **Add annotation** from a block menu or **Annotation** in Reading marks.
New cards are **Only you** by default, including in shared notes and for read-only
members. Cards have an optional title, category (note/question/idea/follow-up),
tags and a Markdown body. Write/Source use the existing Axiom editor with math,
code and list support, in a separate local document—not the shared note's history.
Remote images are disabled in annotation bodies.

Hover previews remain small and read-only. Clicking pins one card. A card floats
beside the page where there is room, otherwise it uses the existing context panel.
Escape/Close retains its draft. Edit, Share and Resolve remain visible; reattach,
private copy and deletion use a compact icon-labeled More menu with separators.
Search/filter the panel by text, visibility, resolved state or missing location.
Switching application tabs hides the pinned card and retains its draft in the
original note's Annotations panel. Background notes still send queued private
changes but do not continually download discussion histories.

**Share with readers** requires confirmation and comment access. A shared card is
the same persisted thread shown in Discussion; there is no duplicate message
store. Participants can reply and resolve/reopen; authors edit their own entries.
Shared-thread removal retains others' replies with a tombstone. Once another
person has contributed, the thread cannot be made private again; make a private
copy instead. A workspace manager cannot inspect another author's private card.

## Durability and privacy

- Drafts and private changes are account-scoped IndexedDB data. Writes are ordered
  so Save/Discard cannot be undone by an earlier pending draft write. Closing a
  card waits for its draft write; a storage failure keeps it open with export/retry.
- Private saves use an outbox. Requests retain their retry identity until the
  server acknowledges them; newer local changes then use the acknowledged version.
  Offline editing/deletion before the first sync is supported. A deleted unsynced
  card may synchronize as a private tombstone; it never becomes shared.
- Shared writes require connectivity and explicit Save/Share. Conflicts retain
  the draft and require review. A private outbox checks the expected visibility:
  if another device shared that card, recovery creates a private draft copy rather
  than silently publishing the disconnected writer's changes.
- Access failures remove the synchronized thread cache, while authored pending
  work remains available for export. Sign-out/dataset changes use the existing
  account-cache cleanup. Browser storage is trusted-device storage, not encryption
  or a way to remotely recall disconnected copies. Server operators still control
  the database and backups.
- Private bodies are not broadcast in collaboration awareness, shared note text,
  workspace notifications, normal file exports or group activity. Existing MCP
  comment reads/creates go through the same account/workspace authorization rules.
- Personal JSON export includes locally cached owned cards, drafts and pending
  changes. It is a recovery artifact, not a full server backup or an import format.

## Implementation and deployment

Migration **19** extends the existing `comments` table additively. Existing rows
remain shared, plain-text discussions; bookmarks retain their personal reading
records. Apply normal migrations before serving this version (`npm run db:migrate`
for a local install; the deployment migration step for a server). Do not reset data.
Appearance schema **7** introduced `readingMarkMargin` and `readingMarkOverview`,
both enabled by default. Current schema **8** retains them and adds the optional
minimap, with older read projections and stale-write protection.

`note-comments.ts` owns schemas/content normalization; `note-comments-api.ts` owns
authorization, private/no-store reads, versions and idempotent writes.
`annotations.ts` owns relative anchors; `reading-marks.ts` owns block target kinds.
`note-marks-store.ts` owns local drafts/outbox/cache. `ReadingMarks.tsx` coordinates
the document margin/panel, with `BookmarkManager`, `AnnotationEditor` and
`AnnotationCardActions` owning their respective interactions.

`reading-marks.css` uses opaque paper and semantic fonts/colors/radius/shadow tokens.
It does not reuse PDF annotation-card selectors. No extra editor dependency,
document syntax, mobile redesign or automatic public sharing is introduced.

## Verification

Unit coverage is in `tests/reading-marks.test.ts`; isolated full-app workflows are
in `tests/e2e/reading-marks.spec.ts`. Run against local staging, never production:

```sh
npm run staging -- migrate
npm run staging -- build
# Separate terminals:
npm run staging -- web
npm run staging -- sync
TEST_APP_URL=http://localhost:3004 npm run test:e2e -- tests/e2e/reading-marks.spec.ts
```

See [current measured results](VERIFICATION.md) for the latest run and remaining
target-device/browser gates. Automated desktop checks do not certify physical
IME, assistive technology, operating-system printing or every clipboard provider.
