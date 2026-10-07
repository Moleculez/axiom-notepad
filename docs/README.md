# Axiom documentation

A self-hosted research-group workspace, currently a controlled beta. Start with
the [product overview and local setup](../README.md) or the [visual showcase](SHOWCASE.md).
The guides below describe the current workbench; dated implementation records are
not installation instructions or proof of today's test results.

## For researchers

- [Interactive static showcase](STATIC_SHOWCASE.md) — try the real editor and Canvas, local drafts/uploads, themes, exports and GitHub Pages deployment

- [In-app Docs and evidence workbench](PRODUCT_GUIDE.md) — 32 guides, safe editor/Canvas examples, reading queues and previewed synthesis
- [Workspace guide](WORKSPACE.md) — navigation, sharing, files and everyday limits
- [Import Markdown and folders](WORKSPACE_IMPORTS.md) — local review, ZIP safety, source-preserving links and atomic resumable publication
- [Portable research collections](PORTABLE_COLLECTIONS.md) — native projects, checksummed manifests, legacy migration and expiring extension consent
- [Workspace websites](WORKSPACE_WEBSITES.md) — LaTeX-first themes, reviewed publishing, reading/discovery tools, private author analytics, static export and custom domains
- [Workspace planning](WORKSPACE_PLANNING.md) — tasks, Gantt, baselines, capacity and searchable research request/decision archives
- [Lab planning](PLANNING_LAB.md) — typed properties, shared manual time, reviewed non-AI rules and Stage 3 acceptance limits
- [Editor and shortcuts](EDITOR.md) — visual/source editing and research blocks
- [Native mind maps](MINDMAP.md) — Markdown hierarchy, branch editing, collaboration and portable exports
- [Document export and Read mode](DOCUMENT_EXPORT.md) — styled snapshots, portable HTML/PDF, Markdown bundles and focused reading
- [Research writing](RESEARCH_WRITING.md) — editable LaTeX/BibTeX/Biber projects, reviewed merges, reference provenance and frozen paper/task handoffs
- [Version history and review](VERSION_REVIEW.md) — comparisons, suggestions, milestones, assigned reviews and cloud drafts
- [Workspace research assistant](WORKSPACE_ASSISTANT.md) — exact-batch outgoing approval, bounded MCP evidence, source identity, usage limits and confirmed-only recovery
- [Workspace extensions](EXTENSIONS.md) — optional pilots, SDK, native panels, scoped consent, reviewed proposals and isolation limits
- [Reading and references](READING.md) — paper reading, bibliography and appearance
- [PDF research workbench](PDF_READER.md) — reader, annotations, task links, recoverable reply drafts, page copies and opt-in assistance
- [Self-hosted CPU OCR](SELF_HOSTED_OCR.md) — private queue, reviewed text, searchable copies and operator acceptance
- [Reading marks](READING_MARKS.md) — bookmarks, private notes and shared annotation cards
- [Document minimap](MINIMAP.md) — navigation, markers, folding and appearance
- [Image and Mermaid viewer](VISUAL_VIEWER.md) — inspection, comparison and annotations
- [Research media and snippets](EDITOR_MEDIA.md) — insertion previews, file codes, figures, excerpts and reusable content
- [Settings](SETTINGS.md) — previews, preferences and account/device boundaries
- [Management console](MANAGEMENT_CONSOLE.md) — workspaces, groups, Audit and Trash
- [Research file views](RESEARCH_TOOLS.md) — Math/Image/Text Studio, viewers and limits
- [Productivity expansion status](PRODUCTIVITY_ROADMAP.md) — completed increments and remaining stages
- [Canvas, Explorer, MCP and offline work](PRODUCTIVITY_PLATFORM.md)

## For operators

- [Docker Compose deployment](DEPLOYMENT.md) — primary path, HTTPS, sync, upgrades and backups
- [Native Linux/systemd deployment](NATIVE_DEPLOYMENT.md) — secondary installation path
- [Verification and remaining release gates](VERIFICATION.md) — current, scoped evidence
- [Daily-use reliability acceptance](RELIABILITY.md) — isolated authenticated CI, fail-closed fixtures, crash/recovery rehearsal and performance evidence
- [Stage 3–4 acceptance](STAGE_ACCEPTANCE.md) — local coordinator, real worker races, populated recovery, same-host scale budget and operator review
- [Maintenance](MAINTENANCE.md) — generated files, storage and safe cleanup
- [Development reset and first run](DEVELOPMENT_RESET.md) — guarded development-only recovery

Never run reset, seed or browser mutation suites against working research data.
Optional SMTP, S3, institutional identity, Office conversion and AI providers need
their own deployment-specific acceptance checks.

## For contributors

- [Repository structure and contribution workflow](../CONTRIBUTING.md)
- [Project MIT license](../LICENSE) — first-party source and documentation; upstream notices remain applicable
- [Extension development and acceptance](EXTENSIONS.md#package-format-and-sdk)
- [Architecture and data boundaries](ARCHITECTURE.md)
- [Performance and regression contracts](PERFORMANCE.md) — bounded caches, source-safe scheduling, offline upgrades and isolated measurements
- [Current editor architecture](EDITOR_VNEXT.md), [typing contracts](TYPING_INTEGRITY.md)
  and [editor acceptance checklist](EDITOR_VNEXT_ACCEPTANCE.md)
- [File-first workbench](FILE_WORKBENCH.md) — canonical routes, tabs, menus and dialogs
- [Canvas architecture](CANVAS_ARCHITECTURE.md) and [Canvas acceptance](CANVAS_V1_ACCEPTANCE.md)
- [Design system](DESIGN_SYSTEM.md) and [theme authoring criteria](THEME_AUTHORING.md)
- [UI controls and layout contract](UI_CONTROLS.md) — native controls, hints/notices, action hierarchy, dialog focus and automated drift guard
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
