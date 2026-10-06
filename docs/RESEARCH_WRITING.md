# Research writing: editable papers, reference history and handoffs

This stage adds a source-preserving writing workflow to existing Markdown notes,
workspace libraries, version history, assigned reviews and tasks. It does not add
a second editor, change collaborative anchors or publish a document automatically.
See [executed acceptance](VERIFICATION.md) for the tested scope and release gates.

## Export one note as an editable LaTeX project

Open **Export document → LaTeX research project (ZIP)**. Opening Export captures
the Markdown currently on screen, including unsaved local text. Later peer edits
show a notice; **Refresh snapshot** is the only way to replace that source.
Export never saves the captured draft back into the note.

Choose the bibliography backend, numbered or author–year citations, A4/Letter and
8–40 mm margins. Authors and date are explicit optional fields, not account data.
The article uses 11-point Latin Modern with automatic Chinese-character support
when needed. Review **TeX**, **Reading**, **Bibliography**, **Files** and **Checks**.
Reading is a sandboxed HTML approximation using the reviewed references, not a
compiled PDF or a guarantee of TeX pagination. It loads only when selected.

Both bibliography profiles are available:

| Profile          | Generated bibliography and local compile workflow                                 |
| ---------------- | --------------------------------------------------------------------------------- |
| BibLaTeX / Biber | Unicode bibliography, numeric or author–year style; XeLaTeX, Biber, XeLaTeX twice |
| natbib / BibTeX  | Classic numeric or author–year style; XeLaTeX, BibTeX, XeLaTeX twice              |

Warnings require explicit acknowledgement; errors block archive preparation.
The worker prepares the project in the background. Closing the dialog stops local
work/polling, not an accepted job; find it in **Settings → Exports**. A failed job
can be retried; a lost network response retains its retry identity.

### What travels in the ZIP

- `main.tex`, `references.bib` and `COMPILE.md`: editable article, normalized active
  bibliography and local no-shell-escape compile instructions.
- `original.md`: the exact submitted source, including its original line endings.
- `references-original.bib`: only selected records and their transitive string
  definitions, retaining entry types, unknown fields and original spelling.
- `code/`: complete code, Mermaid and source-preserving unsupported-block fallbacks.
- `assets/originals/`: exact authorized attachment versions, verified by size/SHA-256.
  `figures/` contains TeX-compatible copies/conversions and local diagram PNGs.
- `export-manifest.json`: source/dependency hashes, versions, citation-key mapping,
  options and diagnostics. This is a manuscript manifest, not an account backup.

Paragraphs, nested lists/tasks, tables, quotes/callouts, footnotes, common math,
equation references, safe document macros, headings and TOC have native mappings.
Bounded supported macros are hoisted once; conflicting/recursive declarations use
literal source fallbacks. Code uses external verbatim files, not executable TeX.
Metadata stays in `original.md`; explicit authors/date fields control the paper.
Stable merged citation aliases map only in generated output; source/library keys
are not rewritten. Cross-reference/xdata dependencies are included when resolvable.

### Privacy, limits and deliberate exclusions

Readers may export only currently accessible content. Review fingerprints fence
source/options and bibliography/asset versions. Dependency changes require a new
review; note restoration changes its generation and invalidates an old export.
Workers and downloads recheck access. Revocation cannot retract a downloaded copy.
Original images and bibliography can contain EXIF or local metadata—review them
before sharing. Private annotation text, discussions, reading bookmarks and account
details are not assembled into the project.

No server TeX process, hosted compiler, automatic external-image fetch, external
upload, multi-note assembly, DOCX or journal-template catalog is included. Mermaid
figures render locally when preparing the archive; failed diagrams retain source
and a visible warning. Raw HTML/preambles and unsupported TeX are not executed.
The conservative subset is **not a TeX security sandbox**. Compile only trusted,
reviewed projects locally with `-no-shell-escape`; never compile untrusted material
inside a privileged service or on a machine holding secrets.

