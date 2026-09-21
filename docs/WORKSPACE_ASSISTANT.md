# Workspace research assistant

The assistant is an optional, private research panel. It can explain or compare
selected evidence and prepare reviewed Markdown, math and task changes. It cannot
autonomously edit accepted documents, change access, delete files, reschedule work,
execute code, browse the web or certify proofs.

## Everyday workflow

1. Open **Research assistant** in the app toolbar or Search & commands. Notes,
   Math Studio, saved tasks, the current PDF page and reviewed OCR pages also have
   contextual assistant actions. The document remains mounted beside the panel.
2. Choose a primary workspace and an administrator-enabled provider. Optionally
   select up to 20 accessible workspaces in the same group before starting a
   conversation. **Add evidence** searches only this selected scope locally.
   Personal workspaces cannot be mixed with group workspaces.
3. Use the pencil beside a document to select exact text or a line range. Native
   evidence comes from saved server content, including acknowledged collaborative
   updates. An excerpt carries a full-document hash: if that document changes before
   preparation, reselect it. Nothing is silently truncated.
4. **Allow proposal** explicitly marks each editable target. **Allow private
   new-task drafts** is a separate permission to propose, not to create tasks.
5. Write a request and select **Review & send** (also ⌘/Ctrl+Enter). Review the exact
   outgoing instructions, prompt, evidence and retained conversation history.
   Sending requires a fresh checkbox approval for this preview and provider.
6. Read the completed answer and open its numbered source chips. Each shows the
   captured excerpt and time; the current file may have changed. Citations are
   references, not verification that the answer is correct.

The panel is keyboard-resizable from 360–640 px and becomes a dialog on narrower
desktop windows. Closing it restores focus. Unsent prompts and source references
are recovered on the same device/account/workspace; PDF extracted text is not saved
in this local draft. Private conversation history can be renamed, exported or deleted.

## Reviewed changes

- **Markdown and math:** review the proposed replacement and exact difference, then
  open the existing suggestion editor. The AI-assisted draft stays local/private,
  including after reload or reconnect, until **Publish proposal**. Publishing shares
  a suggestion; accepted document content still changes only through the normal
  review/accept flow. CRDT-relative anchors preserve unrelated concurrent edits;
  overlapping edits and restored document generations require fresh review.
  On a fresh page load, the proposal waits for the captured collaborative state
  before resolving anchors; source text alone is not a sufficient synchronization
  signal.
- **Tasks:** edit the proposed title, description, status, priority, assignee, labels
  and effort, preview, then explicitly apply. New tasks are unscheduled. A receipt binds the exact preview
  to its operation; repeated requests do not create duplicate tasks. Undo refuses
  newer task revisions or new dependent work. A new preview supersedes an older,
  unapplied receipt.
- **Schedules:** an explicitly editable task can receive a separate date proposal.
  Review the affected tasks and capacity impact before applying to its workspace.
  This uses the same preview/apply/Undo service as manual Gantt changes. It never
  creates dependency edges, changes other workspaces or levels resources. New task,
  calendar or group availability revisions invalidate unapplied receipts.
- Dismissed, expired or deleted private drafts cannot be published from normal local
  recovery. Publishing and task application recheck evidence access inside the
  mutation transaction. Losing an evidence source also withholds derived follow-up
  answers and exports. Published suggestions and tasks are not deleted when a
  private conversation is deleted.

## Supported context and limits

Markdown, LaTeX/math and native plain-text excerpts; saved task fields; one selected
immutable PDF page per attachment; and requester-owned, reviewed OCR pages are
supported. PDF text is explicitly browser-extracted evidence, not a server-verified
quotation. OCR evidence stops being available when its private result expires or
is cleared. Native plain text is read-only context, not a suggestion target.

DOCX/PPTX/XLSX evidence is locally extracted by the regular server worker from an
immutable file version. Select exact characters, document blocks, slides or saved
worksheet values/formulas; external relationships are never fetched and formulas
are not recalculated. Hidden cells and speaker notes may be present: review the
excerpt. Extraction is limited to 500,000 characters, with smaller outgoing limits
below. Oversized input fails explicitly. Private extraction results expire after
one day; submitted excerpts follow conversation retention.

