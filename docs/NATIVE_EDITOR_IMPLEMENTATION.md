# Native editor replacement

> Historical record of the September 8–9 native-editor work. Its dependency
> removal, port assignments and cutover checklists describe that release only.
> The current default is the [customized Axiom editor](EDITOR_VNEXT.md), built on
> Milkdown/ProseMirror and CodeMirror in development and production. Use
> [current verification](VERIFICATION.md) for today's evidence and release gates.

The September 9 typing-integrity follow-up supersedes the earlier caret/input behavior below. See [its interaction and engine contract](TYPING_INTEGRITY.md) and [current verification](VERIFICATION.md). The September 8 results remain historical evidence, not proof of the subsequently reported typing cases.

The approved direction is a first-party Markdown editing engine, not an editor-framework wrapper. Markdown in `Y.Text("markdown")` remains the canonical document. Yjs/Hocuspocus, the existing Markdown parser, MathJax, Mermaid and syntax highlighting remain specialized infrastructure.

## Release gates

- [x] Inspect installed Typora 1.11.7 with disposable scratch content; preserve the user's documents and clipboard.
- [x] Verify a database and attachment backup before source changes (`data/before-native-editor-20260908`). Archive the original source alongside it.
- [x] Native transactions, source/DOM selections, composition, clipboard, commands and author-local undo.
- [x] Semantic nested lists and quotes; quiet code/math controls; context-menu table editing.
- [x] Direct relative-position awareness from every surface; existing save acknowledgements and authorization retained.
- [x] Pinned per-pane footer, useful document statistics, inherited-sharing interface and unified visual tokens.
- [x] STEM Markdown additions without weakening CommonMark/GFM or HTML safety.
- [x] Remove editor-framework imports and dependencies.
- [x] New native-core and browser acceptance tests, isolated production build, data-preservation audit and deliberate cutover.

## Safety boundaries

The service on port 3001 and its release output are not development targets. Development and destructive test fixtures use the existing isolated verification database and ports 3002/1235. The verified native release was deliberately promoted to 3001 after a fresh drained-service backup. Do not initialize, overwrite or restore the live database. No document-format migration, new public access, per-note grants, or automatic production proxy changes are authorized by this editor replacement.

Keep unchecked acceptance gates explicit. Parser throughput is not input-to-paint latency; existing CodeMirror tests do not establish native-editor readiness.

## Implementation and verification notes

The replacement lives in `apps/web/lib/native-editor`: source transactions, DOM mapping/reconciliation, direct Yjs binding, rendering, clipboard conversion and completion. `Editor.tsx` retains the existing persistence, room names, generations, access revalidation and durable server acknowledgements. Statistics use a separate versioned worker; the hidden print/reading view is prepared on demand.

The 811-unit-test suite passes, including CommonMark/GFM fixtures, incremental/full-parser differential tests, Unicode source edits, nested literal source maps and fence boundaries, Yjs convergence and author-local undo. TypeScript, ESLint, isolated production builds and all four crash/persistence-failure checks pass. The dependency audit reports no vulnerabilities.

Three repeated production input-to-paint runs pass for 100,000- and 980,000-character synthetic notes. Timing uses real beforeinput transactions through two animation frames, not parser throughput. Full-DOM tracing and unscoped text selectors distort measurements on very large editable trees; timing runs disable trace recording and scope readiness to the document's actual save-status element. Functional tests retain failure traces. The final full Chromium run also passes the benchmark: sample maxima 30.3 ms and 177.6 ms respectively, six edits per size on this laptop.

Final production acceptance: 94 Chromium, 54 Firefox and 53 WebKit scenarios pass. One Chromium-only composition protocol test is explicitly skipped in each other engine; WebKit also skips the independently reproduced offline PDF reload automation failure. Live build `7NC0Hs7cJNbyeMQqyIC2H` runs from `.next/native-editor-release-r7-20260908`. The fresh `data/before-native-cutover-20260908-r7` backup is checksum-verified; all 12 CRDT byte states/revisions and the other 49 audited tables match after the read-only live smoke. No research data was deleted or restored. See [verification details and remaining certification limits](VERIFICATION.md).
