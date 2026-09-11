# Axiom Latin Modern webfonts

Latin Modern Roman, by Bogusław Jackowski and Janusz Marian Nowacki / GUST.
Source: [CTAN Latin Modern 2.005](https://ctan.org/pkg/lm).
Licensed under the accompanying GUST Font License and LPPL 1.3c or later.
`LICENSE.txt` includes the complete GUST notice and LPPL 1.3c text.

The four `axiom-lm-*.woff2` files are web-format derivatives of the 10-point
OpenType regular, italic, bold and bold-italic faces. Glyphs are not intentionally
changed; all glyphs and OpenType layout features are retained. The web family is
named `Axiom Latin Modern` to distinguish this format conversion. No runtime CDN.
This conversion is maintained with Axiom; upstream authors do not support it.

Rebuild with `scripts/build/prepare-latin-modern.sh` (curl, FontTools and Brotli needed).
Upstream source files are under
`https://mirrors.ctan.org/fonts/lm/fonts/opentype/public/lm/`.
The upstream manifest is
`https://mirrors.ctan.org/fonts/lm/doc/fonts/lm/MANIFEST-Latin-Modern.TXT`.

Manifest: `axiom-lm-regular.woff2`, `axiom-lm-italic.woff2`,
`axiom-lm-bold.woff2`, `axiom-lm-bolditalic.woff2`, `fonts.css`, `LICENSE.txt`,
this README. Export embeds the used fonts and their license.