Canvas selection submits only chosen card text/titles and edges between them,
fenced by the saved canvas hash. Linked files, URLs and nested canvases are not
recursively fetched. Planning evidence includes selected task metadata and
working-day analysis; task deletion/access loss also withholds historical answers.

Media, arbitrary web pages, whole-workspace crawling and automatic embedding/vector
search remain outside this stage. Office and Canvas are read-only evidence, not
proposal targets.

| Boundary                         | Limit                                        |
| -------------------------------- | -------------------------------------------- |
| Evidence per request             | 20 items / 30,000 source characters          |
| Complete outgoing messages       | 60,000 characters; history is included       |
| Response / proposed actions      | 30,000 characters / 5 proposals              |
| Task description                 | 12,000 characters                            |
| Editable CRDT snapshots          | 2 MB each / 8 MB aggregate encoded snapshots |
| Conversation history             | 100 turns, retained 30 days                  |
| Active private conversations     | 100 per person per workspace                 |
| Pending context previews         | 20 per account; expire after 15 minutes      |
| Proposal preview receipt         | 15 minutes; newest unsubmitted preview wins  |
| Queued/running provider requests | 5 per account, shared with existing AI jobs  |

Provider daily limits include failed, cancelled and uncertain jobs. A completed
response is schema-validated before proposed actions are shown. Malformed output
is inert text with no executable actions. Returned HTML, links, images and Mermaid
execution are disabled; equations use the existing bounded math-rendering worker.

## Privacy, cancellation and recovery

Conversation rows, evidence snapshots, answers and unpublished proposals are
owner-private, not group-visible. A conversation has an immutable, explicitly
selected same-group workspace boundary (one workspace by default).
Provider access and source access are checked before dispatch and before publishing
the result; reads, exports and proposed writes revalidate source access. Assistant
responses use private/no-store HTTP headers. Reading the panel does not send content
to a provider.

Cancel stops local processing/publication, but the provider may already have received
the material and may charge for it. An interrupted/uncertain request is never
automatically resubmitted. Review and deliberately send a new request if needed.
Prompts and evidence are cleared after 30 days or conversation deletion; quota
receipts are retained without their content. Clearing private server history does
not erase exported files, earlier backups, already published work, or recoverable
drafts on other devices. Provider and backup retention are separate policies.

## Operator setup

Apply migrations through **30** after a verified database/blob backup, then run the web,
sync and regular workspace worker services. Existing provider grants stay unchanged:
an administrator must explicitly enable **Workspace assistant** in group processing
provider settings. It is disabled by default.

Web and worker need the same stable `TOOL_PROVIDER_KEY` for encrypted credentials.
Allowlist private endpoints with `TOOL_PROVIDER_ALLOWED_ORIGINS`, or explicitly
configure an OpenRouter account. Never copy test credentials into a deployment.
See [provider configuration](RESEARCH_TOOLS.md#optional-service-configuration).

## Isolated acceptance

Use an isolated database/storage on **3004/1236**, never the working instance on 8080. For local acceptance only, run the deterministic loopback provider:

```sh
npx tsx scripts/verify/assistant-provider-fixture.ts
```

Start the staging web and worker with the same test-only 32-byte provider key and
`TOOL_PROVIDER_ALLOWED_ORIGINS=http://127.0.0.1:8096`. The dedicated suite creates its
own test groups/providers using that loopback service:

```sh
TEST_APP_URL=http://localhost:3004 TEST_BROWSER=chromium \
  npx playwright test tests/e2e/workspace-assistant.spec.ts
# Repeat with TEST_BROWSER=firefox and TEST_BROWSER=webkit.
```

The fixture does not call external AI. It tests consent, privacy, citations,
proposal/recovery mechanics, cancellations and failures, not model quality or real
provider billing/retention. See [executed checks and remaining gates](VERIFICATION.md).
