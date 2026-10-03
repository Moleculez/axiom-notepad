# Axiom development contracts

- Read [design criteria](docs/DESIGN_SYSTEM.md) and [UI controls](docs/UI_CONTROLS.md)
  before changing application UI. Read [theme authoring](docs/THEME_AUTHORING.md)
  for theme/presentation changes. Use the native-compatible components in
  `apps/web/components/ui/controls.tsx`; do not add page-local slider/checkbox/switch
  drawing, padded hint cards or competing general button/dialog resets.
- Preserve the document-editor boundary: canonical Markdown, source-backed undo,
  collaborative anchors, transparent `data-editor-field` inputs and task-node
  semantics. App form styles must not leak into content or paper-style tables.
- Keep styles/palettes/fonts independent. Consume the shared typed interface-style
  registry in production and showcase; respect explicit radius, shadows, motion,
  contrast and font-size preferences. The default remains Axiom.
- UI validation includes `npm run validate:ui`, `npm run validate:themes`,
  typecheck, lint, unit tests and applicable build/browser gates. Inspect actual
  screenshots for alignment, wrapping, scroll ownership and footer visibility.
  Test both color modes, large text, keyboard, forced colors and reduced motion.
- Never run mutation tests against the working dataset. Use isolated staging or
  browser-local showcase/editor-lab fixtures. Preserve unrelated dirty files,
  private data and secrets. Do not publish, push or deploy without a user request.

See [contributing](CONTRIBUTING.md) for layout, commands and release boundaries.