The snapshot limit is one million UTF-16 code units; one project accepts up to
1,000 bibliography dependencies, 1,000 attached versions and 100 diagram blocks.
Each convertible image is at most 20 MiB/16 million pixels. Diagram payloads total
at most 20 MiB; decoded conversions share a 64 MiB memory budget. Larger originals
stream into ZIP without loading the whole archive into memory. Existing archive
storage/concurrency limits still apply. Long tables, unusual packages/scripts and
unsupported Markdown need local review; this is not universal TeX or journal parity.

## Reference provenance and reviewed duplicate merges

In **Workspace → Research → Library**, open a reference and select **History**.
Twenty summaries load at a time; **Older/Newer** navigate without loading every raw
record. **View source** explicitly loads that event's original BibTeX. Imports,
copies, user-reviewed identifier lookups, edits and merges record immutable source
events. Provider provenance describes the selected metadata source, not an external
attestation; users may edit imported/lookup values before saving.

Existing references receive an honest **Existing at upgrade** baseline. No prior
actor or earlier edit is invented. History is append-only through application APIs;
permanent removal of its owning reference/workspace may remove the evidence.

Select duplicate records and preview the merge. The review shows conservative
DOI/arXiv/title-author-year match reasons, accessible note/PDF/collection impact,
field choices, custom values and additional BibTeX fields. Refresh after changing
any decision; apply rechecks the complete preview fingerprint and revisions.
Unspecified extra fields retain the chosen target's value; every original remains
in history. Citation aliases, links, tags and collections are combined without
rewriting Markdown. A manual merge without an identity match is explicitly labeled.

## Frozen paper reviews and research tasks

Name a Markdown milestone from Document history after saving. Its source hash must
still match the captured comparison; a peer change asks for refresh rather than
silently creating a different checkpoint.

**Request review** can freeze that milestone's resolved bibliography and exact
attachment identities. The assignee needs existing commenter/editor access to the
note and read access to every figure; assignment never grants extra permissions.
Review listings carry counts, not full bibliography/source. Expand **Frozen paper
evidence** to load its authorized detail. Later library edits do not replace the
saved evidence. Inaccessible evidence is marked unavailable, never replaced by
the latest version. Approval is advisory and does not accept document suggestions.

**Follow-up task** on a Markdown milestone or reference event creates a task or
links an existing task in the same workspace. Existing-task versions are captured
on selection; a changed task requires explicit refresh. Task details show these
immutable research sources beside existing PDF annotation links. Opening a source
shows its exact milestone/event, not today's text. Removed, moved or revoked
sources become unavailable and remain removable; links never force a Trash hold or
copy private quotations into a shared task. Each task accepts up to 100 such links.

## Contributor and operator gates

Migration **44** is forward-only. Back up the paired database/attachments before a
normal upgrade, then follow [the deployment upgrade workflow](DEPLOYMENT.md#upgrade-discipline).
Development verification never applies it to the working database automatically.

```sh
npm run verify:research-writing:migration
npm run verify:research-writing:compile
npm run verify:reliability -- research-writing.spec.ts document-export.spec.ts resource-review.spec.ts --project=chromium --project=firefox --project=webkit
```

The migration rehearsal creates a dedicated embedded cluster on 54340 and tests a
43→44 upgrade with fictional CRLF Markdown, Yjs state and bibliography. The compile
check uses only the checked-in fictional fixture, XeLaTeX and both bibliography
backends; it never compiles a working note. TeX tools must be installed locally.
On affected macOS launchers it extracts a private architecture-specific Biber copy
without modifying the installed tools. PDF raster review remains a separate visual
gate. Evidence stays ignored under unique `data/` run directories.

Keep parser/export and bibliographic lexical edits pure; resolve authority/version
dependencies in API modules and perform bounded conversions/streaming in workers.
Reuse shared dialog/controls and their owned scrollports. Source preview must not
mount a second collaborative editor or impose form styles on paper tables.
