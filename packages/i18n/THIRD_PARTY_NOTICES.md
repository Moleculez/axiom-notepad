# Localization dependencies

The shared message formatter and ICU parser are from FormatJS and retain their
upstream BSD-3-Clause licenses. Exact versions are recorded in the root lockfile.

- [intl-messageformat](https://github.com/formatjs/formatjs/tree/main/packages/intl-messageformat)
- [ICU parser](https://github.com/formatjs/formatjs/tree/main/packages/icu-messageformat-parser)

The application and static showcase bundle Noto Sans Arabic, Noto Sans Devanagari
and Noto Sans Bengali as script fallbacks under the SIL Open Font License 1.1.
Their selected weights and font files come from the corresponding Fontsource
packages. The showcase’s generated `THIRD_PARTY_NOTICES.txt` carries the full
font license notices. No font requests go to third-party hosts at runtime.

These fallbacks do not replace a user’s selected typeface for characters it
already supports. The first-party catalogs and localization adapters use the
repository’s MIT license.
