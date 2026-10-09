# Interface localization

Axiom has a shared localization layer for the private workbench and browser-local
showcase. **This is a partial localization release, not a fully translated app.**
Ten choices work; navigation, common actions, language settings and selected
editor/research/planning controls have authored translations. The follow-up expands
settings descriptions and profile/security controls, group administration, file
management and import, Trash protection/removal, scheduling/goals/intake/time, and
reference-library/graph controls. Less-used copy and some dynamic messages still
show English. Key parity is not linguistic acceptance.

## Languages and behavior

| Choice             | Locale    | Direction |
| ------------------ | --------- | --------- |
| English            | `en`      | LTR       |
| 简体中文           | `zh-Hans` | LTR       |
| Español            | `es`      | LTR       |
| Français           | `fr`      | LTR       |
| العربية            | `ar`      | RTL       |
| हिन्दी             | `hi`      | LTR       |
| Português (Brasil) | `pt-BR`   | LTR       |
| Русский            | `ru`      | LTR       |
| বাংলা              | `bn`      | LTR       |
| Bahasa Indonesia   | `id`      | LTR       |

**Settings → Account → Language** offers Automatic and the ten autonyms. Automatic
matches browser preferences in order, including regional variants; unsupported
languages fall back to English. Traditional Chinese is not silently treated as
Simplified Chinese. Explicit choices override the browser; Automatic responds
to its `languagechange` event.

Changing the selector previews the interface. **Save changes** commits the account
preference; **Cancel** restores the applied choice. Appearance, Writing and Profile
drafts are independent. A retained preview uses the unsaved-settings guard. Choices
are cached per account with a durable offline outbox. A conflicting device change
requires an explicit decision; retries use the same mutation ID.

Showcase **Appearance → General → Language** applies immediately and saves only
in that browser, with no account API calls. Autonyms remain recognizable after a
switch. A failed catalog keeps the current language and choice recoverable.

There are no locale URL prefixes or redirects. Language changes must not change
Markdown, IDs, filenames, workspace names, citations, authored titles, tasks,
comments, revisions, collaborative anchors, undo, selection, folds or diagram zoom.
Published readers, emails, long help articles and third-party extension content
are outside this increment. Interface language does not select a document
language, change export content or send content to a translation service.

## Architecture

- `packages/i18n` owns matching, direction, typed IDs, ICU formatting, native
  number/date formatting and the active client catalog.
- Source catalogs live in `packages/i18n/src/messages`. English is bundled; the
  active language is loaded atomically from a versioned compiled asset. Source
  catalogs retain matching keys for review. Compiled catalogs omit matching-English
  values so they do not download the fallback again.
- `scripts/i18n/build.ts` prepares production/showcase ICU assets. Normal dev/build
  scripts prepare them. When running `dev:web` alone from a fresh checkout, run
  `npm run i18n:build` first. The production offline manifest includes all catalogs;
  fonts and catalogs are self-hosted, not remote runtime requests.
- `scripts/i18n/catalogs.mjs` hashes content independently of the working directory.
  Next uses a native ESM config to avoid compiler-hook resolution of sibling helpers.
  Docker includes this helper and the source catalogs at runtime.
- `GET/PATCH /api/v1/me/locale` reads/writes only the authenticated account. Forward
  migration **51** creates `user_locale_preferences`; applied schemas are not
  rewritten. Run the usual migration workflow before starting an updated app.
  Language is separate from the versioned appearance/editor preference bundle.
- `apps/web/lib/locale-preferences.ts` owns cache, preview, version checks, exact
  retry and account fencing. Saves during an initial read drain immediately after
  that read; failed writes do not spin.
- SSR/client startup is a neutral mark without personalized HTML. Ready language
  and direction apply before paint. Subsequent switches update consumers in place,
  never by keying or remounting the app.

## Adding interface copy

Use `useI18n().t(...)` for a whole message, `Message` / `I18nText` for React text,
and `bindText` / `bindAttribute` for imperative chrome. Existing immutable
English-copy IDs are typed against the English catalog, not data IDs. `uiText`
is a compatibility adapter for **known app registry labels only**. Never pass
authored names or values. Breadcrumbs mark authored labels explicitly so a file
named “Settings” remains “Settings” in every language.

Include punctuation, plural logic and parameters in the whole message. Never
join translated sentence fragments or append an English `s`. ICU plurals require
`other` and the categories needed by that language. Give distinct meanings distinct
messages: the noun “Type” and “Type {prefix} for commands” are not interchangeable.
Parameters keep identical names and types across catalogs. IDs, enum values,
English search aliases, shortcuts, syntax examples and stored state stay canonical.
Display closed role/status enums through reviewed label maps, with explicit
canonical `value` attributes on select options. A translated label must never
become an API role. Safety tokens such as `DELETE FOREVER` remain literal; translate
the surrounding complete instruction, not the token or authored filename.

