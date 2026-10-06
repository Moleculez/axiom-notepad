# Workspace extensions · API v1

Axiom extensions are optional browser-side research tools. They receive explicit
workspace permissions, contribute **native Axiom controls**, and prepare changes
for human review. They do not replace the editor, execute on the server, change
the Markdown dialect, or gain administrator access.

The initial platform is a controlled beta. Package identity is an immutable
SHA-256 hash, **not** a verified publisher signature or a security certification.
Third-party imports remain separately disabled by default.

## Enable deliberately

Apply numbered migrations through the normal backed-up upgrade process before
running the new server. Migrations 40 and 41 add package/grant/activity records and
a one-version configuration rollback slot; they do not rewrite research files.
Migration 48 adds 30-day grant/approval expiry, including a full upgrade grace for
existing consent. It does not enable an extension or change an existing revision.
See [deployment](DEPLOYMENT.md) and [verification](VERIFICATION.md).

```dotenv
AXIOM_PLUGINS_ENABLED=false
AXIOM_PLUGIN_IMPORTS_ENABLED=false
```

Only the literal value `true` enables a gate. To evaluate the three shipped pilots,
enable `AXIOM_PLUGINS_ENABLED` and restart the web/worker services. Keep the imports
gate off until the operator has accepted the additional untrusted-code risks.
These are server variables, not public Next.js build-time variables. Turning a
gate off rejects subsequent calls, reviews and execution; it is not an Undo of
already applied changes. Extensions require a current online session. Offline
Markdown editing and downloaded-file behavior remain independent.

## Install, consent, run

1. Open **Settings → Extensions**. Available packages show author declarations,
   exact identity and requested permissions. Installations start **disabled**.
2. Enable the package for your own account. Configure any required fields.
3. Select one active workspace, review the requested capabilities and explicitly
   grant the subset you want. A grant is tied to its package hash and revision.
   It expires after **30 days**, or earlier when its required group approval expires.
4. For team/project workspaces a group manager must first approve that **exact
   hash and workspace set**. Approval does not enable a member's installation,
   consent on their behalf or grant the manager access to restricted content.
5. Run from the package, Search & commands, an eligible editor context menu or a
   declared slash entry. With no active workspace, choose one explicitly.

An extension panel has host-owned identity/status, Stop, Close and Permissions &
settings controls. It shares the existing resizable inspector slot with document
context and the assistant. Switching inspector owner retains drafts; **Show
extension inspector** returns to the retained panel. Stop/Close ends its worker.
Restart is explicit and reloads the panel, not an automatic recovery attempt.

Settings shows effective expiry and **Renew permissions** / **Renew approval**.
Renewal requires the existing exact-hash scope/capability review and advances the
revision fence. Expired approvals cannot grant new member permissions. Renewal
does not revive stale proposals, retry queued work or restart a stopped worker.
The host stops idle/running workers at effective expiry; each broker/review/queued
write also checks fresh server expiry. A migration rerun never extends old consent.

Configuration drafts survive package/category switches. Save uses the revision
on which editing began; a concurrent change displays a correction message rather
than silently overwriting the draft. Leaving settings uses one shared unsaved-form
guard. Shortcuts cannot conflict with native editor/workspace/browser commands,
and plugin shortcuts do not intercept editable fields, composition or dialogs.
Slash entries open the extension inspector; they deliberately do not remove or
change document text before a reviewed action is applied.

## Shipped research pilots

| Pilot            | Behavior                                                                                                                    | Requested access                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Research Journal | Daily, laboratory and meeting templates; choose a folder, edit Markdown and prepare a new-file proposal                     | File metadata; propose Markdown files      |
| Document Health  | Saved-snapshot findings for unresolved note/citation links, repeated equation/figure labels and images without descriptions | File metadata, saved documents, references |
| Planning Brief   | Current task counts, blocked/overdue work and upcoming milestones; prepare a Markdown report                                | Planning snapshots; propose Markdown files |

