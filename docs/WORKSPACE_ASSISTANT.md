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
   preparation, reselect it. Each captured excerpt also has its own hash and
   version/generation/location. Nothing is silently truncated. Search summaries
   are discovery previews, not citable source evidence.
4. **Allow proposal** explicitly marks each editable target. **Allow private
   new-task drafts** is a separate permission to propose, not to create tasks.
5. Write a request and select **Review & send** (also ⌘/Ctrl+Enter). Review the exact
   outgoing instructions, prompt, evidence and retained conversation history.
   Sending requires a fresh checkbox approval for this preview and provider.
6. Read the completed answer and open its numbered source chips. Each shows the
   exact submitted excerpt, location, captured identity and time after a fresh
   permission check. Native source cards distinguish a matching current snapshot
   from a changed file; otherwise freshness is explicitly unknown. Citation
   membership checks only that a key was supplied, not that a claim or quote is true.

## Reviewed discovery batches

Ask is read-only; Prepare changes produces private file/task/plan drafts, never
accepted changes. Enabling additional reading permits **local** bounded retrieval
inside the chosen workspace scope, not blanket transmission to a provider.

The initial Review & send still shows the complete first request. After each model
round, additional source excerpts, search summaries, previous model output and
history are frozen in a new **Review next outgoing batch** dialog. The run remains
`awaiting-review`; background polling, reopening the panel or restarting the worker
cannot approve it. Review every complete outgoing message, not only the new sources.
You may exclude a newly captured excerpt or narrow native/Office text to a nonempty
character range. **Update preview** creates a new fingerprint and clears consent;
it does not send anything. Search summaries are visible in the complete messages,
not promoted to evidence chips. Cancel the run if that outgoing context is unwanted.

Approval binds the exact envelope, provider configuration/version, workspace scope,
round and output ceiling. Receipts expire after 15 minutes; a changed provider,
expired receipt or edited excerpt requires fresh review. Existing queued discovery
runs from before migration 47 pause rather than inheriting broad consent.

The run can be limited to **1–8 calls** and **128–4,096 output tokens per call**
before initial review. At most five local reads are requested per round. Daily
provider quotas include later rounds and unsuccessful/uncertain requests. The
quota reserves a request before dispatch, so a cancelled reservation is not
evidence of a billable provider call. The
panel totals reported usage from every dispatch; absent usage is **unknown**, not
zero. Monetary cost is unknown in the regular panel because prices are not
configured there. Application token/round caps do not certify provider billing.

Server-side diagnostics reject invented evidence keys in answers/proposals. Actions
from a response with unknown references are inert. Previous valid private drafts
may remain available for separate review; no citation check certifies correctness.
Typed lab-field values, time notes and future task properties are not implicitly
added to planning evidence. There is no recursive file crawling, web access or shell.

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
- **Partial batches:** completed operation receipts remain visible. **Review
  remaining changes** creates a separately reviewed draft containing only eligible,
  originally selected unfinished actions. Confirmed created IDs satisfy finished
  prerequisites; unfinished dependencies stay linked. Uncertain/executing actions
  and their dependants are never retried. Inspect their actual outcome first.
  Stale versions/hashes are retained rather than silently rebased; the ordinary
  conflict/review workflow is still required. Recovery does not roll back completed
  independent operations or rewrite accepted documents.

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

| Boundary                     | Limit                                                                 |
| ---------------------------- | --------------------------------------------------------------------- |
| Evidence per request         | 20 items / 30,000 source characters                                   |
| Complete outgoing messages   | 60,000 characters; history is included                                |
| Response / proposed actions  | 30,000 characters; 5 native suggestions or 50 Prepare actions per run |
| Agent rounds / local reads   | 8 calls maximum / 5 reads per round                                   |
| Reviewed output cap          | 128–4,096 tokens per call                                             |
| Task description             | 12,000 characters                                                     |
| Editable CRDT snapshots      | 2 MB each / 8 MB aggregate encoded snapshots                          |
| Conversation history         | 100 turns, retained 30 days                                           |
| Active private conversations | 100 per person per workspace                                          |
| Pending context previews     | 20 per account; expire after 15 minutes                               |
| Proposal preview receipt     | 15 minutes; newest unsubmitted preview wins                           |
| Pending requests             | 5 per account, including awaiting-review and existing AI jobs         |

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
If the response was durably confirmed but subsequent local processing failed,
**Finish saved response** retries only local processing, without another provider
call. Saved round/action checkpoints prevent duplicate draft actions. An unknown
provider outcome cannot use this action. Cancelled, redacted, expired or revoked
contexts cannot recover. Local recovery can still encounter a stale destination or
permission conflict; it does not bypass the normal review rules.

