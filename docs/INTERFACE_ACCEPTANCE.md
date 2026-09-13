# Interface consistency verification

The Appearance workbench uses matched stationary frames, inset independent
scrollers, a single preview toolbar and actions outside the scrolling content.
Related changes cover account/management forms, Explorer action geometry, tool
surfaces, contextual editor controls, and flexible Canvas card chrome. Settings,
document formats, access roles and collaboration remain unchanged.

## Reproduce safely

Use the local `npm run staging` workflow with a separate `axiom_*test*` database
and attachment directory; never reuse production or ordinary development data.
The full application suites below require port 3004, the sync service and the
background worker. Use `TEST_OWNER_EMAIL` and `TEST_OWNER_PASSWORD` for the
administrator created in that isolated database. Disable real email delivery.

After building and starting that candidate:

```sh
TEST_APP_URL=http://localhost:3004 NEXT_PUBLIC_AXIOM_EDITOR_ENGINE=milkdown npx playwright test tests/e2e/interface-harmony.spec.ts tests/e2e/settings-panels.spec.ts tests/e2e/productivity-settings.spec.ts tests/e2e/canvas-v1.spec.ts tests/e2e/workspace-location.spec.ts tests/e2e/research-tools.spec.ts --output=test-results/interface-acceptance
```

Repeat the settings/interface checks with `TEST_BROWSER=firefox` and
`TEST_BROWSER=webkit`, using distinct output directories. The historical
`milkdown` deployment gate selects the existing Axiom editor adapter; this work
does not introduce another editor.

For database-free editor regression, run `npm run editor:lab`, then:

```sh
npm run test:editor -- tests/editor-lab/chrome-layout.spec.ts tests/editor-lab/tables.spec.ts tests/editor-lab/table-contracts.spec.ts tests/editor-lab/empty-blocks.spec.ts tests/editor-lab/footnote-rich.spec.ts tests/editor-lab/task-alignment.spec.ts tests/editor-lab/image-appearance.spec.ts tests/editor-lab/document-decorations.spec.ts tests/editor-lab/quoted-equations.spec.ts
```

Also run typecheck, lint, unit tests, build, `validate:themes` and `docs:check`.

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
