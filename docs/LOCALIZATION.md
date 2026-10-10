# Interface localization

Axiom has a shared localization layer for the private workbench and browser-local
showcase. **This is a partial localization release, not a fully translated app.**
Twelve choices work; navigation, common actions, language settings and selected
editor/research/planning controls have authored translations. The follow-up expands
settings descriptions and profile/security controls, group administration, file
management and import, Trash protection/removal, scheduling/goals/intake/time, and
reference-library/graph controls. Later passes add provider/assistant consent,
selected PDF tools, publication/analytics controls and MCP request lifecycle copy.
The reading-control increment adds complete editor command labels, minimap
choices and indicators, shortcut counts/recording/conflicts, color-field recovery
and shared production/showcase reading controls. Previously unregistered registry
labels are now known catalog IDs rather than silent English-only controls.
The runtime/editor-chrome increment adds closed preference-sync messages, live
metadata-field and fold labels, native Trash plurals, evidence-capture details,
Math Studio character counts and help-page navigation/search. Help chapters and
their authored titles remain English, explicitly marked `en-US`; the surrounding
controls and section search terms follow the interface choice.
The specialized-tool increment adds equation clipboard/export hints and feedback,
rendering controls, crop/resize/profile-photo dialogs, image tool names, blend modes,
adjustments and text-layer dialog controls. It does not complete the whole image or
math studio: recovery, project lifecycle and symbol/template descriptions still
need later passes.
Japanese, Korean and German have a smaller reviewed vocabulary than the original
eight non-English choices. Less-used copy and some dynamic messages still
show English. Key parity is not linguistic acceptance.

## Languages and behavior

| Choice                  | Locale    | Direction |
| ----------------------- | --------- | --------- |
| English (United States) | `en`      | LTR       |
| 简体中文                | `zh-Hans` | LTR       |
| Español                 | `es`      | LTR       |
| Français                | `fr`      | LTR       |
| 日本語                  | `ja`      | LTR       |
| 한국어                  | `ko`      | LTR       |
| Deutsch                 | `de`      | LTR       |
| हिन्दी                  | `hi`      | LTR       |
| Português (Brasil)      | `pt-BR`   | LTR       |
| Русский                 | `ru`      | LTR       |
| বাংলা                   | `bn`      | LTR       |
| Bahasa Indonesia        | `id`      | LTR       |

**American English is the default** for new accounts, guests, unset preferences
and showcase. Its persisted ID remains `en`; document language and shared `Intl`
formatters explicitly use `en-US`. Existing explicit Automatic choices remain
Automatic rather than being overwritten.

**Settings → Account → Language** offers Automatic and the twelve native names. Automatic
matches browser preferences in order, including regional variants; unsupported
languages fall back to English. Traditional Chinese is not silently treated as
Simplified Chinese. Explicit choices override the browser; Automatic responds
to its `languagechange` event.

Arabic is no longer an interface-language choice. A retired `ar` preference is
read as Automatic, while authored Arabic text and its self-hosted font fallback
remain untouched. Local caches discard a retired Arabic pending mutation instead
of silently changing its payload under the same retry ID. Regional `en-US` cache
values normalize to the stable `en` choice.

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
  migration **51** creates `user_locale_preferences`; forward migration **52**
  expands the allowed languages, defaults new records to `en` and retires `ar`
  to Automatic with a new version/receipt to fence old pending writes. Other
  saved choices are retained and applied migration 51 is not rewritten. Run the
  usual backup/migration workflow before starting an updated app.
  Language is separate from the versioned appearance/editor preference bundle.
- `apps/web/lib/locale-preferences.ts` owns cache, preview, version checks, exact
  retry and account fencing. Saves during an initial read drain immediately after
  that read; failed writes do not spin.
- SSR/client startup is a neutral mark without personalized HTML. Ready language
  and direction apply before paint. Subsequent switches update consumers in place,
  never by keying or remounting the app.
- Preference synchronization uses `apps/web/lib/preference-messages.ts`, a closed
  typed registry. The store keeps canonical statuses and renders them through the
  active catalog; validation failures do not expose raw schema-error JSON.
- Fold descriptions retain canonical kind/language/footnote keys and authored
  summaries. `fold-presentation.ts` owns the translated caption/actions; changing
  language repaints only their existing DOM, without rebuilding folds or editing
  Markdown/history. Metadata labels likewise preserve field drafts and selection.
