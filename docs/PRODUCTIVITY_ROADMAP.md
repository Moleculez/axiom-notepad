# Productivity expansion status

This is a staged implementation record, not a promise that the entire roadmap is
finished. Existing collaborative Markdown, file management, workspace planning and
group-admin features remain in place. No new Office editing engine is introduced.

## Implemented in this increment

- [Workspace websites](WORKSPACE_WEBSITES.md): personal/team identities, selected
  research content, template/section design, frozen private review, manager-approved
  publication/rollback, static ZIP export and verified-domain routing. Real DNS/TLS,
  container recovery and broad public-viewer acceptance remain deployment gates.
- Publication reading and discovery: LaTeX-first theme gallery and live specimens,
  hierarchical floating TOC, section sharing, word/read-time statistics, topic index,
  related/adjacent articles and filterable timeline archives. Private editorial and
  readership analytics include comparisons, CSV, manager-controlled public counters
  and optional consent-gated GA4 embedding. Collection is disabled by default.
- Settings uses a searchable replacement rail and one shared page frame.
  Axiom, Material Tonal, Fluent Studio, Editorial and macOS Studio presentations change component
  styling independently of palette packs and reading typography. Processing-provider
  dialogs have grouped aligned fields, a fixed footer and guarded draft dismissal.

- Shared context-menu normalization: at most eight root actions, named categories,
  one submenu level, icons/dividers, hidden irrelevant actions and preserved
  keyboard dismissal/focus restoration. Explorer/file/workspace actions use quieter
  New, Organize, Copy & export and Details categories.
- PDF underline/strikeout, annotation tags, multi-page text selections, private
  embedded-annotation import, portable annotated-PDF download and richer resume.
  See [PDF limits](PDF_READER.md).
- PDF pen/arrows/text boxes, selected-drawing drag/resize and conditional Undo;
  private/shared annotation threads, resolve/unread counts and guarded bulk actions.
- Virtual page shells with mixed-size measurement/anchor preservation; file/version
  comparison, linked scrolling, text differences and explicit reviewed-OCR inputs.
- Workspace PDF copies/new versions with upload revision fences, failed-replacement
  recovery, atomic provenance/annotation mapping and private-by-default copies.
- Annotation-to-task links preserve source identity without copying private text;
  unsent annotation replies recover on the same device after a fresh access check.
- Optional private CPU OCR queue, checkpoints, review/corrections, equation previews,
  private note creation, searchable outputs, quota accounting, retention and backup.
  The interface/queue are tested; real container/model acceptance is still gated.
- Read-only Excel grid: saved styles/merges/frozen panes, formula inspection,
  sorting/filtering, resizing, range copying/statistics and versioned cell links.
- Word reading with headings/tables/comments/footnotes; PowerPoint text/slides
  navigator and speaker notes; search, versioned reading links, text export and
  optional privately converted page views. See [viewer limits](RESEARCH_TOOLS.md).
- [Unified research assistant](WORKSPACE_ASSISTANT.md): private workspace conversations,
  local source search and exact excerpts, reviewed outgoing context, citations,
  explicit Markdown/math suggestion publication, version-fenced task operations and
  guarded Undo, cancellation and retention. Provider-backed production acceptance
  remains gated; local fixtures do not establish model quality.
- Planning portfolios connect accessible group workspaces. Immutable baselines,
  current/baseline comparison, critical-path/slack analysis and explicit weekly
  availability support estimate-based capacity reporting. Manual and assistant
  scheduling share preview/apply/guarded Undo; impact previews remain workspace-only.
- Research Intake has server-paginated open requests and decision history, literal
  title/body/review-note search, type/status/author filters, per-status counts and
  oldest/newest submission order. Summaries omit Markdown bodies; opening a request
  explicitly loads its authorized detail. Peer changes retain and fence drafts.
- Assistant context includes selected same-group workspaces, immutable Office
  excerpts, selected Canvas cards and planning snapshots. Scope is explicit; it
  does not authorize whole-workspace crawling or automatic transmission.
- A theme-aware toolbar progress line aggregates requests, actions and lazy pages.
  Already loaded panels remain visible during same-target refreshes; fast requests
  avoid flicker and reduced-motion preferences receive a static indicator.
- [Workspace extensions](EXTENSIONS.md): TypeScript SDK/packaging example,
  immutable ZIPs, default-disabled personal installs, exact-hash group approval,
  individual workspace grants, opaque browser workers and native declarative
  panels. Research Journal, Document Health and Planning Brief use saved snapshots
  and human-reviewed changes. Updates/configuration rollback, shortcut collision
  checks, revocation, device safe mode, uninstall cleanup and proposal activity
  are implemented. Imports stay behind a separate default-off security gate.