The health check is a bounded heuristic, not an exhaustive parser or formal proof
checker. It skips simple fenced code and uses returned workspace/reference data;
truncated lookups are described as possibly unresolved. Finding links recheck the
saved source hash before navigating. Unsynchronized source is never presented as
an inspected snapshot. Planning reports describe current state and planning
revision, not verified historical accomplishments. Long report fields are labeled
as excerpts rather than silently losing their tail.

## Package format and SDK

API v1 accepts a ZIP containing `manifest.json`, one self-contained browser ESM
bundle named `main.js`, and optional `README.md` / license files. No HTML, CSS,
fonts, executable server entrypoints or binary assets. Bundled dependencies must
carry their required license notices. ZIP paths, case-insensitive duplicates,
overlaps, symlinks, encrypted entries, compression bounds, CRCs and UTF-8 are
independently checked. A version cannot be replaced with different bytes: bump
the version. The reserved `axiom.*` namespace belongs to shipped source.

See the working [manifest](../examples/plugins/document-summary/manifest.json)
and [TypeScript example](../examples/plugins/document-summary/index.ts).

```sh
npm ci
npm run plugin:pack -- \
  examples/plugins/document-summary/manifest.json \
  examples/plugins/document-summary/index.ts \
  data/plugin-builds/document-summary.zip
```

The command bundles, validates and prints the exact archive hash. It **does not
execute or install** the extension. Existing output is protected; append
`--force` only when intentionally replacing that generated ZIP. Import the
archive in an isolated profile before requesting any team approval. The SDK is a
local workspace package, not a published registry dependency.

```ts
import { definePlugin } from "@axiom/plugin-sdk";

export default definePlugin({
  async run(api, context) {
    await api.render({
      title: "Research helper",
      blocks: [{ kind: "text", text: "Native, escaped text only." }],
    });
  },
});
```

`activate(api, context)` is optional; `run` is required. Commands are serialized;
`context` contains one workspace identity, optional active resource, declared
command, native field inputs and account configuration. The API provides
`request(method, args)`, `render(panel)` and `createId()` for a browser-safe UUID.
Opaque workers are not secure contexts: do not assume `crypto.randomUUID()` or
`crypto.subtle` exists. Use `api.createId()` for mutation identities. There is no
DOM/editor instance, React extension, deactivate hook or arbitrary HTTP API.
Dispose work by stopping the worker; private state is explicitly saved through
the versioned broker.

### Capabilities and broker methods

| Method                             | Capability                     | Result / boundary                                                                                  |
| ---------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `resources.list({search?, kind?})` | `resources:read`               | Up to 100 accessible metadata rows, excluding trashed ancestors; `hasMore`                         |
| `documents.read({resourceId})`     | `documents:read`               | Saved canonical source, format, generation and SHA-256; current scope/access rechecked             |
| `references.list({})`              | `references:read`              | Up to 1,000 local reference metadata rows; `hasMore`                                               |
| `planning.read({})`                | `planning:read`                | Authoritative summary, planning revision, up to 1,000 tasks and 100 upcoming milestones; `hasMore` |
| `storage.get({})`                  | `storage:private`              | Account/installation-private JSON and its version                                                  |
| `storage.set({version, data})`     | `storage:private`              | Compare-and-swap; stale versions return 409 without overwriting                                    |
| `changes.prepare({...})`           | Per-action proposal capability | Private native change set; no automatic Apply                                                      |

Reads are never unrestricted queries or cross-workspace URLs. Runtime authority
is sealed by the host; package-supplied grant IDs cannot choose another account
or scope. All routes require the owner's authenticated application session, not
an OAuth/MCP bearer credential. Manager approval, live role, active workspace,
package hash, grant revision and requested capability are rechecked server-side.
UI visibility is not authorization.

