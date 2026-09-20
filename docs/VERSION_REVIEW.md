# Version and review workbench

Markdown, Math Studio and Image Studio share an in-file history workspace. It keeps
the editor mounted but inactive beneath the comparison: inspecting history never
rewrites the accepted document. This is a controlled-beta review workflow, not full
Google Docs tracked-changes or Git branching parity. See [executed checks and
remaining acceptance gates](VERIFICATION.md).

## Compare and recover

Open **Document history**, **Checkpoint history**, or **Image version history**.
Choose any two revisions using Before/After. The timeline includes automatic
snapshots, named milestones, saved image versions and existing source-only history.
Filter loaded entries by name/author or named-only; Load more pages older entries.

- **Rendered / Source** and **Side by side / Unified** compare Markdown and LaTeX.
  Unified Markdown shows unchanged blocks once and interleaves removed/added blocks.
  Nested lists, tables and equations remain whole, using the existing reading theme.
  Source comparison includes line numbers, word changes, unchanged-context expansion,
  whitespace-only-line hiding and previous/next change navigation.
- Current text is **captured once** on opening, not continuously replaced while a
  collaborator types. **Refresh comparison** explicitly captures again. Restoration
  checks the captured source hash, generation and math settings; changed content
  stops the operation and asks for a refresh instead of overwriting it.
- **Name milestone**, **Rename**, **Export before** and **Open as copy** preserve
  immutable contents. Renaming has a metadata version check. Restoring creates a
  retained **Before restore** milestone first. Text restore starts a new generation;
  the preceding source remains available in history.
- Math checkpoints include source and rendering settings. Checkpoint actions also
  save pending settings with a version check. Restoring an older source-only entry
  leaves current settings unchanged; newer entries restore both. Unsaved settings
  changed elsewhere must be reconciled before saving, not silently merged.
- Image comparison has split/wipe views, zoom/Fit, preview dimensions, layer metadata
  when available, and identical-byte indication. Image Studio can compare its flushed
  cloud working draft against a saved version. Restore atomically preserves that
  draft as **Before restore**, publishes a new restored version and releases draft
  heads. Explorer refuses a generic restore while an image draft/editor is active.

For very large changes, comparisons are deliberately bounded. Above 200,000 source
characters the UI uses source view; the lossless diff falls back to coarse regions
above its operation/size budget. Initially 200 source rows are mounted; Load more
expands them. Individual exceptionally long lines have abbreviated previews. Exports
retain the complete source. These limits are not evidence of million-character
visual-editing performance.

## Suggest without changing accepted work

Open **Review suggestions → Suggest edits** in a Markdown note or Math Studio.
The same Axiom visual/source editor (or Math Studio visual/source surface) edits an
isolated proposal. Format text, insert a table, link a note or attach a file using
the proposal toolbar. Publishing shares a proposal for review; it does **not** put
the proposed changes into the accepted document.

- Commenters and editors can propose, revise their pending proposals and reply.
  Editors accept/reject; authors may withdraw their own proposals. Clearing every
  change removes the pending proposal. Viewer access never permits proposing.
- Accepted changes use CRDT-relative anchors plus exact original text. No fuzzy
  replacement is used. Unrelated peer edits can rebase; a changed/deleted target or
  old document generation is marked **Needs attention** with recovery available.
- Select disjoint proposals for atomic bulk acceptance/rejection. An overlapping
  or stale batch changes nothing. **Undo last decision** is guarded by author,
  generation, proposal versions and unchanged inverse ranges. Buttons wait for the
  refreshed proposal versions after a decision; an old card cannot be resubmitted.
- Proposed source and review messages are saved in account-scoped IndexedDB and
  published through an idempotent outbox. Offline authoring can be closed/reopened;
  reconnect republishes retained work. Decisions and replies require connectivity.
  Sign-out stops publishing without sending the former account's recovery as a
  different account. Only one tab may own an editable proposal at a time.
- If browser storage is denied/full, keep the editor open and export recovery.
  Clearing site data removes device-only drafts. Reply text is retained in the open
  reply form on a failed send, but is not a durable offline reply outbox.

[Assistant-generated drafts](WORKSPACE_ASSISTANT.md) use the same editor but require
an explicit **Publish proposal**; edits, reload and reconnect never auto-publish them.
They retain private-context provenance for access checks and wait for the captured
CRDT state before resolving anchors on a fresh page load. Ordinary manual suggestions
retain their existing automatic outbox behavior.