- Shared Search & commands registry, active-pane targeting and single inspector
  ownership retain assistant/extension/document context without competing rails.
  Extension commands can contribute declared slash/context entries without
  changing Markdown or native editor shortcuts.
- Activity & recovery adapts authoritative uploads/file operations/exports/OCR/
  assistant/extension ledgers. Idle polling stays quiet, inspection opens existing
  controllers, and cancel-after-revocation narrows pending proposal authority.
  Workspace directory cards show readable access/count/storage metadata. Settings
  retains extension drafts across categories and uses one aggregate exit guard.

## Remaining implementation stages

1. **PDF acceptance and refinements:** provision/test real CPU OCR images/models,
   verify drawing export in desktop readers, expand real mixed/CJK/password/large
   fixtures and offline/revocation/accessibility acceptance. Generic text/area
   geometry handles and richer native-arrow import remain. Reply drafts now persist
   locally and recover after a fresh permission check; sending is always explicit.
2. **Assistant acceptance and refinements:** verify a deliberately configured real
   provider's limits, output quality, billing/retention and cancellation behavior;
   broader long-conversation/accessibility acceptance. Office/Canvas/planning
   context, selected same-group scopes and reviewed date proposals are implemented.
   A dedicated isolated history-to-outgoing-review regression now exercises saved
   conversations, previous-answer context, Back/reset consent and no send before
   approval. See the scoped results in [verification](VERIFICATION.md); this does
   not establish real-provider quality or general long-history acceptance.
   Web retrieval and autonomous operations remain excluded.
3. **Planning refinements:** signed working-day dependency offsets, quarter/year
   timelines, grouping/columns, leaf/derived progress, private/shared saved views,
   atomic selection operations and enriched exports are implemented. Reviewed
   capacity previews now include accessible active group workspaces and fence
   cohort changes. Larger real-world portfolio/accessibility acceptance remains;
   no automatic resource leveling, time tracking or extra dependency types.
4. **Team and research operations:** linked/manual Goals, member-only Intake with
   exactly-once task acceptance, editable future recurring templates, occurrence
   history and archive/pause controls are implemented. Their AI/MCP writes use
   existing human-reviewed change sets. Paginated searchable intake archives are
   implemented. Richer custom forms/metrics, goal archive pagination and safe
   administrator-configured non-AI automations remain.
5. **Menu follow-through:** audit custom inline/dropdown surfaces not backed by the
   shared context menu, and expose secondary actions through Search & commands.
   Account/recent-work popovers are now mutually exclusive; planning surfaces use
   shared tokens, modal layout and text-scaled capacity rows. A shared command
   registry and one inspector owner are implemented; custom inline dropdown
   follow-through and broader keyboard/accessibility acceptance still remain.

## Next essential development stage

Prioritize trustworthy everyday workflows before adding another editor engine or
an unrestricted marketplace. The following are **next-stage candidates**, not
delivered features or permission to enable them automatically:

1. **Extension security and operations (release blocker for broad imports):**
   independent adversarial review, resource/clone budgets, permission
   expiry/revocation rehearsals, package catalog reclamation and publisher identity.
   Native admin approval should remain exact-hash and must not become content access.
2. **Research reliability:** real mixed/CJK/password/large PDF fixtures and configured
   private OCR/conversion acceptance; source-linked research reports and durable
   evidence handoffs. Resolve existing provider/export/offline failures through
   Activity & recovery without introducing autonomous retries or transmissions.
3. **Planning at lab scale:** larger portfolios, goal/metadata-history archive
   pagination, saved-view/capacity accessibility and measured Gantt/workload performance.
   Intake pagination, exact filtered counts and lazy full-body loading are implemented;
   status/content stay live rather than claiming a frozen historical snapshot.
   Reuse reviewed schedule previews and frozen revision fences rather than adding
   automatic resource leveling or silently rewritten task dates.
4. **UI/accessibility acceptance:** physical keyboard/IME/clipboard and screen-reader
   passes, long-label/large-font inspector layouts, dense settings and plugin field
   validation. Extend the shared components/criteria instead of local visual fixes.

Each stage needs authorization, stale-version and failure-path tests as well as
browser acceptance. Replacement uploads now require expectedVersionId and
expectedResourceVersion; clients must retain the original fence when resuming.
Do not silently refresh those values to overwrite a concurrent version.

## Acceptance boundaries

The [verification log](VERIFICATION.md) records executed checks. Use isolated test
storage/database on port 3004, never working research data on 8080. Do not claim
Microsoft Office, Zotero or ClickUp parity. Real private LibreOffice conversion,
external AI providers, actual CPU OCR containers/model quality, physical
clipboard/assistive technology and full offline/revocation rehearsal still require
separate acceptance. See [self-hosted OCR](SELF_HOSTED_OCR.md).