- `apps/web/lib/tools/tool-presentation.ts` owns closed image-tool, blend,
  adjustment, geometry and equation-preview labels. Compact tool names are separate
  from shortcut tooltips, never English substrings or prettified engine IDs.
  Visible dimensions, opacity, zoom and export feedback use the active language;
  numeric/color input values, tool IDs, sampling choices and clipboard MIME types
  remain canonical. Fixed clipboard feedback is translated when it is presented,
  not inside the encoding engine. The PNG fallback for JPG is explained honestly.

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

Use native application terminology, not word-for-word equivalents: “Editor”
names the editing surface, not an editor as a person. Keep navigation labels
concise and inspect enlarged-text screenshots for awkward word splits. Shorten
the reviewed label when appropriate; do not shrink the user's chosen font or
introduce a competing layout to conceal a translation issue.

`Message` has explicit `slots` for links, keyboard hints and styled elements.
Only caller-provided React nodes occupy slots; catalogs cannot introduce HTML.
For example, the math-settings explanation is one complete sentence with a
`command` slot containing the literal `\require{physics}` code node. Translators
can move the slot to fit natural word order without translating or rebuilding TeX.
Use active-locale native `Intl` for **visible** counts/dates, never timestamps,
positions, parsing or sort keys. Numeric/color inputs keep canonical editable values.

Bindings target UI text/attributes, never source-backed nodes. They update the
existing DOM and hold nodes weakly. Source search phrases reconfigure only their
locale compartment with `addToHistory: false`, retaining the document and editor.
Internal behavior uses stable data attributes, not translated ARIA labels.
Mark non-destructive dialog dismissal actions with `data-dialog-cancel`; initial
focus must not depend on an English button label. Native macOS keyboard tests
use Option-Tab when the system excludes non-text controls from ordinary Tab.

When a binding composes another translated registry label, use a `BindingValues`
factory to resolve that label at paint time. Otherwise the outer message can
change language while its captured inner label stays in the previous language.
Capture only small canonical presentation data, never a DOM node, editor, document
or node view: the binding's weak node reference must not be defeated by a closure.
Keep authored summaries, metadata names, reference IDs and language identifiers
literal. A technical placeholder such as `paper` is syntax, not interface copy.

Use the same closed labels for equivalent production and showcase preferences.
Localize helper-produced labels, hints and select-option text at their rendering
boundary; translating a catalog entry alone does not fix a hard-coded helper.
Keep explicit canonical option values such as `left`, `proportional`, `blocks`
and indentation sizes. Reading marks, minimap navigation and command categories
follow this boundary. Shortcut result counts, recorder prompts and reassignment
warnings are whole messages, not joined translated fragments. Numeric validation
retains an error state and formats its message on render, so switching languages
does not erase or leave an old-language draft/error.

Extraction helpers produce inventory/migration suggestions, **not translations or
proof of coverage**. Review authored samples, protocol strings, templates and rich
sentences explicitly. Prefer normal catalog/component edits for future changes.

### Native interface wording

Write the action a native user expects, not the English sentence word for word.
Use concise labels, the locale's usual politeness/register and consistent terms
for workspaces, reading, editing and approval. Japanese uses 設定 and 閲覧/編集;
Korean uses 설정 and 읽기/편집; German uses Einstellungen and Arbeitsbereich.
Do not force English capitalization, word order or noun plurals onto another
language. Preserve the full consequences of security, deletion and provider
consent warnings. Technical identifiers, Markdown and user-authored names are
not translation targets. Final linguistic acceptance still needs native-speaker
review; authored copy and structural tests are not that certification.

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
protects **638 reviewed message IDs** across twenty-two UI areas against missing, blank or
English-fallback regressions in every non-English catalog. The scope lives in
`packages/i18n/src/translation-coverage.ts`, outside runtime bundles. Extend it
when completing a UI increment. Legitimately identical native wording requires an
explicit message/locale exception; exceptions never allow missing or blank values
and must not exempt an entire area. Examples include French “Collaboration”,
German “Definition”/“Proportional” and Indonesian “Media”, whose native spelling
matches English. Image terminology also has narrow native-word exceptions, such
as French “Rectangle”/“Saturation” and German “Ellipse”/“Text”. These are not
untranslated-area exceptions. This is a structural review gate, not native
linguistic certification.

