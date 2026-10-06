# Application controls and layout contract

This is the implementation checklist for new and revised application UI, including
the browser-local showcase. Use it with the [design system](DESIGN_SYSTEM.md),
[theme contract](THEME_AUTHORING.md) and [interface acceptance](INTERFACE_ACCEPTANCE.md).
Document content is a separate boundary: property tables, code/TeX source fields
and Markdown task nodes keep their transparent, source-backed editor treatment.

## One implementation, native semantics

Import from `apps/web/components/ui/controls.tsx`. Do not draw another checkbox,
switch, slider or general action button in a page stylesheet. These components
forward native props/events/refs; they do not replace controls with clickable divs.
Checkbox/Switch/Radio are void native inputs, not label wrappers. Place label text
in a surrounding label or an associated Field; content/HTML props are rejected by
their TypeScript contracts to prevent page-wide React rendering failures.

| Component                | Use                                                        | Important contract                                                                                                       |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Button`                 | A labeled application action                               | Specify `type="button"` for non-submit actions inside forms. An omitted type retains native submit behavior.             |
| `IconButton`             | A compact, secondary action                                | Supply `label` or an accessible name and tooltip. Icons alone cannot explain an irreversible action.                     |
| `Checkbox`               | Selection, consent or an included option                   | Keep the full label clickable. Use `indeterminate` for a partial group selection.                                        |
| `Switch`                 | An immediately applied binary preference                   | Label the setting, not “On/Off.” Keep explanations associated with `aria-describedby`.                                   |
| `Radio`                  | One choice in a native named group                         | Retain the shared `name` and native keyboard behavior.                                                                   |
| `Slider`                 | A bounded numeric adjustment                               | Retain native min/max/step, keyboard and disabled semantics. Supply units in `aria-valuetext`.                           |
| `Field`                  | A labeled input with guidance/error                        | Associates IDs, existing descriptions and error text without an extra form.                                              |
| `TextInput` / `TextArea` | Application text, numeric, date and multiline fields       | Forward native form/validation/autofill props and refs. Document fields opt out with `data-editor-field`.                |
| `NativeSelect`           | Short, stable sets such as status and priority             | Preserve native keyboard and form serialization; use `Picker` for large/entity sets.                                     |
| `SearchField`            | Search with an aligned leading icon                        | The icon is inside the field's reserved inset, never a loosely aligned adjacent control.                                 |
| `InputGroup`             | A native field with a decorative prefix or trailing action | Owns one shared surface and focus ring. Native IDs, descriptions and invalid state are forwarded to the control.         |
| `Picker`                 | Searchable single/multiple entity choices                  | Query text never becomes an ID. Retain selected labels, abort stale lookups and expose loading/error/retry/empty states. |
| `ActionRow`              | A wrapping group of application actions                    | Supports start/end/between alignment; preserves native form ownership.                                                   |
| `HelpText`               | Routine explanation, counts or limits                      | Transparent and unboxed. Use `as="span"` for inline metadata.                                                            |
| `Notice`                 | A consequential warning, failure or important boundary     | Choose a semantic tone and write the consequence/recovery. Use `role="alert"` only for newly arising urgent errors.      |

Tabs, menus, listbox options, tree/directory rows, canvas ports and editor-engine
actions retain their specialized semantics. A general action in one of those
surfaces still uses the shared button; do not enlarge every menu row into a button
card. Legacy link-buttons and native engine `.button`/`.icon-button` actions
consume the same CSS base without adding React wrappers to the editable DOM.

## Geometry, typography and alignment

- Standard controls have a **minimum** 36px height at the default 15px UI font;
  compact/icon controls have a minimum 32px. They grow with UI text, wrap long
  labels, and never use a fixed height that clips content. Compact is for dense
  toolbars, not permission/consent forms.
- Single-line native selectors also use the shared text-scaled control height:
  Safari ignores their minimum height in native popup mode. Keep the native arrow
  and keyboard behavior; never replace them with a hardcoded-pixel page workaround.
- Use the UI font and shared `--size-ui`, `--size-ui-small`, `--control-text-size`,
  `--control-height` and `--control-height-compact` roles. No fixed 10px text in a
  settings section; prose and equations do not inherit these form roles.
- Use the 4/8/12/16/24/32px spacing rhythm. Keep icon/text centers aligned in
  buttons and toolbars. Align a checkbox to the first line of a multiline label,
  not the middle of the entire paragraph; switches align to the setting row.
- All controls reserve focus space. Radius derives from the chosen style and
  user radius; radius zero stays square. Functional radio dots/slider handles
  remain recognizable. Shadows None never removes selection or focus rings.
- Selection/action bars wrap within their own allocated layout slot. Use
  `min-width: 0` and owned scrollports rather than whole-page horizontal overflow.
  Never fix overflow by hiding an action, clipping a label, or shrinking text.

## Text fields and adaptive choices

All application fields share the semantic `--field-surface` and `--field-edge`
roles in `ui-controls.css`. Material is tonal; Editorial is paper-flat; the other
styles follow their selected surface treatment. Hover only changes the edge;
focus is an inset ring, not a second rounded underline or a layout-changing
outline. Disabled and read-only fields remain identifiable. Width is a layout
decision via `--field-width`; do not redraw fields to fix a parent layout.

Use one visual shell per field. `SearchField` already owns its icon, surface and
optional clear action; place it directly in the layout rather than wrapping it in
another bordered search label. Use `InputGroup` for other decorative prefixes and
trailing actions, and `Field` for the label above it. Icons live in fixed,
text-scaled flex tracks centered against the control, not absolute offsets or a
global label's column layout. Never put an icon before a raw application field.
`Field.icon` is decorative; its label text wraps independently and remains linked
to the native input. Choose either a label icon or an input prefix when they convey
the same information, not both. Keep guidance/errors in their own aligned rows.

Legacy toolbar selectors must exclude shared `.ui-input` fields. Never impose a
second fixed height or padding on a SearchField's child input: the wrapper owns
the border and shared tokens own height. Align adjacent labeled SearchField and
NativeSelect shells, including labels and centers, in all styles. Settings header
actions must retain intrinsic non-shrinking label widths; wrap whole search/action
groups instead of breaking “Preview” into fragments. Inspect 1024/1280px desktops
and enlarged UI text.

Clear buttons are named, non-submit actions. Reserve their slot so typing or
clearing does not move the field text; clearing restores input focus. Multi-select
labels wrap without pushing remove actions out of view. Grid columns need enough
space for a real selected name, not just an icon: use content-aware `auto-fit`
columns instead of always dividing a narrow inspector in two. At large UI sizes,
wrap the toolbar's controls as units. Short actions such as “Manage groups” must
not be compressed by a 100%-wide selector; size static selectors intrinsically
and keep those action labels on one line.

`Field.action` places a named non-submit action alongside its actual control,
below the full-width label and above guidance/errors. Use this for property Clear
actions; never position them with a fixed label-height margin. The original native
child still owns the linked ID and ARIA descriptions. Wrapping labels, long picker
values and enlarged UI text must not move the action to the label's baseline.

Use native selectors for small static sets. People, tasks, files, milestones and
other long choices use the shared Picker. Search authorized server data rather
than a currently filtered table. Resolve selected IDs separately and preserve
labels across subsequent queries or transient errors. An unavailable selection
stays selected until the user removes it; do not turn an error into an empty save.
The server still validates current access and existence on save.

Pickers preserve native form ownership and required validity. Arrow keys move,
Enter selects, Escape closes only the popup, Tab continues through the form, and
composition events do not select prematurely. Options remain inside their owning
dialog's DOM but use the native popover top layer; opening another editor/app
overlay closes the previous one. No body portals or nested focus traps. Async
search must be bounded, abortable and retryable; stale results cannot win a race.

Do not style Markdown source/property/code/math inputs as application forms.
Those fields remain explicitly `data-editor-field`, transparent and source-backed.
Time-zone completion retains its existing validated native autocomplete.

### Collection review and transfers

Reuse the shared workspace-import host for Add files, directory menus and commands.
Use a searchable Picker for destination workspaces, native selectors for small
policy sets, and existing Dialog body/footer slots. Hierarchy and local Preview/Source
own their scrollports; do not put actions inside either. Keep destination audience,
exclusions and non-overwrite names visible before confirmation. Local preview must
not open external images/URLs, persistence or collaboration. Quiet recovery polling
must never reset loaded content or trigger the app's foreground progress line.
Files over one part use bounded checksum slices in a pure worker module, not a
page/API-client dependency graph. See [import contracts](WORKSPACE_IMPORTS.md).
Load the preview editor on demand, not through an unconditional app-shell import;
its pending surface must preserve the allocated pane and action-footer geometry.

### Server-filtered archives

Use shared SearchField/NativeSelect/Checkbox for filters, native named pagination
actions and an announced result count. Debounce only search reads, never mutations
or draft typing. Reset page positions when result-affecting filters change. A failed
read is not an empty archive; retain same-target transient data and expose Retry.
Keep full rich bodies out of summary responses and load authorized details explicitly.
Do not replace an open form's source/version on a peer refresh. Fixed DialogFooter
actions must remain outside the scroll body and inside their native form owner.
Short row actions wrap as whole controls beside long titles rather than clipping
labels or forcing page-wide horizontal scrolling. Record whether positions are live
or frozen; a cursor is neither a permission grant nor a stale-save workaround.
Own the results scrollport; filters, counts and pagination stay reachable outside
it. Reserve focus space and scrollbar geometry without moving the page footer.
Secondary archive/date/status filters belong in a compact shared dialog when
inline expansion would starve results at enlarged text or on a short desktop.
Do not disable a loaded page action merely for background revalidation: disabling
between pointerdown and pointerup can cancel a user's click. Foreground page
changes (no current-target data), writes and denied access retain their own gates.
Page/filter changes reset only the results scroll, not the document or its draft.

## Numeric and color preferences

Use `NumberPreference` for appearance controls: slider plus precise native number
field, unit and Reset. Validate finite values against bounds, snap relative to the
minimum/step, and keep an invalid draft with a visible correction message. Enter
commits; Escape restores the applied value. Do not submit a containing form when
using Enter to commit a field. Disabled numeric fields/sliders/resets stay disabled
together; explicit fields complement drag gestures.

The slider updates its filled track immediately, including uncontrolled inputs.
Appearance preview changes are coalesced to one animation frame; pointer release,
key release, blur and category unmount flush the final value. This is **not** a
debounce of source edits, undo, saving or collaborative transactions. Do not put
document-changing work behind a delayed slider value.

Colors use `ColorPreference`: a visible swatch, editable validated value, Copy,
Reset, associated error and a stable hit area. Do not hide the native picker or
use a text-only field as the sole color indicator. Preserve draft/cancel boundaries.

## Action hierarchy and pending state

One primary action per logical group, not necessarily per whole page. Routine
secondary actions use the surface treatment; tertiary actions are ghost/icon
controls. Place destructive actions last, separate them from routine actions,
and preserve the existing confirmation, permission and irreversible-work guards.
Use semantic `--on-accent` and derived `--on-danger`, never a hardcoded white label.

Keep pending labels and geometry stable:

```tsx
<ActionRow align="end">
  <Button type="button" onClick={onCancel} disabled={saving}>
    Cancel
  </Button>
  <Button type="submit" variant="primary" pending={saving}>
    Save changes
  </Button>
