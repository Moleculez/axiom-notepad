# Editor vNext: physical macOS acceptance

Status: **pending a human using the macOS input method and system clipboard**.
Automated browser composition and clipboard handlers have separate tests. Do not
mark this checklist complete from those results. The current source-backed
Milkdown/ProseMirror + CodeMirror editor is already the default; this checklist is
still a release gate, not a historical proposal to switch engines.

## Safe setup

Provision and start a registered isolated release profile on **3004/1236**, not
working data on 8080. See [reliability isolation](RELIABILITY.md). With a local
PostgreSQL control connection and separate working storage configured:

```sh
npm run staging -- init
npm run staging -- build
AXIOM_ADMIN_PASSWORD='AxiomResearch2026!' npm run staging -- admin \
  --email researcher@axiom.local --name 'Physical acceptance'
npm run staging -- web    # terminal 1
npm run staging -- sync   # terminal 2
npm run staging -- worker # terminal 3
```

Use those fictional credentials only in the test profile. Open
`http://localhost:3004/workbench/home` in a private browser window; do not mix live
and test accounts in one profile because localhost cookies can cross ports.
Create disposable test notes. Record macOS version, browser/version, input source,
test date and `apps/web/.next/release-test/BUILD_ID`. The automated one-command
runner closes its services after acceptance; it is not a persistent manual-test
server.

## Native Chinese and Japanese input

Use macOS Pinyin and Japanese input sources, not pasted text or automation.

- Compose, choose candidates, commit and cancel in plain prose, a heading, a nested
  list, a task, a quote, a table cell, fenced code and display mathematics.
- Active ordinary prose must retain every literal marker while composing/typing;
  move to another paragraph/item to render it, then return and edit the source.
  Heading hashes retain heading typography; completed list/task markers remain
  rendered while their editable bodies retain source. Bare unspaced markers do
  not activate structure. Check Enter, Mod+Enter and empty-item nesting exits.
  Check repeated Enter/Shift-Enter in empty notes and in notes using CRLF endings.
- Try both collapsed carets and selected text, including a selection crossing
  paragraph/code/table boundaries. Keep neighboring text and markers unchanged.
- While composing, use arrows, Backspace, Enter, Escape and candidate selection.
  Confirm that block conversion waits for authored intent and does not steal focus.
- Switch Source/Write and navigate to another note during composition. Confirm a
  committed draft is saved or explicitly recoverable; nothing silently disappears.
- With a second test window, insert text elsewhere during composition. Repeat with
  an overlapping deletion and an owner revoking edit access. Disjoint edits should
  converge; conflicts should preserve a recoverable draft without overwriting peers.
- Undo/redo, switch modes, reload and compare the exact saved Markdown. Check that
  the collaborator's changes are not undone by the local author.

## Real system clipboard and selection

Run in supported desktop browsers, including Safari itself (automated WebKit is
not a substitute for Safari's OS integrations).

- Copy/paste plain and formatted text through TextEdit, a browser and this editor.
  Check links, emphasis, multiple paragraphs, Unicode, inline math and fenced code.
- Copy a rectangle from Numbers or Excel into a table. Check tabs, empty cells,
  newlines, new rows/columns, copying back out and one-step undo.
- Paste an image/file through the normal protected upload workflow. Confirm failure
  is visible if offline or unauthorized; no broken placeholder silently replaces text.
- Copy TeX/code and a rendered equation using their context actions; verify the
  actual receiving application, not only the browser clipboard event.
- Test mouse drag, Shift-click and keyboard selections near code/math/table edges,
  source line wraps and long-document scroll boundaries. The caret must stay where
  the user put it, and the footer must stay outside the document scroll region.

## Record and release

For every failure, record the smallest starting Markdown, exact keys/actions,
expected/actual behavior and whether recovery contained the complete draft. Use
test content only; avoid recordings/traces containing private notes or session tokens.

Before a release, verify the current isolated build and required regression matrix,
complete these human checks, take a fresh live database/attachment backup, retain
old assets, then perform a deliberate deployment and read-only smoke. Rollback
changes the engine flag/build only; it must not restore an old database over newer
notes. A successful automation run is not physical-input certification.
