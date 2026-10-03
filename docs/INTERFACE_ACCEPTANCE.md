# Interface consistency verification

The Appearance workbench uses matched stationary frames, inset independent
scrollers, a single preview toolbar and actions outside the scrolling content.
Related changes cover account/management forms, Explorer action geometry, tool
surfaces, contextual editor controls, and flexible Canvas card chrome. Existing
preference draft/cancel behavior, document formats, access roles and collaboration
are preserved. The five interface treatments use Appearance schema 11; see the
[theme contract](THEME_AUTHORING.md) for legacy reads and stale-writer protection.

## Reproduce safely

Use the local `npm run staging` workflow with a separate `axiom_*test*` database
and attachment directory; never reuse production or ordinary development data.
The full application suites below require port 3004, the sync service and the
background worker. Use `TEST_OWNER_EMAIL` and `TEST_OWNER_PASSWORD` for the
administrator created in that isolated database. Disable real email delivery.

After building and starting that candidate:

```sh
TEST_APP_URL=http://localhost:3004 NEXT_PUBLIC_AXIOM_EDITOR_ENGINE=milkdown npx playwright test tests/e2e/ui-controls.spec.ts tests/e2e/interface-harmony.spec.ts tests/e2e/settings-panels.spec.ts tests/e2e/productivity-settings.spec.ts tests/e2e/canvas-v1.spec.ts tests/e2e/workspace-location.spec.ts tests/e2e/research-tools.spec.ts --output=test-results/interface-acceptance
```

Repeat the settings/interface checks with `TEST_BROWSER=firefox` and
`TEST_BROWSER=webkit`, using distinct output directories. The historical
`milkdown` deployment gate selects the existing Axiom editor adapter; this work
does not introduce another editor.

For database-free editor regression, run `npm run editor:lab`, then:

```sh
npm run test:editor -- tests/editor-lab/chrome-layout.spec.ts tests/editor-lab/tables.spec.ts tests/editor-lab/table-contracts.spec.ts tests/editor-lab/empty-blocks.spec.ts tests/editor-lab/footnote-rich.spec.ts tests/editor-lab/task-alignment.spec.ts tests/editor-lab/image-appearance.spec.ts tests/editor-lab/document-decorations.spec.ts tests/editor-lab/quoted-equations.spec.ts
```

Also run typecheck, lint, unit tests, build, `validate:ui`, `validate:themes` and `docs:check`.

The database-free control matrix uses the **shared real Interface specimen** in
the built showcase. It covers all five interface styles in both color modes,
native checkbox/switch/slider behavior, scaling, pending/error/mixed states and
dialog geometry. Build first; do not test against a stale static output:

```sh
npm run showcase:build
npm run test:showcase -- tests/showcase/ui-controls.spec.ts
```

The test has no workbench account/API/sync access. It changes only that test
browser's isolated showcase preferences. See [UI criteria](UI_CONTROLS.md).

## Review the actual screenshots

Screenshots are generated in each test's output directory, not committed assets.
Use outputs from the current run; do not treat an old screenshot as acceptance.
The interface suite captures scroll extremes, the Interface specimen, scaled
Canvas cards, and dark/large-type account, management, Explorer and tool pages.
The editor lab captures scaled table/code/math controls in all three engines.

Verify aligned outer edges and insets, reachable footers, readable labels,
matching control baselines, and stable toolbar geometry. Test 1024–1920px desktop
widths, split limits, both color modes, maximum UI text with 150% scale, zero
radius, shadows None, keyboard focus and forced colors. Decorative effects must
not remove selection/connection outlines or keyboard indicators. Tables and tool
previews remain square/borderless where the document design calls for that.

Browser fixtures exercise synthetic input and collaborative rebasing. They do
not certify physical IME/clipboard behavior, assistive technologies or mobile
devices. Those remain separate manual acceptance work, not claims of this pass.

## Verified desktop control pass — 2026-10-03

The candidate used the isolated `axiom_ui_controls_test` database and its own
attachment directory, web/sync/worker services and disposable accounts. Ordinary
development data and the user's service on port 8080 were not reset or seeded.
Browser-local showcase and editor-lab fixtures do not contact account or sync APIs.

- Typecheck, lint, 2,060 unit tests in 108 files, both application/showcase builds,
  UI validation across 173 JSX files and both trusted theme-pack checks passed.
- The shared-control matrix passed 42 cases across Chromium, Firefox and WebKit:
  all five interface treatments in light/dark, precise numeric values, disabled
  and mixed selection, stable pending/error states, native form submission,
  destructive-dialog safe focus, opener restoration, large UI text, compact
  density, zero radius, no shadows, reduced motion and forced colors.