</ActionRow>
```

Pass `pending` in both idle/busy states so its spinner space is reserved. The
button becomes disabled and announces busy; the text still names the action.
Keep a failed draft and place actionable errors near the responsible control.
Do not discard values or let another click duplicate a request. Long-running
jobs need their actual status/cancel surface, not a fabricated progress percentage.

## Hints are not cards

A limit, count, explanation or ordinary empty-state hint uses `HelpText`, without
background, border, padding or another nested card. A checkbox label is just a
label; it must not inherit the old padded `ws-note` treatment. Important public
visibility, irreversible purge and AI approval/recovery boundaries use `Notice`
with an icon and text. A color alone is not a warning. Notices may hold paragraphs
or lists; do not nest a paragraph inside a paragraph.

## Dialogs and settings

Use `Dialog`, `DialogBody` and `DialogFooter`. The shell is viewport-centered;
its header/footer stay fixed and only its body scrolls. Form controls and submit
buttons keep the same form owner. Do not add a competing absolute footer, second
scrollport around the entire dialog, or a page-local dialog reset.

The shell preserves native focus trapping and opener restoration. First focus
goes to `initialFocus` (a ref), then an explicit `data-dialog-initial-focus` target,
then the safe Cancel/Keep/Back action for a destructive confirmation, or the first
usable input/textarea/select. No field means native dialog focus remains valid.
The close icon must not take first focus from a creation form. Preserve busy/dirty
guards on Escape/backdrop/close; choosing Cancel must not silently approve work.

Settings use consistent navigation, matching stationary pane frames and independent
scrollers. The Writing/Interface switch belongs in the preview toolbar. Keep both
surfaces mounted to preserve sample text/undo and specimen state. Routine sections
use whitespace and rules, not layers of filled cards. Keep Apply/Cancel or Done
outside scrollable fields. Production preferences remain transactional; the static
showcase remains browser-local and immediate-save.

## Interface styles are independent of palettes

### Extension and inspector UI

Extension packages contribute validated data, never HTML/CSS/React or their own
control drawing. The host owns identity, permission dialogs, source links,
review controls, escape behavior and focus. Render declarative fields with the
shared native controls; paginate tables and preserve field drafts on an inspector
owner switch. Background extension execution must never focus or rewrite source.

Document context, file details, assistant and extension inspectors share one
explicit owner. Hiding a pane retains its draft; stopping/restarting a worker is
an explicit lifecycle action. Commands target the active pane's registered
resource/workspace, not whichever DOM editor was most recently queried. Native
shortcuts have priority; extensions never steal typing/composition/dialog keys.

Settings directories use stationary matching frames, interior scrollports and
unboxed metadata, not a full-page nested scroller. Cache configuration drafts
above the selected package projection and keep the surface mounted across
category switches. Use the central retained-form exit guard: never stack another
confirmation dialog on top of the settings guard. Save the original revision;
display a conflict without dropping the draft. Activity surfaces link existing
job controllers, preserve permission/failure states and never auto-retry work.

The typed registry `packages/shared/src/interface-styles.ts` owns IDs and labels;
production and showcase consume the same registry. Presentation belongs to
`interface-styles.css` and shared control tokens on the root element, so portals
inherit the chosen style. The default stays **Axiom**.

- **Axiom:** quiet research surfaces and balanced controls.
- **Material Tonal:** rounded tonal buttons, expressive slider handles and soft
  selection.
- **Fluent Studio:** precise borders, layered panels and restrained selection.
- **Editorial:** flat paper, minimal elevation and straight, understated rules.
- **macOS Studio:** softly grouped controls and restrained desktop chrome.

Each treatment covers controls, selection, navigation and overlays. It must honor
palette overrides, independent font roles, density, radius, motion and shadow
preferences; it must not change document content, routing or permissions. Trusted
styles are reviewed source, not user-uploaded CSS or claims of platform conformance.

## Verification and drift prevention

`npm run validate:ui` parses application/showcase JSX with the TypeScript AST. It
rejects raw application input/textarea/select and checkbox/range declarations (including conditional type expressions),
ad-hoc adjacent Lucide icons and application fields,
legacy `ws-note` hint cards, raw `ws-actions` groups and native general action-button
markup. The only native-owner exemption is `components/ui/controls.tsx`, not a
folder allowlist. Editor-engine DOM and document-task rendering have a different
semantic contract; this guard is not a security sandbox or a complete CSS audit.

The guard runs in root `check` and showcase CI, alongside theme and documentation
checks. New controls require native-prop/ARIA unit coverage and screenshot/interaction
review. Inspect all five styles in light/dark, large UI text, compact density,
long labels, invalid/disabled/mixed/pending states, radius zero, shadows None,
reduced motion and forced colors. Keyboard must reach every action. Verify
Chromium, Firefox and WebKit; physical IME/clipboard and assistive technologies
remain separate manual acceptance, not consequences of a synthetic test pass.

Use **Settings → Appearance → Interface** or **Showcase → Appearance → Interface**
for the real interactive specimen. It includes native switch, filled slider,
mixed/disabled selection, validation and stable pending actions; it never performs
real file/account operations. Keep specimen behavior in the shared component,
not a second mock implementation in a theme.
