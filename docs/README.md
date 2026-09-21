# Axiom documentation

A self-hosted research-group workspace, currently a controlled beta. Start with
the [product overview and local setup](../README.md) or the [visual showcase](SHOWCASE.md).
The guides below describe the current workbench; dated implementation records are
not installation instructions or proof of today's test results.

## For researchers

- [Workspace guide](WORKSPACE.md) — navigation, sharing, files and everyday limits
- [Workspace planning](WORKSPACE_PLANNING.md) — tasks, Gantt, baselines, critical paths, group portfolios and capacity
- [Editor and shortcuts](EDITOR.md) — visual/source editing and research blocks
- [Version history and review](VERSION_REVIEW.md) — comparisons, suggestions, milestones, assigned reviews and cloud drafts
- [Workspace research assistant](WORKSPACE_ASSISTANT.md) — selected group-workspace evidence, Office/Canvas/planning context, reviewed suggestions and schedule changes
- [Reading and references](READING.md) — paper reading, bibliography and appearance
- [PDF research workbench](PDF_READER.md) — reader, annotations, task links, recoverable reply drafts, page copies and opt-in assistance
- [Self-hosted CPU OCR](SELF_HOSTED_OCR.md) — private queue, reviewed text, searchable copies and operator acceptance
- [Reading marks](READING_MARKS.md) — bookmarks, private notes and shared annotation cards
- [Document minimap](MINIMAP.md) — navigation, markers, folding and appearance
- [Image and Mermaid viewer](VISUAL_VIEWER.md) — inspection, comparison and annotations
- [Settings](SETTINGS.md) — previews, preferences and account/device boundaries
- [Management console](MANAGEMENT_CONSOLE.md) — workspaces, groups, Audit and Trash
- [Research file views](RESEARCH_TOOLS.md) — Math/Image/Text Studio, viewers and limits
- [Productivity expansion status](PRODUCTIVITY_ROADMAP.md) — completed increments and remaining stages
- [Canvas, Explorer, MCP and offline work](PRODUCTIVITY_PLATFORM.md)

## For operators

- [Docker Compose deployment](DEPLOYMENT.md) — primary path, HTTPS, sync, upgrades and backups
- [Native Linux/systemd deployment](NATIVE_DEPLOYMENT.md) — secondary installation path
- [Verification and remaining release gates](VERIFICATION.md) — current, scoped evidence
- [Maintenance](MAINTENANCE.md) — generated files, storage and safe cleanup
- [Development reset and first run](DEVELOPMENT_RESET.md) — guarded development-only recovery

Never run reset, seed or browser mutation suites against working research data.
Optional SMTP, S3, institutional identity, Office conversion and AI providers need
their own deployment-specific acceptance checks.

## For contributors

- [Repository structure and contribution workflow](../CONTRIBUTING.md)
- [Architecture and data boundaries](ARCHITECTURE.md)
- [Current editor architecture](EDITOR_VNEXT.md), [typing contracts](TYPING_INTEGRITY.md)
  and [editor acceptance checklist](EDITOR_VNEXT_ACCEPTANCE.md)
- [File-first workbench](FILE_WORKBENCH.md) — canonical routes, tabs, menus and dialogs
- [Canvas architecture](CANVAS_ARCHITECTURE.md) and [Canvas acceptance](CANVAS_V1_ACCEPTANCE.md)
- [Design system](DESIGN_SYSTEM.md) and [theme authoring criteria](THEME_AUTHORING.md)
- [Brand identity](BRANDING.md) and [illustrated feature tour and reproducible assets](SHOWCASE.md)

Axiom owns its source-preserving parser, editing contracts and interface. Its current
editor uses Milkdown/ProseMirror and CodeMirror foundations in both development and
production; the native engine is an explicit rollback option, not the default.

## Historical records

The [implementation log](archive/IMPLEMENTATION-2026-09-11.md),
[verification log](archive/VERIFICATION-2026-09-11.md) and
[editor development log](archive/EDITOR_VNEXT-2026-09-11.md) preserve earlier decisions
and measured results. Older native-editor, workspace and productivity release
documents are labeled as historical in place to keep existing links usable.
Follow the current guides above when the records disagree. Acceptance checklists
describe requirements; only dated, scoped entries in [Verification](VERIFICATION.md)
report executed checks.

Raw screenshots, traces, database identities and backup receipts remain private.
The curated showcase uses fictional content and is the deliberate asset exception.
