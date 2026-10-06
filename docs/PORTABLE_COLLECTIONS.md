# Portable research collections · v1

Stage 5 implements file-level interoperability and expiring extension consent.
The source implementation is available; database, worker and desktop-browser
acceptance remains pending. See the dated [verification record](VERIFICATION.md).
Stages 3–4 are still unaccepted, and third-party extension gates remain default-off.

## Export, inspect, restore

Select files or a folder in **Workspace → Files** or Explorer, then choose **Export**
from its menu or selection toolbar. **Reimportable research collection** is the
dialog default. **Standard archive** retains the existing larger export workflow;
the API defaults to standard for existing clients. Canvas export also offers both
profiles and can capture the selected cards or whole board.

The existing durable export job prepares a consistent, permission-checked snapshot
in the background. Download it from **Settings → Downloads / exports**. Folder
descendants, accessible exact-version assets and Canvas file-card dependencies
are included within the budgets below. The job fails instead of publishing an
archive that exceeds the reimportable profile's limits. Asset streams verify
actual bytes and SHA-256 and propagate corruption to the failed job. Permission
is checked again after preparation and before downloading. An export is not sharing.

Use **Add files → Import ZIP…** for the archive, or extract it locally and choose
**Import folder…**. The same importer supports standalone **Import Canvas…** and
Markdown. Local inspection runs in a worker; it does not upload, synchronize,
execute configuration, fetch linked websites or load external preview media.
Review destination/audience, names, format, preservation messages and exclusions.
Unsupported or malformed native projects require **Keep as attachment** or **Skip**
before confirmation. Keeping an attachment does not apply project settings.

Preparation is private and resumable. Publication creates the complete reviewed
collection in one transaction using the existing import ledger, quota reservation,
upload receipts and worker. Matching-name policies never overwrite existing files.
After a reload, reselect the original collection; accepted conversion choices,
metadata, target identities and publication intent remain frozen. Changed bytes
cannot replace the reviewed original. See [import recovery](WORKSPACE_IMPORTS.md).

## What travels

| Content                   | Restored behavior                                                     |
| ------------------------- | --------------------------------------------------------------------- |
| Folders                   | Hierarchy and known empty directories; safe names, descriptions, tags |
| Markdown                  | Native collaborative notes; source-backed destination remapping       |
| Canvas                    | Native board; fresh node/edge/file identities and included asset pins |
| Math                      | Native LaTeX source and validated Math Studio settings/macros         |
| Text                      | Native UTF-8 text source                                              |
| Image projects            | Validated Axiom layer bundle opened by Image Studio                   |
| Supporting files          | New immutable asset versions with true whole-file SHA-256             |
| Older included asset pins | Separate logical files, labeled with their original pin               |

Tool settings are strictly allowlisted. Imported settings never select an account
theme, enable extensions or configure providers. Canvas cards retain supported
geometry, connections, names, colors, tags and Markdown. Unknown document/card/
edge properties are reported and not applied. The **exact original Canvas bytes**
are kept as a visible supporting file in an `_originals` folder beside that board.
Generated original paths are deterministic across reselection; this supports resume.
Original files can contain vendor data, EXIF or other sensitive embedded metadata:
review them before importing into a shared audience or redistributing an archive.

Imports allocate fresh resource, asset and collaborative identities. They do not
restore accounts, permission grants, old collaboration rooms, revision history,
discussion, annotations, bookmarks, planning or bibliography-library records.
Citation source is preserved but its reference records must be imported separately.
Shortcuts are not recreated. Children owned by a document become a supporting
folder beside the document, with an explicit preservation warning. A portable
collection is **not** a paired deployment backup; use [backup/recovery](DEPLOYMENT.md)
for that purpose.

Markdown import and export patch parser-owned destination spans only, including
definitions, wiki links, lists, quotes and footnotes. Labels, titles, code, BOM and
line endings stay unchanged. Exported URL destinations percent-encode filenames;
Canvas file paths remain literal. Unavailable/skipped/ambiguous targets are retained
and reported, not guessed. Native original IDs bind only to included imported files;
an unresolved Canvas card cannot retain authority to its old workspace resource.

## Manifest and budgets

`axiom-manifest.json` declares `format: "axiom-collection"`, `version: 1` and
`scope: "files-and-metadata"`. Each logical resource has an ID, relative path,
kind, optional native source format, parent and safe metadata. Primary source/asset
artifacts declare the matching resource, byte size and lowercase SHA-256; immutable
assets may also declare their original version. Derived/settings/original sidecars
are checked but not promoted into additional editable notes. Undeclared archive
content is excluded and reported. IDs and hashes are data integrity, **not** a
publisher signature or permission credential.

