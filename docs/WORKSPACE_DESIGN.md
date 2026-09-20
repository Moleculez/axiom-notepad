# Desktop workspace design criteria

This is supporting design rationale. The [design system](DESIGN_SYSTEM.md),
[theme criteria](THEME_AUTHORING.md) and [file-first workbench](FILE_WORKBENCH.md)
are authoritative for current tokens, navigation and shared dialogs when older
examples below differ.

The workspace is a private research tool, not a commerce surface. The interface
should make location, permissions, save state and recovery understandable without
competing with the research document.

## Shared visual language

- Use the existing semantic palette (`--paper`, `--surface`, `--hover`, `--line`,
  `--text`, `--muted`, `--accent`, `--accent-bg`). No independent component themes.
- Keep app navigation in the UI font; document, source and mathematics retain
  their independently configurable research typography.
- Controls share an em-based minimum height, centered icon/text geometry and a
  consistent gap. Labels sit above fields except switches and checkboxes, whose
  labels sit alongside them. Long labels wrap without overlapping controls.
- Use restrained borders and tonal hover/selection. Focus-visible indicators
  remain available for keyboard use; never remove all focus feedback.
- Dialogs remain centered, bounded by the viewport and keyboard-dismissible when
  no operation would be interrupted. Content scrolls inside large dialogs.
- Reduced-motion, forced-color, solid-surface and high-contrast fallbacks remain
  part of the design, not separate visual themes.

## Navigation and interaction

- Custom action menus share monochrome, semantic Lucide-style icons and a stable
  icon/label/shortcut grid. Keep labels visible and checkmarks separate from icons.
  Thin theme-aware divider rules separate sections, without leading, trailing or
  duplicate separators. Existing table icon panels remain compact.
- Code-language suggestions show locally bundled brand logos with explicit
  fallbacks for every language. Logos supplement text, never determine behavior;
  use neutral backing for contrast and semantic glyphs in forced-colors mode.

- One contextual application toolbar with breadcrumbs and recent work, one sidebar.
  Browser-reserved Command/Ctrl T and W remain browser commands.
- Recent-work metadata does not imply a running editor. Only visible document panes
  mount editing surfaces; at most two panes are active. Settings shares one draft.
- Explorer uses click to select, Shift for ranges, Command/Ctrl for additive
  selection, double-click/Enter to open and Space for quick preview.
- Drag, menu and clipboard operations use the same durable file-operation
  service. Cross-workspace actions state the destination audience explicitly.
- Folder colors are personal. Shortcuts never create privileges or duplicate
  file bytes. Research evidence is protected from forced permanent deletion.

## Theme families

Neutral, Zinc, Stone, Material Indigo, Material Sage and Material Teal each have
paired light and dark palettes. Applying a family changes colors only: it does
not reset fonts, color-mode choice or navigation materials. Existing research
looks and portable theme exports remain supported.

Navigation surfaces (formerly Window material) remains in Advanced appearance:
Glass and Solid are functional choices, including intensity and accessibility
fallbacks. It is not decorative dead UI and has not been removed.

## Release acceptance

Check complete user workflows, not merely rendered controls. Verify permission
revocation, stale revisions, uncertain-response retries, partial completion,
cancel/retry, off-screen layouts, large typography, keyboard navigation and fresh
screenshots. Desktop-native folder dragging and clipboard acceptance still need
human testing on supported operating systems; automation does not certify them.
