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

## Remaining implementation stages

1. **PDF acceptance and refinements:** provision/test real CPU OCR images/models,
   verify drawing export in desktop readers, expand real mixed/CJK/password/large
   fixtures and offline/revocation/accessibility acceptance. Durable offline thread
   drafts, generic text/area geometry handles and richer native-arrow import remain.
2. **Assistant acceptance and refinements:** verify a deliberately configured real
   provider's limits, output quality, billing/retention and cancellation behavior;
   broader long-conversation/accessibility acceptance. Office/Canvas context, web
   retrieval and autonomous operations are not included in the initial assistant.
3. **Advanced planning:** workspace portfolios, schedule baselines and comparisons,
   critical-path/slack calculations, real capacity planning and conflict previews.
   Existing task/List/Board/Calendar/Gantt/Workload workflows are not replaced.
4. **Team and research operations:** richer intake, goals, recurring work and safe
   administrator-configured non-AI automations with audit/retry/permission checks.
5. **Menu follow-through:** audit custom inline/dropdown surfaces not backed by the
   shared context menu, and expose secondary actions through Search & commands.

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