`Message` has explicit `slots` for links, keyboard hints and styled elements.
Only caller-provided React nodes occupy slots; catalogs cannot introduce HTML.
Use active-locale native `Intl` for **visible** counts/dates, never timestamps,
positions, parsing or sort keys. Numeric/color inputs keep canonical editable values.

Bindings target UI text/attributes, never source-backed nodes. They update the
existing DOM and hold nodes weakly. Source search phrases reconfigure only their
locale compartment with `addToHistory: false`, retaining the document and editor.
Internal behavior uses stable data attributes, not translated ARIA labels.
Mark non-destructive dialog dismissal actions with `data-dialog-cancel`; initial
focus must not depend on an English button label. Native macOS keyboard tests
use Option-Tab when the system excludes non-text controls from ordinary Tab.

Extraction helpers produce inventory/migration suggestions, **not translations or
proof of coverage**. Review authored samples, protocol strings, templates and rich
sentences explicitly. Prefer normal catalog/component edits for future changes.

## Layout and typography

Follow [design criteria](DESIGN_SYSTEM.md) and [UI controls](UI_CONTROLS.md). Use
logical margins/borders/alignment. Mirror directional arrows, submenu placement
and navigation keys only; never math, images, code, PDFs, Canvas/Mind map coordinates
or an explicit minimap side. Reading/source surfaces keep their content direction
independent of chrome. Isolate mixed authored names rather than translating them.

Self-hosted Noto Arabic, Devanagari and Bengali fallbacks follow the primary font
before the generic family; they do not replace the selected preference. Respect
large text, density, radius, reduced motion and forced colors. Wrap controls and
use normal scrollports; do not truncate authored content to fit a translation.

## Validation and remaining acceptance

```sh
npm run i18n:build
npm run validate:i18n
npm run typecheck
npm run lint
npm run validate:ui
npm run validate:themes
npm run docs:check
npm test
npm run build
npm run showcase:build
npm run test:showcase -- tests/showcase/localization.spec.ts
```

The catalog gate checks keys, ICU, argument contracts and HTML boundaries. It also
protects **120 reviewed message IDs** across six UI areas against missing, blank or
English-fallback regressions in every non-English catalog. The scope lives in
`packages/i18n/src/translation-coverage.ts`, outside runtime bundles. Extend it
when completing a UI increment. Legitimately identical native wording requires an
explicit message/locale exception; exceptions never allow missing or blank values
and must not exempt an entire area. This is a structural review gate, not native
linguistic certification.

The gate writes matching-English entries to ignored `data/i18n/coverage.json`.
On 2026-10-09 the follow-up inventory has **5,303 messages**; non-English catalogs
have **1,744–1,792 differing translations each**, up by **773–778** from the first
localization checkpoint. **3,511–3,559 values per catalog still match English**.
Some are legitimate technical names, but most are untranslated UI. These counts
are not a completion threshold or a claim that an entire feature area is translated.

The account gate `localization.config.ts` reuses the registered, local-only
port-3004 extension staging profile and server health attestation:

```sh
npm run plugins:staging -- init
npm run plugins:staging -- build
npm run plugins:staging -- web
# In another terminal; never substitute a working or deployed URL:
npm run plugins:staging -- test --config localization.config.ts
```

Unit tests cover negotiation, plurals, fallbacks, stale/failed loads, account
isolation, offline exact retry and preview. Account browser tests exercise real
Save/Cancel, CAS and reload persistence, all ten profile languages without changing
authored values, and Arabic group dialogs at large text. The latter use read-only
theme response fixtures for both color modes, never saving appearance or creating
a group. Only that read-only layout fixture blocks service-worker registration so
network interception is reliable; it is not an offline/PWA acceptance test. The
other account flows retain normal worker behavior. Browser number expectations
use the engine's resolved numbering system rather than assuming Node's CLDR
defaults. Showcase tests cover ten choices,
route/source/undo preservation, Arabic, light/dark, large text, keyboard, forced
colors and reduced motion. Inspect screenshots: structural assertions alone are
not layout acceptance. Mutations run only on isolated data.

Before claiming an entirely localized app, finish long-tail translations, replace
remaining fragmented/dynamic messages, audit display registries and number/date
sites, extend the reviewed-copy coverage gate and obtain native-language review.
Physical IME and assistive-technology acceptance remain separate device gates.

The next translation passes should prioritize:

- Specialized PDF/annotation, image, math and diagram controls, including long
  inspection/export dialogs and recovery instructions.
- Assistant/provider consent and configuration, followed by website publication,
  domain setup and author analytics.
- Remaining composed messages, lifecycle/status displays, accessibility labels and
  user-visible API errors. Convert whole messages with canonical parameters;
  do not translate protocol error codes or arbitrary returned values.

Published readers, email templates and long help articles still need a separately
defined localization scope. The coverage inventory is a copy-review queue, not a
requirement to translate authored examples or technical identifiers.
