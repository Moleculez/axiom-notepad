# Research workspace guide

The default landing page is `/workbench/home`. Existing `/?note=…` and `/?paper=…` links remain usable in the original notebook surface; `/?classic=1` opens that compatibility surface explicitly.

## Navigation

- **Home:** recent documents, assigned tasks and review requests.
- **Explorer:** notes, folders, images, PDFs, datasets and other files in one hierarchy. Projects are grouped under their research group in the tree.
- **Projects:** overview, board/list/calendar, milestones, discussions, snapshot-bound reviews, workload, activity and access settings.
- **Research:** reading tools, STEM note starters, reference libraries and the knowledge graph.
- **Inbox:** assignments, reviews, discussions and due-date reminders; category and optional email controls live in account settings.
- **People:** researchers in your groups, searchable interests/affiliations and profiles.
- **Administration:** Workspaces, Groups, Audit and Trash stay below Your spaces in the same sidebar. They provide workspace and membership administration, authorized change history, operation progress and batch recovery. See [the management console guide](MANAGEMENT_CONSOLE.md).

The top bar holds resource tabs, a pages launcher, search, transfers and account
tools. The same workspace tree remains visible across documents, settings and
administration. An item's information action opens its inspector. Creation lives
in Explorer, relevant pages and context menus, not a permanent top-bar Create
button. Account → My groups stays inside Settings; explicit management links open
the full workspace/group administration pages. See [file-first navigation](FILE_WORKBENCH.md).

The profile dropdown closes after choosing an item, clicking outside, moving keyboard focus away or pressing Escape. Escape returns focus to the profile trigger; canceling sign-out also returns there.

Click a workspace or folder name to open it and expand its tree, including an already-selected location. The chevron independently expands or collapses without navigating. Branches show folders, notes and files; notes with attached files have their own expansion chevron. Left/Right arrows collapse or expand, and Right on an expanded branch focuses its first child. Empty locations and failed listings show an inline message, with Retry for loading errors.

Right-click a workspace, folder or selected Explorer item for its contextual actions. Shift+F10 opens the same menu from the keyboard; Escape returns focus to the original item. Explorer supports arrow navigation, F2 rename, platform Copy/Cut/Paste and guarded Delete. Folder menus create notes/folders or upload directly into that folder. Cross-workspace operations confirm the destination audience.

Use **Administration → Workspaces** for the directory of Active, Archived and
Trash workspaces and workspace creation. Each workspace has General, People,
Invitations, Storage, Integrations, Activity and Lifecycle sections. Archive pauses
editing and scheduled work. Workspace Trash has no expiry, and restoration
preserves independently archived projects and individually trashed resources.
Owner-only permanent removal checks outside evidence and has a cancellation
window. See [management and recovery details](MANAGEMENT_CONSOLE.md).

## Ownership and sharing

An account's personal space survives leaving a group. Other members, including group administrators, cannot browse it. Group owner/admin/member roles control administration; viewer/commenter/editor roles control team/project content. Restricted projects admit explicitly assigned people. Group-audience projects inherit group access unless an explicit project role applies. Project leads manage settings/access. Archived projects are read-only until restored by a manager.

There are no public links or per-item permissions. Items inherit their destination space's audience. Copy/move across spaces requires explicit audience confirmation. A copy creates new identities and includes exact linked file versions the caller can read; history, discussions, annotations and reading records are not copied. A move retains identities and history, but is refused when it would break outside evidence or project task/review bindings. Use a copy to preserve the original research record.

Transfer ownership before leaving a group; assign another project lead before removing its last lead. Revocation ends online access but cannot erase downloaded or offline copies.

## Writing and reading

Keep up to 20 resources in working-set tabs, with at most two visible panes. Hidden notes retain local undo history. Closing a note checks device persistence before releasing the retained document. Narrow screens switch panes instead of squeezing two editors together.

Write, Source and Read use the same Markdown document. `Command+/` on macOS or
`Ctrl+/` elsewhere switches Write/Source. The searchable command palette,
customizable shortcuts, slash insertion, rich research blocks, nested outline,
reading marks and optional minimap remain available. See [the editor guide](EDITOR.md).

