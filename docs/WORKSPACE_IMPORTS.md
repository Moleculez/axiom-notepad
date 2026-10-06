# Import Markdown and research collections

## Everyday workflow

Open a workspace's **Files** view or **Explorer → Add files**. Choose **Import
Markdown…**, **Import Canvas…**, **Import folder…** or **Import ZIP…**. Folder context menus and
Search & commands open the same dialog in the current destination.

1. Choose a collection and an editable destination. Review its workspace audience
   and folder breadcrumb. Nothing is uploaded while inspecting local files.
2. Review the hierarchy, proposed names, excluded items and local **Preview / Source**.
   Preview uses the shared Markdown editor without collaboration, external images
   or link navigation; it does not fetch research from referenced URLs.
3. Choose **Keep both**, **Merge folders** or **Skip matching**. Keep both adds
   numbered copies; Merge reuses unambiguous matching folders but copies conflicting
   files; Skip leaves matching items and their skipped descendants untouched.
   No policy replaces an existing note or file.
4. Confirm **Import collection**. Preparation stays private to its author until
   every required item is verified. The worker publishes the complete collection
   in one database transaction, then the dialog offers **Open folder / file**.

`.md` and `.markdown` become native, editable collaborative notes, including empty
notes. `.canvas` becomes a native board with fresh card/connection IDs and a visible
exact-byte supporting original. A declared [portable collection](PORTABLE_COLLECTIONS.md)
also restores native math/text/image projects and safe metadata. Plain `.tex`/`.txt`
files without a collection declaration remain attachments; tools are not guessed
from arbitrary configuration. Invalid Canvas or declared native project contents
require **Keep as attachment** or **Skip**; unsafe manifests/versions are rejected.
Other files become immutable attachment versions with byte-detected MIME,
checksums and the existing protected viewers. Folder structure is retained. ZIP
and dropped-folder imports preserve known empty directories; browser folder
pickers cannot report them. Imports do not restore accounts, permissions, history,
annotations, preferences, plugins or the original IDs. This is not a full backup
restore and does not execute imported scripts or configuration.

**Upload files / Upload folder** remains separate: it stores raw files, including
Markdown, rather than creating editable notes. Ordinary file drops in Explorer
retain that raw-upload behavior; drop into the import dialog to import notes.

## Links and source fidelity

Included relative note, image and attachment links resolve from each original
source file's directory. Inline destinations, reference definitions, wiki aliases
and links inside quotes, lists and footnotes use parser-owned source spans. Notes
receive UUID links; attachments receive exact version links. Hash fragments are
retained. Labels, titles, code examples, other text, line endings and UTF-8 BOM
remain unchanged. The new notes are indexed for links, references and citations
through the same native persistence path as ordinary notes.

Missing, ambiguous or skipped targets are not guessed: their source is retained
and unresolved links appear in the completion receipt. Extensionless note links
resolve only when exactly one included `.md`/`.markdown` target matches. Absolute
paths and external URLs are unchanged. Original UUID/version links bind only to
included manifest identities; other UUID links are retained and reported. Relative link query
parameters are not imported; hash fragments are retained. Viewer interpretation
of attachment fragments depends on that viewer. A link never grants access.

## Interrupted work and cancellation

**Activity & recovery** contains Imports beside existing upload transfers. Close
the progress dialog to continue working. **Pause** stops this browser's transfer;
**Resume import** reuses retained originals, or asks you to reselect the same
collection after a reload. Saved part checksums detect a changed original before
reuse. Private preparation expires after **seven days**.

The accepted manifest, destinations, exact IDs, part receipts and publication
intent persist on the server. Completed start/finalize retries return the same
receipt instead of duplicating records. The worker may finish publication after
the browser closes. Terminal receipts cannot be replaced by late background
status reads; paused transfers do not keep an idle polling timer alive.
A changed destination or quota blocks publication without
partial contents: **Review destination** shows the fresh plan and requires explicit
approval. Access changes are rechecked before each transfer and publication.
Only the author can inspect/discard their private preparation, including after
destination access is revoked; this grants no further editing authority.

**Cancel import** discards preparation and releases reservations. A cancellation
racing publication either wins before the complete transaction or returns its
completed receipt; it never deletes already published files. Staging and orphan
blobs are cleaned by guarded worker jobs, not by deleting shared evidence.

## Bounds and archive safety

| Bound                            | Current limit                                                           |
| -------------------------------- | ----------------------------------------------------------------------- |
| Files and folders per collection | 2,000 combined                                                          |
| Folder nesting                   | 32 levels                                                               |
| Supporting file                  | 1,000,000,000 bytes (decimal 1 GB)                                      |
| Native source                    | 1,000,000 characters per document; 5,000,000 for Canvas; 25 MB combined |
| ZIP                              | 50 MB compressed; 100 MB expanded; 1,000 archive entries                |
| File names / relative paths      | 200 / 4,096 characters                                                  |
| Transfer part                    | 8 MiB; SHA-256 checked on both sides                                    |
| Preparation lifetime             | Seven days                                                              |