Prompts and evidence, including duplicated outgoing review envelopes and saved raw
provider responses, are cleared after 30 days or conversation deletion; quota
receipts are retained without their content. Clearing private server history does
not erase exported files, earlier backups, already published work, or recoverable
drafts on other devices. Provider and backup retention are separate policies.

## Operator setup

Apply migrations through **47** after a verified database/blob backup, then run the web,
sync and regular workspace worker services. Existing provider grants stay unchanged:
an administrator must explicitly enable **Workspace assistant** in group processing
provider settings. It is disabled by default.

Web and worker need the same stable `TOOL_PROVIDER_KEY` for encrypted credentials.
Allowlist private endpoints with `TOOL_PROVIDER_ALLOWED_ORIGINS`, or explicitly
configure an OpenRouter account. Never copy test credentials into a deployment.
See [provider configuration](RESEARCH_TOOLS.md#optional-service-configuration).

## Isolated acceptance

Use an isolated database/storage on **3004/1236**, never the working instance on 8080.
The reliability runner starts the deterministic loopback provider on **8096** itself:

```sh
npm run verify:assistant:migration
node --import tsx scripts/verify/reliability.ts --project=chromium --grep='batch|revocation|scoped retrieval|document review'
```

The migration gate owns disposable clusters: fresh schema, 46→current, normal
controller rerun, exact document/CRDT/task/context preservation, legacy pause,
receipt uniqueness and private-ledger cleanup. It is not SQL concurrency acceptance.
The runtime gate owns its test-only provider key/allowlist, accounts and storage.
The browser suite verifies exact request hashes/output caps, held batches,
narrowing/exclusion/stale consent, source changes, revoked access, unknown usage
and inert invented citations. It includes all registered interface styles, both color modes,
large text, forced colors and reduced motion. Inspect the actual screenshots.
Paired recovery compares contexts, runs, reviews, steps and change receipts too.

Use [`npm run verify:stages:acceptance`](STAGE_ACCEPTANCE.md) for the complete local
Stage 3–4 matrix. Its real worker/SQL checks include competing approvals and quota
slots, crash/checkpoint recovery, consent expiry, configuration/access changes and
scoped native MCP reads; paired recovery requires populated private ledgers.
It uses only a loopback provider and leaves operator review pending.

## MCP evidence tools

`workspace_evidence_search` and `workspace_evidence_read` reuse the same native
permission-filtered services with the existing `workspace:read` grant. Search is
always restricted to the connection's requested/granted workspace, even if its
account can read other workspaces. Search has literal matching and live keyset
pagination; a cursor binds the query/scope, not an immutable corpus snapshot.
Read returns bounded canonical Markdown/LaTeX/plain text or nonrecursive Canvas
cards with identity and source hashes. Text ranges require the full-document hash;
PDF/Office sources still require explicitly selected versioned excerpts.
Neither tool approves an outgoing batch or a change set. No new OAuth scope,
autonomous execution, lab/time administration or self-approval is introduced.

## Optional live-provider sample

This is a separate two-step, synthetic-only command. It never loads `.env`, reads
a workspace, uses saved application credentials or calls a provider by default.
Inspect the complete saved request and use your provider's actual prices/spending
limit; the following values are examples, not current prices:

```sh
npm run verify:assistant:live -- prepare \
  --provider-id=deliberate-synthetic-sample --kind=private \
  --endpoint=https://YOUR-HOST/v1/ --model=YOUR-MODEL \
  --budget-usd=0.10 --input-usd-per-million=1 --output-usd-per-million=2 \
  --out=/private/tmp/axiom-live-preview.json

# After inspecting the file, configuring a real provider-side spending limit,
# and explicitly exporting AXIOM_LIVE_PROVIDER_CREDENTIAL (do not commit it):
npm run verify:assistant:live -- run \
  --preview=/private/tmp/axiom-live-preview.json --fingerprint=EXACT_PREVIEW_HASH \
  --provider-budget-confirmed=0.10 --consent --retention-acknowledged
```

Private endpoints require `TOOL_PROVIDER_ALLOWED_ORIGINS`. OpenRouter uses the exact
base `https://openrouter.ai/api/v1/`. Preparation makes **zero requests**; the run
permits one call with at most 1,024 output tokens. A configured-price input estimate
uses UTF-8 bytes plus a per-message allowance, not a provider tokenizer. Over-budget
estimates fail closed, but an estimate cannot enforce external billing: configure
the provider-side limit. Missing usage leaves actual estimated cost unknown.
An exclusive, flushed receipt is reserved before dispatch; repeating the command
cannot repeat that charge. An interrupted/failed call remains uncertain and is
never automatically retried. Do not remove its receipt to bypass this protection.
This sample tests synthetic transport/output only, not production retention,
billing enforcement, proof correctness or the complete application.

The deterministic fixture makes no external AI calls. See
[executed checks and remaining gates](VERIFICATION.md); unexecuted gates remain
unaccepted regardless of tests present in source.