The document panel holds the outline, comments, references and bookmarks. Reading positions resume across devices; hash links and deliberate navigation take priority. Recovered source remains available after a generation change. “Saved on server” is a persistence acknowledgment, not simply a connected indicator.

## Files and storage

Explorer accepts files up to **1,000,000,000 bytes (1 GB)** in resumable 8 MiB parts. Transfers are checksummed before publishing. Pause, resume/reselect the original, retry verification or cancel in the transfer panel. Interrupted uploads expire after seven days. Keep the workspace worker running: it completes uploads and prepares previews/exports/reminders.

Replacing a file creates an immutable version. Pinned links, annotations and
citations keep their version identity. Restoring an older version creates a new
current version without modifying old bytes. Images, media, PDFs, text/data and
supported Office files have protected viewers; unsupported formats download.
Office conversion requires explicit deployment setup. The PDF annotation reader
loads a complete copy; files over 100 MB ask before opening to avoid unexpected
memory pressure. See [viewer capabilities and limits](RESEARCH_TOOLS.md).

Storage settings show current files, versions, trash and upload reservations. Team/project libraries share a group quota; displayed space subtotals are not the whole group's usage. Quotas count logical file-version bytes, even when blobs are physically shared. Avatars, previews, exports and multipart staging also occupy server disk but are outside file-version quota totals.

Completed files are **never automatically garbage-collected**. Trash is reversible. Permanent cleanup is an explicit manager action with typed confirmation. Current versions, note links, saved revisions, annotations, reading records and reference links protect file versions. Referenced evidence cannot be purged. Blob deletion happens only after the database commit and a final reference check. Deletion does not erase historical backups.

## Exports and recovery

Prepare a ZIP from selected Explorer items, then track it under **Settings → Portable exports**. It contains current Markdown, hierarchy, exact linked file versions, per-note BibTeX and an identity/checksum manifest. Each export is private to its creator and rechecks current access on download. Remove prepared archives manually when finished; originals are unaffected.

Export limits: 1,000 resources, 25 MB Markdown, 100 GB total file data and two active exports per account. Copy/move limits: 1,000 items, 200 notes and 10 MB Markdown per operation. These are bounded operations, not whole-account replication.

Portable ZIPs are readable without Axiom; they are not a full-fidelity account restore format. The original notebook's Markdown/ZIP importer remains at `/?classic=1` (50 MB input, 100 MB expanded). Accounts, history, preferences and permissions require the paired database/blob backup utility. Incomplete multipart parts are not backed up and must be uploaded again after restore. See [deployment and recovery](DEPLOYMENT.md).

## Accounts and customization

Profiles include a normalized avatar, affiliation, interests, biography, links, time zone and weekly capacity. Security includes password changes, devices, session revocation, authenticator setup and recovery-code replacement. Authenticator verification protects password sign-in; institutional login follows the institution's own MFA policy.

Optional OIDC requires an existing account to explicitly link a verified matching institutional email. It never creates uninvited accounts or automatically grants membership. Deployment administrators must configure and test the real provider.

Appearance retains synced/portable themes, semantic color editing, independent interface/prose/headings/code fonts and sizes, spacing, reading measure, density, materials, motion and accessibility controls. Device overrides stay local; a previous appearance is restorable. Inputs are visually quiet but keyboard focus stays visible. See the shared [design criteria](DESIGN_SYSTEM.md).

## Intentional boundaries

There is no public sharing, commerce, spreadsheet calculation engine, Office
co-editing, executable notebook runtime, SAML or SCIM. Provider-assisted OCR/AI is
optional and disabled until configured; opening research never uploads it to a
provider automatically. MCP exposes its advertised tool catalog, not every UI
operation. SMTP, S3, institutional identity and Internet-facing deployment need
their own configuration and verification. See [research-tool boundaries](RESEARCH_TOOLS.md)
and [remaining acceptance gates](VERIFICATION.md).
