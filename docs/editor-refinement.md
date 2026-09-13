# Editor and preferences refinement

Historical acceptance record for the pre-native refinement release. The later
[native replacement](NATIVE_EDITOR_IMPLEMENTATION.md) is also historical. Neither
record certifies the current [Axiom editor](EDITOR_VNEXT.md); consult
[current verification](VERIFICATION.md) for executed checks and remaining gates.

Approved product contract: routed settings with Apply/Cancel and retained drafts;
context-first Markdown editing; local MathJax STEM rendering. Markdown and Yjs
remain the canonical document and collaboration formats. No code execution,
spreadsheet formulas, merged cells, external TeX packages, or AI services.

## Implementation and acceptance checklist

- [x] Versioned writing preferences and atomic appearance/writing bundle API
- [x] Account-isolated preference cache, offline queue and conflict recovery
- [x] Routed settings navigation, hydration-safe retained drafts and leave guard
- [x] Complete writing categories, precise numeric fields and contextual previews
- [x] Portal context menus, selection formatting and quiet block controls
- [x] Inline table editing, rectangular operations and robust clipboard formats
- [x] Code editing assists and independent block display preferences
- [x] Async local MathJax, isolated macros, chemistry and opt-in physics
- [x] Math editing assists, last-valid previews and equation inspector
- [x] Indexed/change-aware Markdown engine with differential coverage
- [x] Unit, browser, security, offline, durability and performance verification
- [x] Backed-up release and original-data integrity audit

## Safety baseline

Before editing, the existing database and two attachment blobs were backed up to
`data/before-editor-refinement-20260908` and their checksums verified. Matching
source and private environment configuration are included. The existing
`apps/web/.next/workspace-release-20260908` production build is retained.
Development and destructive test fixtures must use the isolated refinement
database, storage path and build directory, never the user's live database.

Release `9qWrpD9c7PGpQbcFPRBDY` is active locally from
`apps/web/.next/editor-refinement-release-20260908`. The additional verified
cutover backup is `data/before-refinement-cutover-20260908-1935`. Live checks
cover all 16 settings categories, original-document math/export behavior and both
protected file checksums. All 12 original notes and CRDT byte states/revisions,
32 snapshots, attachments, preferences and other originally audited tables match
the baseline; only routine CRDT persistence timestamps changed after opening the
editor. See [the verification record](VERIFICATION.md) for results and limitations.

## Design criteria

Quiet solid reading surface, restrained translucent navigation, clear hierarchy,
consistent semantic colors and locally bundled fonts. Controls appear in context
without moving text. Keyboard focus remains visible even when mouse outlines are
absent. Menus fit the viewport and work with keyboard, pointer and touch. Every
operation preserves source, permission checks, shared undo and recoverable drafts.