Proposals are shared with permitted collaborators, not private notes. The private
part is their separate editing projection before publication. Review cards display
insertions/deletions; accepted pages do not yet show a Google Docs-style inline
tracked-changes overlay. Large cards abbreviate their preview and offer full JSON
export. Image pixels use versions, not concurrent suggestions or collaborative paint.

## Research reviews and changes since a visit

**Request review** assigns a saved Markdown/math milestone or immutable image version
to a permitted collaborator with a message. **Review inbox** collects assignments,
requests and pending suggestions across accessible spaces. Compare the pinned
revision, approve it or request changes. Approval is advisory: it never accepts a
proposal, rewrites source or locks a document. Request cancellation and response
permissions are rechecked on the server. Notifications and metadata-only Audit
events record the workflow; no email delivery is implied.

Markdown and Math Studio remember the previous visit's server revision for 30 days.
It stays fixed during the current editing session. Select **Previous visit** in
history to see what changed; **Mark reviewed** saves the compared server revision as
the next baseline. This personal read action uses HTTP and validates the captured
hash/settings; an editing-socket reconnect does not block an already-durable marker.
Image review baselines use saved versions, not expiring draft
heads. An image working draft must become a milestone before being marked reviewed.

## Save, storage and recovery contracts

Accepted text remains `Y.Text('markdown')`. Immediate local journals and committed
server updates remain the durability boundary. Selection and presence changes are
not authored edits. A shared single-flight save coordinator coalesces confirmations
after 1.5 seconds idle / 5 seconds maximum, skips clean revisions and forces a fresh
acknowledgement after reconnect. Explicit save boundaries wait for newer edits made
during an in-flight save; a late acknowledgement cannot certify a newer connection.
Disconnected requests fail promptly rather than holding the next connection's queue.

Automatic text checkpoints use the existing durable pending queue: 60 seconds idle
or 5 minutes of sustained activity. Only changed source/settings create a snapshot.
Unlabeled snapshots older than 30 days may be pruned unless a review retains them;
named milestones are retained. This is not one immutable version per keystroke.

Image working drafts save after 3 seconds idle / 15 seconds maximum. Layer/mask PNGs
are cached by canvas identity and invalidated by pixel operations. Metadata-only
edits reuse uploaded layer assets; changed pixels upload binary PNGs, not base64
whole-project JSON. A single-flight queue, bounded upload concurrency, content hashes,
90-second fenced edit lease, head revision and published-version checks protect saves.
**Save version** remains the explicit immutable publication boundary.

The current and preceding image manifests are recovery heads. **Recover previous
cloud draft** first retains a local recovery copy and checks the latest head before
replacing the working canvas. It does not alter saved milestones. Both heads count
toward storage, are included in database/file backups, and protect their layer/mask
and preview assets. Unreferenced uploads expire after 24 hours in bounded maintenance
batches; deletion goes through the existing reference-safe blob worker. Pending
proposals retain referenced immutable attachments. Reversible decisions retain both
directions' attachment versions independently of live source indexing until undone
or their document is removed. Last-visit
records expire after 30 days. Cross-browser PNG encodings need not be byte-identical
after Undo; pixel content is the recovery contract.

## Maintainer map and deployment

| Boundary                                 | Main implementation                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| History UI and worker comparison         | `apps/web/components/revisions/`, `apps/web/lib/revision.worker.ts`                     |
| Lossless diff, rows, atomic block groups | `packages/shared/src/version-diff*.ts`                                                  |
| Accepted revision commands and room gate | `packages/shared/src/revision-command.ts`, `apps/sync/src/server.ts`                    |
| Proposal projection and durable outbox   | `apps/web/lib/suggestion-projection.ts`, `suggestion-outbox.ts`, `latest-checkpoint.ts` |
| Role/version/anchor enforcement          | `packages/shared/src/revision-api.ts`, `suggestion-hunks.ts`                            |
| Assignments, responses and inbox         | `packages/shared/src/resource-review-api.ts`                                            |
| Image queue and cloud protocol           | `apps/web/lib/tools/image-cloud.ts`, `packages/shared/src/image-cloud-api.ts`           |

Migrations **21–24** add revision metadata, proposals/decisions, review targets,
read cursors, image assets/heads, proposal/Undo attachment retention and metadata caches. Upgrade
web, sync and worker together after a matched database/file backup. Keep one sync
service as in the existing deployment architecture. No editor dependency was added
or swapped for these features. Controls use existing semantic colors, typography,
dialog conventions, labeled icons and reduced-motion/forced-color styles.

Browser mutations use isolated staging on **3004/1236**. Never reset or seed the
working development database. See [Verification](VERIFICATION.md) for current evidence
and [Deployment](DEPLOYMENT.md) for backup/restore and production acceptance.