Private state is account-private JSON, **not encrypted secret storage**. Do not
put provider credentials there. Uninstall offers retaining or clearing settings,
shortcuts and private state. Clearing also clears stored rollback configuration;
it never deletes research documents, native audit events or applied changes.

### Native UI vocabulary

Panels contain validated text, heading, semantic notice, separator, native field,
declared action, source link, table or change-set review blocks. Text is escaped.
Fields support text, textarea, number, date, select and checkbox; identifiers and
option values are unique, defaults type-checked, and required values are checked
before native actions. Review buttons verify proposal ownership and package
authority. Source links accept a resource UUID, optional line and expected hash,
never an arbitrary URL. Tables use up to 12 columns and paginate 50 rows at a time.

Do not imitate a login/permission dialog in panel prose. The host retains its own
identity chrome and owns all permission, review and lifecycle dialogs. Consume
the vocabulary instead of drawing custom controls. See [UI contract](UI_CONTROLS.md)
and [theme authoring](THEME_AUTHORING.md).

## Reviewed writes and recovery

Allowed proposals are Markdown `file_create`, source-backed `document_edit`, and
native `workspace_task_create` / `workspace_task_update`. Each needs its declared
proposal capability and current write access. Folder moves, deletion, sharing,
administration, publication and binary uploads are not plugin write APIs.

Preparing creates only a private draft. Review selects actions, validates exact
targets/content and freezes a short-lived fingerprint. Apply requires a separate
human acknowledgement. Execution uses the existing reviewed-action pipeline,
source/Yjs commands, version fences, audit attribution, idempotent retries and
guarded Undo. An extension cannot click Apply, refresh a stale expected hash or
silently retry a failed mutation with a new fence.

The native pipeline does not make every action reversible: new-file creation
does not receive an invented automatic inverse. Existing document/task Undo
requires current unchanged targets and the original still-valid extension grant.
Disabling, updating, rollback, uninstall, grant revocation, approval withdrawal
expiry or workspace access loss blocks subsequent calls and queued actions. Reapproval
does not resurrect old grants. Already committed work remains.

**Settings → Extensions → Activity** shows bounded method/outcome metadata and
native proposal controls. **Toolbar → Activity & recovery → Background work**
adapts existing file-operation/export/OCR/assistant/proposal ledgers. It does not
create a second queue, fabricate progress, reveal provider/source payloads or
retry work automatically. Inspect opens the original controller. Your own pending
extension proposals can still be cancelled after disable/uninstall/revocation;
cancellation does not undo actions already completed.

Updates show package identity and permission changes before installation. They
disable the installation, revoke grants, retain only compatible configuration and
surviving command bindings, and save one prior hash/configuration slot. Rollback
swaps that slot, also disabled and requiring renewed workspace consent. Neither
operation rewrites Markdown. Review required new settings before enabling.

## Isolation and limits

The only frameable endpoint is the trusted `/plugin-sandbox` bootstrap. A hidden
iframe has `sandbox="allow-scripts"` **without** `allow-same-origin`, popups,
navigation, forms, downloads or an origin credential. It creates a classic Blob
worker that loads the package as a local data-URL ES module. The data module avoids
WebKit's opaque Blob-module loading failure; it does not introduce network access
or execute package code in the iframe/app realm.

