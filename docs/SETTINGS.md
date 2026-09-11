# Settings workbench

Appearance and Writing use a two-pane desktop layout: controls on the left and
**Try it here** on the right. Each pane scrolls independently; Apply and Cancel
stay outside both scrollers. The scratchpad uses the current editor and personal
document styles, while settings controls keep the interface typography.

## Preview and navigation

- Drag the divider to resize the panes. With the divider focused, Left/Right
  adjusts the width, Shift makes larger adjustments, Home/End selects the limits,
  and Enter or a double-click restores the default split.
- The Preview button hides or shows the right pane without clearing its content.
  Write, Read and Source share the same disposable sample. Reset sample restores
  the starting content.
- Appearance category changes preserve the sample. Switching to a different
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
restores applied values. Leaving settings with an unsaved preference draft still
offers Apply, Discard or Stay. Previewing is not saving.

When visiting an Account category with pending Appearance/Writing changes, a
separate top notice offers **Apply preferences** or **Discard preference changes**.
It does not reuse an account form's Save or Cancel action.

Profile groups identity, research information and working rhythm. Biography and
profile links have visible limits; more than eight links blocks submission.
Save changes is enabled only for a changed, valid form. Cancel changes restores
that form's last saved values, without discarding pending appearance preferences.
Saving disables the fields until the request settles; a failed save retains the
draft for retry. Avatar changes still save immediately and are labeled accordingly.

Notifications groups in-app choices and delivery options, with matching switches,
changed-state Save/Cancel actions and a saved baseline. Cancel affects only the
notification form. Account text/notification drafts are not durable drafts and do
not survive navigation or reload unless saved.

## Implementation and verification

`SettingsSplitPanel.tsx` owns pointer/keyboard resizing; `settings.css` scopes the
layout and form treatment. No preference schema, database migration, editor engine,
collaboration contract or dependency changed for this refinement. Divider and
control focus remain visible; reduced-motion and forced-color preferences are
respected.

`tests/e2e/settings-panels.spec.ts` checks independent scrolling, resizing,
preview preservation, desktop overflow, search, shortcut focus, account form
cancel/save/failure and separate draft boundaries against isolated test accounts.
`npm run test:dev` refreshes screenshots from port 8080 using disposable previews
and canceled account edits, without saving live preferences or changing notes.
See [current verification](EDITOR_VNEXT.md#verified-candidate-coverage) and the
[screenshot index](../test-results/README.md).
