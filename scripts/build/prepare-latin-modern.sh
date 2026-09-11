#!/bin/sh
set -eu
font_stage=$(mktemp -d)
for face in regular italic bold bolditalic; do
  curl -fsSL --retry 2 "https://mirrors.ctan.org/fonts/lm/fonts/opentype/public/lm/lmroman10-${face}.otf" -o "${font_stage}/${face}.otf"
  pyftsubset "${font_stage}/${face}.otf" --glyphs='*' --layout-features='*' --name-IDs='*' --name-languages='*' --notdef-glyph --notdef-outline --recommended-glyphs --flavor=woff2 --output-file="packages/shared/assets/latin-modern/axiom-lm-${face}.woff2"
done
printf 'Converted fonts; upstream originals retained in %s\n' "$font_stage"