Markdown must be valid UTF-8 and cannot contain binary nulls. Paths normalize to
Unicode NFC; absolute paths, traversal, backslashes, control characters, ambiguous
case/Unicode names and incomplete hierarchies are rejected. System/development
files and likely credentials/private keys are excluded and listed. This exclusion
is a precaution, not a guarantee that every secret has been detected—review your
collection before confirming a shared destination.

ZIP preflight examines original central-directory names before JSZip can sanitize
or collapse them. Encrypted archives, symlinks/special files, unsupported ZIP64 or
multi-disk layouts, inconsistent headers, duplicate paths, excessive expansion and
invalid UTF-8 names are rejected. Streamed extraction checks actual size and CRC.
Inspection/checksumming runs in a dedicated worker using bounded 8 MiB file slices,
not a whole-1-GB allocation. No server archive extraction or host path writes occur.

## Architecture and operations

Migration **43** adds account-owned `workspace_imports`, entries and private upload
bindings, plus the `staged` transfer state. Existing ordinary-upload routes cannot
publish, cancel or retarget import-owned sessions. Preparation counts against the
existing logical quota and physical storage budget. Publication rechecks the
destination, permissions, revisions and quota under the scope/batch/upload lock
order. New resources, native note/Yjs state, attachment versions, derived indexes,
audit and the completion receipt commit together. Unexpected failures roll back
the transaction; bounded job retries retain private preparation.

The inventory digest is SHA-256 of concatenated lowercase SHA-256 **part digests**
(empty files use SHA-256 of an empty string). It is a bounded resume identity, not
the whole-file SHA-256. The worker independently verifies actual stored bytes and
records the true whole-file checksum for published attachments.

Portable manifests additionally declare expected whole-file SHA-256 for sources
and assets. Local inspection and server staging both verify these values; they
do not replace the separate part-digest identity or grant access. Checksumming of
duplicate Canvas/original blobs is reused within one worker inventory.

The API lives below `/api/v1/spaces/:spaceId/imports`: read-only `POST /preview`,
`POST /` with `{id, manifest, fingerprint}`, owned batch status, explicit `POST
/:id/recheck`, `POST /:id/finalize` and `POST /:id/cancel`. Entry preparation,
checksummed parts and completion live below `/:id/entries/:entryId`. `/me/imports`
provides the owner's recovery ledger; `?compact=1` omits full plans/receipts from
repeated status checks. All mutations keep the existing origin/session guards.

Back up database and blobs, apply migrations, and restart matching web, sync and
worker code before enabling the new UI on an existing installation. Keep the
workspace worker running. Imports need connectivity; preparation is not an
offline outbox or end-to-end encrypted vault. Local-storage automated acceptance
does not certify S3 multipart behavior: run empty-file, interruption, checksum,
resume, quota and cancellation checks against the deployment's actual bucket.
Paired backups preserve published notes/files, not private import staging.
Restoring a backup cancels its unfinished imports/transfers and clears missing
part receipts; choose the original collection for a new import. Completed receipts
remain unchanged, and restore never aborts the original installation's multipart
handles or deletes its storage.

## Verification and UI contract

Use isolated database/storage only. `npm run plugins:staging -- verify-imports`
checks private preparation, native persistence, hierarchy/links, retry/resume,
auth/quota changes, expiry, actual database rollback, cancellation races and
workspace-purge protection/cleanup. Folder-only private preparation protects
workspace removal too; completed/cancelled receipts do not retain a deleted scope.
`npm run plugins:staging -- test --config imports.config.ts` supplies the guarded
database/storage identity for disposable ports **3004/1236**, with Chromium,
Firefox and WebKit. `tests/workspace-import*.test.ts` exercises pure contracts,
source-span rewriting and ZIP/inventory rejection. See the dated
[verification record](VERIFICATION.md); these commands are not authorization to
run mutation tests against working research data.

Keep one shared importer, not separate implementations per entry point. Use the
native Dialog/Field/Picker controls and shared theme tokens. Header and action
footer stay outside the scrolling body; hierarchy and source preview own their
scrollports. Display destination/audience and consequences before confirmation.
Background transfer polling stays quiet, releases page/account lifetimes and
must not activate the foreground progress bar or request status while offline.
Load the preview engine on demand without changing the review pane's geometry.
Never mount a collaboration provider or allow remote media in local preview.
Test all five interface styles,
both modes, large UI text, keyboard, forced colors and reduced motion; inspect
actual screenshots. Physical file-picker/drop and assistive-technology checks
remain manual gates.