The same gate scans **365 application/showcase UI modules** for unregistered
literal messages passed to the imported compatibility adapters, imperative
bindings and React message components. It follows import aliases and literal
conditional branches; it does not scan authored content or prove that arbitrary
dynamic values/raw text are translated. Closed registries need typed contracts
and explicit coverage tests. An existing `uiText` call is not sufficient if its
runtime status never existed in the catalog.

The gate writes matching-English entries to ignored `data/i18n/coverage.json`.
On 2026-10-10 the current inventory has **5,674 messages**, including **82 newly
registered messages** in the specialized-tool increment. This increment authors
**181 tool messages** in every non-English language and adds **177 coverage
requirements**; some shared labels were already protected. The eight earlier
non-English catalogs have **2,371–2,428 differing translations each**, with
**3,246–3,303 values per catalog still matching English**. Japanese and Korean
have **1,253 differing translations each**; German has **1,230**, leaving
**4,421–4,444 matching-English values** in the three new catalogs.
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
Save/Cancel, CAS and reload persistence, all twelve profile languages without changing
authored values, the US default, explicit automatic Japanese matching and Japanese
group dialogs at large text. The latter use read-only
theme response fixtures for both color modes, never saving appearance or creating
a group. Only that read-only layout fixture blocks service-worker registration so
network interception is reliable; it is not an offline/PWA acceptance test. The
other account flows retain normal worker behavior. Browser number expectations
use the engine's resolved numbering system rather than assuming Node's CLDR
defaults. Read-only MCP review fixtures cover approved queued requests, delayed
processing, manual refresh and completed receipts, with Japanese/Korean/German
large-text dialogs in both color modes. They never approve or create actual files.
Read-only appearance fixtures cover Japanese/Korean/German minimap labels/options,
canonical values, scratchpad modes/privacy captions, localized shortcut
counts/recording, keyboard focus and visible
footers at large text. They leave saved appearance/writing preferences unchanged.
The same fixture checks preference-sync footers and native help-section search,
while marking the still-English guide prose correctly. Browser-local editor-lab
fixtures switch metadata/fold captions in place, retain uncommitted drafts,
caret, source and undo, and inspect both modes/large text/forced colors without
connecting to a database or sync service. The plain Vite lab defines only its
public locale-asset revision rather than introducing a Node `process` shim.
Showcase tests cover twelve choices,
route/source/undo preservation, German, light/dark, large text, keyboard, forced
colors and reduced motion, plus the shared reading choices in the three newer
languages. The command-registry unit gate rejects unregistered labels/categories;
parameter tests retain authored names and TeX commands literally.
Inspect screenshots: structural assertions alone are
not layout acceptance. Mutations run only on isolated data.

`tests/tool-localization.test.ts` renders the actual crop, resize, avatar and
equation-export controls using each active client catalog. It verifies translated
accessible names, whole warnings/errors, native numbers and unchanged editable
values, names, option IDs and export formats. The test supplies the client snapshot
to static rendering deliberately; it does not change the app's English SSR
contract or certify native dialog, canvas/clipboard interaction or visual layout.
The geometry and clipboard unit suites separately preserve algorithm/MIME behavior.
Fresh browser/screenshot acceptance of this tool increment remains pending:
local preview startup in this session is denied with `listen EPERM`. Do not
substitute working or deployed data to bypass this boundary.

Before claiming an entirely localized app, finish long-tail translations, replace
remaining fragmented/dynamic messages, audit display registries and number/date
sites, extend the reviewed-copy coverage gate and obtain native-language review.
Physical IME and assistive-technology acceptance remain separate device gates.

The next translation passes should prioritize:

- Remaining specialized PDF/annotation and diagram controls, image/cloud-draft
  recovery and project lifecycle messages, math symbol/template descriptions and
  assistance dialogs. The reviewed equation-export and image-geometry controls
  above are increments, not entire-studio translation acceptance.
- Remaining assistant/provider details and website publication, domain setup and
  author analytics after the reviewed consent/usage/lifecycle increment.
- Remaining composed messages, lifecycle/status displays, accessibility labels and
  user-visible API errors. Convert whole messages with canonical parameters;
  do not translate protocol error codes or arbitrary returned values.
  Preference conflict-field names, other validation/error details and specialized
  lifecycle messages still need review beyond the closed synchronization registry.

Published readers, email templates and long help articles still need a separately
defined localization scope. The coverage inventory is a copy-review queue, not a
requirement to translate authored examples or technical identifiers.
