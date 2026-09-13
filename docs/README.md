# Axiom documentation

Axiom is a self-hosted research-group workspace preparing for a controlled beta.
The application editor is Axiom's customized, source-preserving editor, built on
Milkdown/ProseMirror and CodeMirror—not a dependency-free rewrite of those libraries.

## Run and maintain

- [Start locally and feature overview](../README.md)
- [Docker Compose deployment, upgrades and recovery](DEPLOYMENT.md) — primary path
- [Native Linux/systemd installation](NATIVE_DEPLOYMENT.md) — secondary path
- [Repository layout and contributor workflow](../CONTRIBUTING.md)
- [Verification and remaining release gates](VERIFICATION.md)
- [Architecture and data boundaries](ARCHITECTURE.md)
- [Generated-file cleanup](MAINTENANCE.md)
- [Guarded development reset](DEVELOPMENT_RESET.md) — never a production setup procedure

## Product and design contracts

- [File-first workbench, navigation and dialogs](FILE_WORKBENCH.md)

- [Current editor implementation](EDITOR_VNEXT.md), [writing controls](EDITOR.md), [acceptance checklist](EDITOR_VNEXT_ACCEPTANCE.md)
- [Canvas architecture](CANVAS_ARCHITECTURE.md) and [acceptance](CANVAS_V1_ACCEPTANCE.md)
- [Research tools and limits](RESEARCH_TOOLS.md)
- [Workspaces, Audit and Trash](MANAGEMENT_CONSOLE.md)
- [Files, MCP and offline workflows](PRODUCTIVITY_PLATFORM.md)
- [Reading, references and annotations](READING.md)
- [Reading bookmarks, margin marks and annotation cards](READING_MARKS.md)
- [Document minimap and unified navigation](MINIMAP.md)
- [Image/Mermaid viewer, metadata and placement annotations](VISUAL_VIEWER.md)
- [Settings](SETTINGS.md), [design system](DESIGN_SYSTEM.md), [theme authoring criteria](THEME_AUTHORING.md)

## Historical evidence

The [implementation log](archive/IMPLEMENTATION-2026-09-11.md),
[verification log](archive/VERIFICATION-2026-09-11.md), and
[editor development log](archive/EDITOR_VNEXT-2026-09-11.md) preserve earlier decisions
and measured results. They are not proof that the current build passes those checks.
Private traces, screenshots and backup receipts stay outside Git.
