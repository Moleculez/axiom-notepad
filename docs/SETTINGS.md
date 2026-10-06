# Settings workbench

The full workbench's account settings are described below. The
[browser-local showcase](STATIC_SHOWCASE.md#settings-without-the-clutter) has a
separate, immediate-save dialog with seven grouped categories, a persistent live
preview and category-only reset. Its Local data panel manages guest backups and
uploads, never account preferences or workbench files.

Appearance and Writing use a two-pane desktop layout: controls on the left and
**Try it here** on the right. Each pane scrolls independently; Apply and Cancel
stay outside both scrollers. The scratchpad uses the current editor and personal
document styles, while settings controls keep the interface typography.

Both panes own stationary, matching outer frames. Their content scrolls **inside**
the frame, so the top/bottom borders remain visible. Settings sections use spacing
and subtle dividers instead of nested bordered cards. Insets reserve room for
focus indicators; scrollbars never displace the other pane or shared actions.

## Preview and navigation

- A searchable grouped settings rail temporarily replaces the workspace sidebar.
  Account, Appearance, Writing and Storage stay visible in one list. Back to
  workspace restores the saved sidebar state/width; the settings rail does not
  overwrite it. Every category uses the same full-width outer frame. Appearance
  and Writing add the live split preview within that frame.
- **Appearance → Theme → Interface style** offers Axiom, Material Tonal, Fluent
  Studio, Editorial and macOS Studio component treatments. These affect controls, selection,
  navigation and surfaces—not just colors. Palette packs, custom colors, reading
  fonts, explicit shape/effect preferences and website templates stay independent.
  Public website reading preferences, six additional visual themes and privacy
  controls live under **Workspace → Website → Design / Analytics**, not the private
  application’s Appearance settings. See [website settings](WORKSPACE_WEBSITES.md).

- **Appearance → General → Show block ranges** controls the quiet vertical
  guides in visual editors. Enabled by default; nested ranges step inward and
  list groups share one neutral margin track per level. Emphasis follows
  the item under the caret or pointer; idle items and nested quotes do not gain
  duplicate rails. Read, Source and exported documents omit
  the guides. Changing the toggle does not modify notes, caret positions or layout.
  This category has a nested-list/quote sample; other Appearance categories share
  their existing appearance sample.

- The editor's folding gutter offers chevrons for multiline code,
  math, list groups, quotes, callouts, tables, metadata and rich footnotes. Click
  a chevron (or press Left/Right while it has keyboard focus) to collapse/expand;
  collapsed blocks show a compact summary with an expand ellipsis. Folds remain
  local to that editor view, survive Write/Source/Read switches and rebase through
  peer edits. Explicit navigation into hidden contents opens enclosing folds.
  Guide visibility does not disable folding or hide its collapsed-state controls.

- **Appearance → General → Show reading marks in the margin / Show reading marks
  overview** independently toggle block markers/actions and the right-edge map.
  Both default on; saved bookmarks and annotations remain in Reading marks when
  hidden. Bookmark editing, tagging, coloring, deletion/Undo and export also live
  in Storage → Offline research. See [reading marks](READING_MARKS.md).

- **Appearance → General → Show document minimap** adds an opt-in, current-mode
  document miniature outside the writing area. Configure visibility in Write,
  Source and Read, position, width, sizing, text/block rendering, previews and
  indicators. Click/drag/wheel only scroll; the typing caret stays in place.
  Saved marks share its overview lane, with search, selection and collaborator
  indicators. The private scratchpad previews these settings before Apply.
  See [minimap](MINIMAP.md) for keyboard commands and navigation boundaries.

- **Account → My groups** opens inside the existing Settings tab. The shared
  group screen provides search, invitations, and create/join/leave actions;
  creating or accepting a group keeps this Settings view open. Explicit Members
  and Manage group links still open the relevant workspace pages.
- **Storage → Management** contains the existing storage usage, quotas and
  file-version controls at `/workbench/settings/storage`. The sidebar has no
  footer shortcuts; these actions live in Settings navigation instead.
- Drag the divider to resize the panes. With the divider focused, Left/Right
  adjusts the width, Shift makes larger adjustments, Home/End selects the limits,
  and Enter or a double-click restores the default split.
- The Preview button hides or shows the right pane without clearing its content.
  Write, Read and Source share the same disposable sample. Reset sample restores
  the starting content.
- One **Try it here** toolbar contains the quiet Writing/Interface switcher.
  Writing exposes Write/Read/Source and Reset; Interface exposes the live palette
  state. Both surfaces remain mounted. Switching retains text, undo, mode,
  specimen values and each scroller's position, while closing the specimen menu.
  Toolbar groups wrap within the same header in narrow desktop panes.
- Theme, Typography, Layout and Device changes preserve their sample. Switching to General or a different
  Writing sample category, leaving preferences, or reloading starts a fresh sample.
  Split width and preview visibility are session UI state, not account preferences.
- The sidebar searches category names; the search above the fields filters the
  current category's controls. Both offer explicit clear controls and empty states.
- Keyboard shortcuts use a full-width command list, searchable by command and
  human-readable key label. Customized only filters overrides. Recording,
  disabling and resetting bindings retain keyboard focus and existing conflict
  checks.

The preview owns an in-memory Yjs document, with no collaboration provider,
account storage, note identity or upload destination. Sample edits never modify a
real note. Hiding the preview does not destroy its editor session.

## Save and cancel boundaries

Appearance and Writing retain their existing shared draft, validation,
conflict resolution and synchronization. Apply commits preferences; Cancel
restores applied values. Switching to another application tab retains the Settings
draft. Closing the Settings tab with an unsaved draft offers Apply, Discard or Stay.
Previewing is not saving.

When visiting an Account category with pending Appearance/Writing changes, a
separate top notice offers **Apply preferences** or **Discard preference changes**.
It does not reuse an account form's Save or Cancel action.

Profile groups identity, research information and working rhythm. Biography and
profile links have visible limits; more than eight links blocks submission.
Save changes is enabled only for a changed, valid form. Cancel changes restores
that form's last saved values, without discarding pending appearance preferences.
Saving disables the fields until the request settles; a failed save retains the
draft for retry.

**Account → Profile → Change photo** opens a local crop dialog before uploading.
Move the square selection, drag a corner to resize it, or enter exact dimensions;
arrow keys adjust by one pixel (Shift by ten). The round preview shows the avatar
as collaborators will see it. Reset restores a centered square; Cancel or Escape
leaves the saved photo unchanged. **Save photo** uploads only the selected area,
at 256 × 256 px, separately from other unsaved profile fields. The profile and
account-toolbar photo refresh together. Image metadata is removed and EXIF
orientation is respected. PNG/JPEG/GIF/WebP inputs are limited to 5 MB and
20 megapixels; animated inputs use a still frame. Large photos use a bounded
working preview, but the saved crop is sampled from the original resolution.
Failed uploads keep the crop for retry; stale profile versions cannot overwrite
newer changes. Unsaved crop selections are not durable across a page reload.

Notifications groups in-app choices and delivery options, with matching switches,
changed-state Save/Cancel actions and a saved baseline. Cancel affects only the
notification form. Visited profile/notification forms remain mounted while switching
categories or pages. These drafts are not durable and do not survive a
reload unless saved; closing a dirty Settings tab prompts before discarding them.

## Implementation and verification

`SettingsSplitPanel.tsx` owns pointer/keyboard resizing; `settings.css` scopes the
layout and form treatment; `interface-styles.css` owns the common settings rail,
frame and component presentations. The shared native controls are defined in
`components/ui/controls.tsx` and `ui-controls.css`; precision sliders coalesce
expensive preview updates to a frame and flush the last value on release/blur.
See the [control contract](UI_CONTROLS.md). Appearance schema 11 adds macOS Studio
to the registry; schema 10 adds `interfaceStyle`, defaulting to Axiom, while schema 9 adds PDF-reader defaults, retaining
nested minimap preferences from schema 8, the reading-mark toggles from schema 7
and `blockGuides` from schema 6. Versions 1–10 migrate without dropping
saved choices; older readers receive a compatible shape, and stale writes are
rejected with 426.
Save, cancel, section reset, offline merging and previous preferences include it.
The appearance update needs no database migration, document format or new
dependency; annotation threads separately require migration 19. Divider and
control focus remain visible; reduced-motion and forced-color preferences are
respected.

Research processing provider configuration is grouped into Connection,
Credentials & limits, and Capabilities & availability, with aligned fields and
a fixed action footer. Closing a changed dialog offers Keep editing / Discard;
discard clears an entered credential. The existing encrypted server-side storage
and explicit-submission policy are unchanged. Credentials are never saved as
browser drafts.

`tests/e2e/settings-panels.spec.ts` checks independent scrolling, resizing,
preview preservation, desktop overflow, search, shortcut focus, account form
cancel/save/failure and separate draft boundaries against isolated test accounts.
`tests/e2e/editor-appearance-guides.spec.ts` checks guide preview, cancel, save,
reload, section reset and old-client read/write negotiation without changing notes.
`tests/e2e/minimap.spec.ts` checks minimap preview, cancel, persistence, old-client
protection, navigation, markers, folding and bounded large-document rendering.
`tests/e2e/interface-harmony.spec.ts` adds frame-edge/scroll geometry, toolbar
ownership, retained specimen and undo state, scaled desktop layouts, zero-radius
and no-shadow checks, with fresh screenshots in the test output directory.
Settings suites accept the isolated port-3002 candidate or port-3004 staging;
interface harmony and Canvas acceptance use port 3004. Do not point these fixtures
at production or the normal development database.
`tests/e2e/settings-navigation.spec.ts` checks embedded groups, create/join/leave
and invitation acceptance, retained profile drafts, Storage → Management, reloads,
and footer removal on the port-3004 candidate.
`tests/e2e/avatar-crop.spec.ts` checks crop/cancel/save, selected output pixels,
EXIF orientation/removal, profile drafts, toolbar updates, invalid inputs, upload
retry and stale-version protection on the isolated port-3004 candidate.
`npm run test:dev` refreshes screenshots from port 8080 using disposable previews
and canceled account edits, without saving live preferences or changing notes.
See [editor verification](EDITOR_VNEXT.md) and the
[interface verification guide](INTERFACE_ACCEPTANCE.md).

## Extensions and retained forms

[Extensions](EXTENSIONS.md) has matching directory/detail frames, independent
scrollers, default-disabled installs, workspace consent, exact group approval,
configuration/shortcuts, package update/rollback and activity. Configuration
drafts survive package and settings-category switches; stale revisions are never
silently overwritten. Profile, notification and extension forms use one settings
exit guard, alongside appearance/writing preview. Native Save/Discard stays with
the responsible form. Safe mode is a device/account runtime switch, not a grant.