- The complete built-showcase suite passed all 93 cases across those browsers,
  including Markdown modes, local file import, Canvas, exports, local backup,
  settings navigation and pane-owned scrolling.
- The isolated production candidate passed 15 Chromium settings/interface cases
  plus six settings/control cases each in Firefox and WebKit. Extra targeted
  checks passed bookmark create/edit/delete, recovered reading records, block
  range preferences, three protected-file Trash cases, Math Studio live editing
  and export, and Image Studio paint/undo/save/recovery/version-fence behavior.
- Database-free editor regression passed 39 layout/task/table cases across the
  three browser engines; three additional find/replace/undo cases passed with
  the shared native checkbox styling.

Current-run screenshots were reviewed for production settings scroll extremes,
large-text group forms, image-studio controls, centered native dialogs and the
style gallery. Artifacts stay in ignored `data/ui-controls-*` directories; raw
traces, session state and fixture uploads must not be committed. This is scoped
desktop UI acceptance, not a full release, assistive-technology or physical
IME/clipboard certification.

## Verified fields and planning suite — 2026-10-03

The field/planning candidate passed typecheck, lint, UI/theme/doc validation,
2,081 unit tests in 109 files and both production/showcase builds. The final
built showcase passed all 93 Chromium/Firefox/WebKit cases, including the five
interface styles in light/dark, keyboard entity selection, multiple tags,
required native form validity inside dialogs and Escape/focus ownership.

The isolated production candidate (`axiom_planning_suite_test`, port 3004) passed
10 Chromium cases and four each in Firefox/WebKit: dependency offsets (including
typing a negative sign), whole-workspace lookups under filtered tasks, failed
lookup Retry, goals/intake, atomic/stale bulk operations, capacity cohort fences,
settings/draft/save behavior and preference compatibility. The legacy workflow
and synthetic 5,000-row virtual Gantt also passed all three browser engines;
production Chromium additionally exercised drag/resize, preview/apply/Undo,
milestone rows and dark larger-text geometry. Pure tests exercise a 50,000-task
chain/wide hierarchy and a 100,000-task capacity allocation, not an unlimited-scale
or live production load claim.

The disposable upgrade rehearsal preserves old task IDs, Markdown descriptions,
dates and file links. It checks additive schema/audit, private/shared view access,
linked-goal deduplication, member-only intake transitions/retry, recurring-worker
idempotency/history/future edits, and human-reviewed MCP/in-app change sets with
revocation. Tests never seed/reset normal research data.

Current screenshots were visually reviewed for the task timeline, dark enlarged
Gantt, centered picker form and Material/macOS field specimens. Artifacts remain
in ignored `data/planning-suite-*` and `data/showcase-results` directories. The
normal development database was backed up (database and 1,017 attachment
checksums verified), then additively migrated to 39 and its port-8080 web/sync/
worker services restarted. Backups are private, untracked and not published.

Physical IME/clipboard, screen readers and larger real-world portfolios remain
manual acceptance work. No commit, push, GitHub Pages or production deployment
is part of this verification.

## Verified icon fields and toolbar alignment — 2026-10-04

Application searches, entity pickers and time-zone inputs now share one field
surface, centered adornment tracks and stable trailing-action space. Field labels
retain native input associations; helper text and errors occupy separate rows.
The Workspaces directory toolbar wraps whole controls rather than splitting the
short **Manage groups** label. Document-source fields remain outside this shared
application-control boundary.

The final candidate passed typecheck, lint, 2,084 unit tests in 109 files, both
production/showcase builds, the UI contract across 177 JSX files, trusted-theme
validation and documentation-link checks. The built showcase passed all 93
Chromium/Firefox/WebKit cases, including the expanded field geometry, clear-action
focus, native label association and form-validity checks.

Using the isolated `axiom_planning_suite_test` database, the production candidate
passed 15 Chromium settings/control/discovery/toolbar cases and six control/
discovery cases each in Firefox and WebKit. The checks cover all five interface
treatments at standard and enlarged UI text sizes, light/dark colors, stable
clear-action geometry, single-line toolbar actions, native combobox keyboard and
mouse behavior, settings drafts and stale preference writers. The targeted Math
Studio symbol-library regression also passed. Ordinary development data was not
reset, and the user's web/sync services remained available on ports 8080/1234.

Current-run screenshots were visually reviewed for the enlarged dark Workspaces
toolbar, account time-zone fields, centered field dialogs, theme specimens and
the Search & commands dialog. Artifacts remain in ignored
`data/field-alignment-*` and showcase-result directories; fixture accounts,
screenshots, traces, generated route typings and private backups are not release
assets. This verification does not certify physical IME/clipboard, assistive
technologies, mobile devices or a production deployment.
