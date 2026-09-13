# Document minimap

Enable **Settings → Appearance → General → Show document minimap**. It is off by
default and is a personal appearance preference, not part of a shared note.

## Navigation

- Write and Read show a lightweight document miniature; Source shows Markdown
  lines with syntax-colored text. Tables, metadata, equations, images and folded
  blocks have recognizable shapes. This is not a second rendered editor or a
  pixel-perfect screenshot; it never downloads images or typesets equations.
- Click, drag the viewport, or use the wheel to scroll. These actions preserve
  your typing caret and selection and never activate a block's source editor.
- Hover for a passive section/excerpt preview. Heading labels and clustered
  bookmark, annotation, search and collaborator markers navigate the document.
- Right-click for navigation/display actions. **Go to location** (also Enter when
  the scrollbar has keyboard focus) explicitly moves the caret and may reveal a
  folded target. Ordinary scrolling does not unfold blocks. In Read it only scrolls.
- **Toggle minimap**, **Focus minimap**, and **Return to cursor** are available in
  the command palette and configurable shortcuts, without new default bindings.
  Keyboard navigation supports arrows, Page Up/Down, Home/End, Shift+F10 and Escape.
  Escape restores the previous editing selection; arrow keys also walk heading
  labels and marker groups without adding dozens of stops to the Tab order.

The reading-marks overview setting controls saved-mark visibility in the unified
lane. Turning off the minimap restores the standalone reading-marks overview.
Private annotations use the same authorized local data as the Reading marks panel;
minimap rendering adds no network requests or collaboration payloads. Unattached
marks remain in that panel rather than appearing at a guessed location.

## Appearance and layout

Controls include Write/Source/Read visibility, left/right placement, width (80–200
px, default 120), miniature text/color blocks, heading labels, hover previews,
selection/search/collaborator markers and hover/always-visible viewport highlighting.
Fit shrinks long documents to fit the track without stretching short documents;
Proportional keeps a natural miniature scale and follows the document viewport;
Fill uses the full available height.

Markers share the miniature's scale and scroll offset in every sizing mode.
In Proportional mode, marks outside the currently displayed miniature are clipped
with their content, rather than appearing at misleading positions along its edges.
The compact overview still maps the whole document. Cursor/search markers follow
the actual text row, including wrapped prose and source/embedded editors; moving
horizontally within a line does not move the marker vertically. Nearby marks are
clustered, while single markers retain their exact position.

The map has its own column outside the document and above the fixed footer. It
does not cover text, block-margin controls or annotation cards. Narrow desktop
panes use a compact overview without rewriting the preferred width. Settings has
a working private scratchpad preview; Apply/Cancel/reset use the normal appearance
workflow. Embedded annotation and Canvas editors do not acquire their own minimaps.
Print and document exports omit all minimap UI.

## Engineering contract

`packages/editor/src/minimap.ts` owns bounded previews, layout and source/visual
indexing. Visual ordering remains separate from source ordering for footnotes.
`document-navigation.ts` shares cached geometry between reading marks and the map;
scrolling changes viewport state without remeasuring every block. The editor exposes
read-only navigation snapshots, not a second editing state.

The shared navigation subscription also caches source-position rectangles from
the owning editor for selection and search/presence targets. Measurements are
converted to scroll-content coordinates and invalidated on document/layout
changes, not ordinary scrolling. Virtualized source lines use the editor height
map until actual row geometry is available; folded targets stay on their visible
summary. The cache retains only current targets, and stale source revisions are
never mixed with live marker positions.

The canvas painter uses a spare bounded bitmap and atomically presents completed
frames, with a maximum device-pixel ratio of two and chunked painting. Source line
geometry uses the existing text surface's height map and samples very dense files.
It is capped at 12,000 source-line groups; search indicators show up to 1,000
matches while the normal Find interface retains its complete results. These
density limits affect the miniature, not the note or its editable contents.
Inactive views stop observing/painting, stale work is cancelled, and minimap-only
preferences do not reconfigure the rich projection. Explicit cursor navigation is
deferred during composition and rejected if its captured source revision changed.
Loaded fonts invalidate the miniature even when block geometry stays unchanged.

Appearance schema **8** adds nested `minimap` preferences, migrates older values
without restyling, and projects compatible reads for clients through schema 7.
Older clients cannot overwrite newer settings. No SQL migration, new editor
dependency, screenshot persistence or image-export feature is introduced.

See [verification](VERIFICATION.md) for current browser and benchmark evidence.