The frame/worker inherit a strict CSP: no external scripts, connections, images,
styles, frames, forms, objects or unsafe evaluation. Parent/source/origin/nonce and
MessageChannel handshakes are checked. The trusted frame bounds and serializes
worker JSON before forwarding strings into the app; native panels are then validated.
Depth, nodes, sparse arrays, string encoding, rate, pending requests and total
command transfer are checked. A new command resets transfer accounting only;
duplicate/lifetime request identities and rate fences remain. Invalid data disposes
the worker/ports, without applying changes or discarding drafts.
Payload-free heartbeats still obey message/structure/rate limits but do not spend
the command transfer budget while idle. A heartbeat carrying extra fields is rejected.
Streaming network constructors and child-worker constructors are unavailable and
non-replaceable before package evaluation. API v1 has no child-worker capability;
this also provides defense in depth for older engines with known
[EventSource CSP defects](https://bugzilla.mozilla.org/show_bug.cgi?id=2031064).
The app never imports or evaluates package code. Stop, offline/access changes,
deadlines and a trusted heartbeat watchdog dispose the worker, ports and frame.
Background permission validation is at most every 30 seconds while visible;
every API call still enforces fresh authority immediately.

This uses standard [worker CSP inheritance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
and [iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)
boundaries. Browser defects remain part of the threat model. The watchdog is not
a hard operating-system CPU or memory quota. Malicious clone floods,
resource exhaustion and the wider dependency/browser attack surface still require
independent adversarial review before broad third-party imports.

| Budget                                   | Limit                                                          |
| ---------------------------------------- | -------------------------------------------------------------- |
| ZIP / expanded archive                   | 5 MiB / 10 MiB, up to 32 entries                               |
| Imported package ownership               | 32 packages / 64 MiB per account                               |
| Broker message / saved document snapshot | 8 MiB / 1 MB                                                   |
| Settings or private state                | 256 KiB per installation                                       |
| Broker calls                             | 100/minute per account; 8 concurrent per runtime               |
| Relay transfer / rate                    | 32 MiB per command; 100 protocol messages/second               |
| Relay structure                          | Depth 32; 100,000 nodes; 1,000 lifetime request IDs            |
| Member consent / group approval          | 30 days; earlier effective expiry wins                         |
| Native panel                             | 100 blocks, 2,000 table rows, 16,000 characters per field/text |
| Command / heartbeat deadline             | 20 seconds / approximately 6–7 seconds                         |

The first worker-to-frame structured clone still belongs to the browser and cannot
be stopped by the relay validator. Size checks prevent the second oversized clone
into the application, not allocation in the package's own realm. These budgets
and CSP do not replace independent security review or hard operating-system quotas.

Activity screens return only the newest 100 metadata rows; this is **not** a claim
that older activity/package bytes are automatically deleted. Immutable packages
and proposal audit references remain retained. A package catalog garbage collector,
publisher signatures, marketplace discovery, server-side extensions, external
network permissions and broader online/offline/assistive-technology certification
are future stages, not hidden functionality in API v1.

## Isolated acceptance

Never run mutation suites against working research data. The guarded profile uses
`axiom_plugins_test`, distinct attachment storage, web 3004 and sync 1236. It turns
both feature flags on **only in that process environment** and permits only the
local deterministic provider at 8096, with a known non-production encryption key.

```sh
npm run plugins:staging -- init
AXIOM_ADMIN_PASSWORD='ExtensionsTest2026!' npm run plugins:staging -- admin \
  --email extensions@axiom.local --name "Extension acceptance"
npm run plugins:staging -- dev     # terminal 1
npm run plugins:staging -- sync    # terminal 2
npx tsx scripts/verify/assistant-provider-fixture.ts  # terminal 3
# Keep the worker stopped during deterministic queue-revocation API tests:
npm run plugins:staging -- verify-plugins
npm run plugins:staging -- worker  # terminal 4, for browser assistant acceptance
npm run plugins:staging -- test --config plugins.config.ts
```

Provision the account once on a fresh profile; do not
reuse these fictional credentials or the staging encryption key in production.
Cross-browser tests cover opaque storage/DOM/network boundaries, CSP directive
enforcement, runaway workers, native review, draft/conflict/inspector ownership,
large-font themed frames and the history-to-outgoing-review assistant flow.
API checks cover grant/capability/owner fences, queued revocation, cancellation,
private-state CAS, update/rollback and cleanup. These checks do not certify a
hostile plugin ecosystem, real provider quality, physical IME or assistive tech.
