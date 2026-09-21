# Productivity expansion status

This is a staged implementation record, not a promise that the entire roadmap is
finished. Existing collaborative Markdown, file management, workspace planning and
group-admin features remain in place. No new Office editing engine is introduced.

## Implemented in this increment

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
- Assistant context includes selected same-group workspaces, immutable Office
  excerpts, selected Canvas cards and planning snapshots. Scope is explicit; it
  does not authorize whole-workspace crawling or automatic transmission.
- A theme-aware toolbar progress line aggregates requests, actions and lazy pages.
  Already loaded panels remain visible during same-target refreshes; fast requests
  avoid flicker and reduced-motion preferences receive a static indicator.

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
   Investigate the conversation-history/outgoing-review UI walkthrough noted in
   the [documentation capture results](VERIFICATION.md); it is not passed acceptance.
   Web retrieval and autonomous operations remain excluded.
3. **Planning refinements:** full cross-workspace capacity conflict previews,
   larger real-world portfolio/accessibility acceptance and richer goal/intake
   workflows remain. Portfolios, immutable baseline comparisons, critical-path/slack
   calculations, weekly capacity and workspace-only capacity previews are implemented.
   Existing task/List/Board/Calendar/Gantt workflows are not replaced.
4. **Team and research operations:** richer intake, goals, recurring work and safe
   administrator-configured non-AI automations with audit/retry/permission checks.
5. **Menu follow-through:** audit custom inline/dropdown surfaces not backed by the
   shared context menu, and expose secondary actions through Search & commands.
   Account/recent-work popovers are now mutually exclusive; planning surfaces use
   shared tokens, modal layout and text-scaled capacity rows. A complete inspector
   ownership system and shared command registry remain future work.

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
