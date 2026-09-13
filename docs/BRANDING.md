# Axiom identity

Two document forms meet at a shared junction: individual research becomes connected
knowledge. The mark is an original, editable vector, not a font glyph or an upstream
editor logo. Use **Axiom** as the wordmark and **A shared space for research** as the
tagline. The application remains a research-group beta; branding does not change
its release status or permissions.

## Color, scale and placement

| Role    | Color     | Use                                                   |
| ------- | --------- | ----------------------------------------------------- |
| Ink     | `#334d64` | Primary mark and opaque installed-app tile            |
| Paper   | `#f9f8f4` | Reversed mark and light showcase backdrop             |
| Mineral | `#216c78` | Optional accent, never the only indication of meaning |

Prefer one color. Use the ink mark on light backgrounds and paper on dark ones.
The app's inline mark follows the account's semantic accent/on-accent colors and
radius; never replace user preferences with brand colors. Keep the background
opaque for installed-app icons. The foreground fits the central maskable safe zone.

Reserve at least one junction diameter of clear space around the standalone mark.
Use 24px or larger for normal UI; review 16px and 32px favicon reductions separately.
Do not stretch, rotate, add glows or shadows to the mark, remove a page, or turn it
into a generic action icon. Keep the live wordmark in the existing UI font at medium
or semibold weight. Do not bake additional lettering into the mark.

The shared `BrandMark` is decorative beside a wordmark or an already-named control.
An icon-only home link must retain its accessible name. Standalone SVGs contain a
title and accessible label; light/dark marks must not create duplicate announcements.

## Sources and regeneration

The geometry and palette live in `packages/shared/src/brand.ts`. Both the React
component and server PNG icon route consume it. Do not edit generated SVG/PNG files
independently.

```sh
npm run brand:build
```

This deterministically exports [ink](assets/brand/mark-ink.svg),
[paper](assets/brand/mark-paper.svg) and [mineral](assets/brand/mark-mineral.svg)
SVGs and matching transparent 512px PNGs into `docs/assets/brand/`. Public assets
include the SVG favicon and opaque 32/180/192/512px tiles. Normal production builds
also regenerate these files. Existing PNG icon routes remain valid; a new 180px
route supplies the Apple touch icon.

When geometry changes, bump `brandVersion`, update the manifest icon query versions,
and regenerate. The offline manifest includes the current versioned icons. The PWA
continues to wait for the user's safe update confirmation; it never reloads an
unsaved research session just to change branding. Installed launchers may refresh
their cached icon on their own schedule.

## Demonstration assets

README banners show real editor and Canvas views populated with fictional research
content. Light and dark captures are taken separately; no interface controls or
capabilities are drawn into screenshots. Keep the small “demonstration workspace”
caption when reusing them. Do not publish user names, private notes, authentication
tokens, or test traces.

See the [documentation asset workflow](SHOWCASE.md) for capture and composition.
The curated assets are intentional repository files; raw browser evidence stays in
ignored test output. Third-party font notices remain applicable. This guide does
not grant a new license to the application or its assets.