The incremental browser hash uses pinned `@noble/hashes` 2.4.0; its
[MIT notice](../apps/web/public/licenses/noble-hashes.txt) travels with the web assets.

The shared schema rejects unsafe/ambiguous paths, cycles, missing parents/primaries,
unsupported versions, mismatched formats and authority/configuration fields.
Whole-file SHA-256 is checked locally and again against verified staged bytes.
It is distinct from the existing digest-of-part-digests used for resumable transfers.

| Reimportable profile                       | Limit                            |
| ------------------------------------------ | -------------------------------- |
| Compressed ZIP                             | 50,000,000 bytes                 |
| Expanded ZIP, including manifest           | 100,000,000 bytes                |
| Entries, including folders and manifest    | 1,000                            |
| Combined native source                     | 25,000,000 bytes                 |
| Manifest                                   | 2,000,000 bytes                  |
| Native document / Canvas source            | 1,000,000 / 5,000,000 characters |
| Folder depth / linked-dependency traversal | 32 / 8                           |

The builder streams assets and output with independent actual-size limits, never
forces ZIP64, and never downloads arbitrary links. If a collection exceeds a
budget, choose a smaller selection or Standard archive. ZIP64 remains rejected by
the importer: extract a trusted archive locally and import the folder within the
existing 2,000-item inventory and native-source limits. An extracted folder is not
subject to the ZIP compressed-size limit. Legacy `workspace-manifest.json` and
`canvas-manifest.json` v1 exports are recognized in extracted folders or supported
ZIPs. Missing source checksums/metadata are disclosed; supplied hashes are verified.
Lossless Canvas snapshots are preferred to derived outlines/interchange files.
Available pinned files remain separate; ambiguous unpinned legacy links are not guessed.

Image projects use the native 36 MB bundle, layer/pixel/dimension checks plus
bounded ZIP preflight/CRC. This is format validation, not a claim of image-decoder
or third-party-parser security certification. Upload and media-viewer restrictions
remain in effect.

## Extension consent and relay

Migration **48** adds **30-day** member grants and group approvals, with a full
30-day upgrade grace for existing records. Normal backed-up upgrades apply it;
rerunning migrations does not renew old consent. Group approval and individual
consent still bind to an exact package hash, revision, capability subset and scope.
The earlier expiry wins. **Renew approval** and **Renew permissions** require explicit
review and advance their existing revision fences. Old queued proposals do not
revive, and no worker restarts automatically. Completed research remains intact.

Every broker call, review and queued mutation checks current server authority and
expiry. The host also stops a running or idle worker at effective expiry, including
intervals beyond the browser's maximum single timer duration. See
[extension authoring and security](EXTENSIONS.md).

The trusted opaque frame validates worker messages before the second clone into
the application: plain JSON, bounded depth/nodes/string size, **8 MiB per message**,
**8 in-flight requests**, **32 MiB per command**, **100 protocol messages/second**
and **1,000 lifetime request identities**. Responses and native renders count
toward transfer budgets. A new command resets only transfer accounting, not rate,
pending or duplicate-request fences. Existing 20-second command and heartbeat
deadlines remain. Failures terminate ports/worker and retain files/drafts.
Type-only heartbeats stay rate-bounded without consuming command transfer while
idle; additional heartbeat payloads are rejected.

JavaScript cannot prevent the first worker-to-frame structured clone. These checks
are application/protocol budgets, **not hard OS CPU/memory quotas**. Independent
adversarial review and operator/browser acceptance are still required before
enabling broader third-party imports. Both extension gates stay disabled by default.

## Developer acceptance

```sh
npx vitest run tests/portable-collection*.test.ts tests/plugin-transport.test.ts tests/plugin-expiry.test.ts
npm run verify:collections:migration
npm run plugins:staging -- verify-imports
npm run plugins:staging -- verify-plugins
npm run plugins:staging -- test --config imports.config.ts
npm run plugins:staging -- test --config plugins.config.ts
```

Use the existing isolated port-3004 database/storage profile, never the working
installation. Keep the worker stopped for deterministic queued-expiry/revocation
API tests; run the isolated worker for browser publication/export acceptance.
Run full UI/theme/type/lint/unit/build checks, inspect actual light/dark/large-text
screenshots and complete keyboard, reduced-motion, forced-color and physical
picker/drop review. Static tests or generated screenshots do not accept a stage.

Use one importer and one shared export dialog. Consume native Dialog/Field/Select/
Button controls; keep toolbar and action footer outside content scrollports.
Format diagnostics are compact text/actions, not new padded hint surfaces. Local
source, paper previews and Canvas own their scroll; do not leak app form styles
into editor fields or alter account typography. Preserve stale-response fencing,
owner lifetimes and quiet recovery polling when extending these workflows.
