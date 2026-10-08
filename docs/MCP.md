# MCP connections and study workflows

Axiom exposes authenticated Streamable HTTP at `/mcp`. Clients discover typed
tools, resources and prompts; no shell, SQL, password, secret-management or
self-approval tools are provided.

## Connection setup

Copy the canonical endpoint from **Settings → Connected apps**:

- Development: `http://localhost:8080/mcp`.
- Deployment: `https://YOUR_HOST/mcp`.

`APP_URL` is an exact HTTP(S) origin, without credentials, paths, queries or
fragments. A root trailing slash is normalized. `BETTER_AUTH_URL` is the fallback;
the default development origin uses port 8080. OAuth issuer, resource and token
audience always retain the canonical identity. A deployment token is not a local
database token: use a new OAuth/PKCE connection when switching installations.

Connect using the browser authorization flow, select workspaces, and grant only
needed scopes: `workspace:read`, `workspace:write`, `workspace:manage`. Current
account permissions and consent revisions remain authoritative. Revoking or
changing consent invalidates old tokens and subsequent reads/execution.

The authorization screen separates application/account identity, workspace
selection and requested permissions. Search does not discard selected workspaces;
no workspace is selected automatically. Read access is required when requested,
while optional write/management permissions can be removed. Identity and ongoing
session access are disclosed only when requested by the client. Allow and Deny
remain visible outside the scrolling details, with stable pending states and
inline errors that retain the selection. Revocation lives in Connected apps.
The screen uses shared native controls and interface recipes, including large
text, square corners, no shadows, keyboard and forced-color preferences.

**Check connection** makes a bounded, unauthenticated GET to the configured
endpoint. A 401 with `WWW-Authenticate` is the expected healthy result. This checks
routing and OAuth discovery, not client grants. It never registers clients,
submits consent, forwards cookies/tokens, writes files, follows redirects or
probes arbitrary supplied URLs.

## Host, Origin and proxy policy

Framework request URLs can describe an internal listener behind a proxy. Axiom
validates the actual incoming Host authority against its configured canonical
host/port instead. Preserve the public Host, including a non-default port; never
use arbitrary `Forwarded`/`X-Forwarded-Host` as a substitute trust source. See
[deployment](DEPLOYMENT.md) and [MCP proxy configuration](../deploy/nginx/mcp.conf).

For non-production loopback installations, same-port `localhost`, `127.0.0.1` and
IPv6 loopback transport authorities are accepted. They do not create alternate
OAuth audiences; configure new clients with the canonical URL. Production does
not automatically allow aliases.

Native clients may omit Origin. Present Origins must match the canonical origin
or an explicitly configured browser client origin:

```dotenv
MCP_ALLOWED_ORIGINS=https://course.example.org,https://assistant.example.org
```

Wildcards, opaque `null` origins and paths are rejected. This MCP allowlist never
widens session/cookie trusted origins. Bearer-only CORS exposes authentication and
protocol headers without enabling credentials; public discovery metadata uses
the same explicit Origin policy.

Process-local limits cover initialization/discovery: 600 transport requests per
minute globally and 120 authenticated requests per minute per connection. Use a
trusted-edge limit for deployment-wide protection across instances. Bodies are
bounded to 5,500,000 UTF-8 bytes, and tool/resource results to 4,000,000 bytes.
Use narrower queries or pagination rather than silently assuming completeness.

## Discovery and research

`tools/list` is authoritative for the token's scopes. The maximum catalog is 110
tools: 98 native operations, six research reads and six connection/document/change
helpers. Read-only tokens do not receive workspace write/management tools.
Existing names and compatible envelopes are preserved; query/payload schemas
describe individual operations rather than opaque generic inputs.

Responses retain JSON text for existing clients and add `structuredContent.result`.
Tool failures use `isError`, an actionable category and a request ID, without
exposing backend credentials or internal errors.

| Tool                              | Purpose                                                      |
| --------------------------------- | ------------------------------------------------------------ |
| `mcp_connection_status`           | Canonical identity, accessible workspaces, scopes and limits |
| `workspace_references_list`       | Filtered, paginated reference summaries                      |
| `workspace_reference_read`        | Citation metadata and permitted linked evidence              |
| `workspace_reference_collections` | Bounded collection discovery                                 |
| `workspace_reference_provenance`  | Redacted versioned change history                            |
| `workspace_knowledge_graph`       | Bounded note/reference/PDF nodes and edges                   |
| `resource_annotations_read`       | Visible visual/PDF annotations                               |

These research tools are read-only. Every read rechecks the live connection,
revision, selected workspace and native permissions. Private owner checks remain
in force. Linked files/counts/edges never broaden a selected workspace into other
account-readable but ungranted workspaces. Provider/import payloads and obsolete
attachment ownership provenance are not returned as research evidence.
The legacy `file_usage` tool returns selected-workspace reference sources for MCP,
not global private protection counts; native review still checks all retained
evidence before deletion.

Resources include `axiom://guide`, `axiom://capabilities`, `axiom://workflows` and
templates for a workspace, canonical document evidence, a reference and a graph.
Workspace listing is metadata-only; content reads are explicit and bounded. Exact
evidence carries generation/hash information when available. Truncation,
pagination and indexing state stay visible. Subscriptions and recursive binary
downloads are not supported.

Prompts `course_setup`, `research_synthesis` and `study_next_steps` accept a selected
`spaceId` and user `request`. They return workflow guidance/templates without
hidden provider calls, charges, code execution or automatic writes. Retrieved
content and supplied requests are untrusted data, never permission overrides.

## Prepare and review a course

1. Discover the authorized workspace, existing files and available tools. Retrieve
   `course_setup` and `axiom://workflows` for course/lesson templates.
2. Use `change_set_prepare` for a course folder, index, lessons and study tasks:
   at most 50 actions, a stable mutation ID, `@{key}` references and `dependsOn`
   for newly created entities. Label larger courses as explicit batches.
3. Open `approvalUrl`. The user reviews diffs/selects actions in Axiom and chooses
   **Approve & apply**. Proposal preparation itself never changes workspace files.
4. Poll `change_set_status` for receipts. Repeat-safe preparation preserves mutation
   identity; cancellation stops unapplied proposals, never rolls back completed
   work. Pending, rejected and failed proposals are not completed files/tasks.

`document_edit` uses this same review gate and current generation/hash checks,
preserving source-backed collaboration and receipts. Clients cannot approve
themselves or bypass review by calling a native business handler.
Binary transfer, reference writes/import/merge, extraction/provider dispatch and
arbitrary image manipulation are outside this stage.

## Verification and troubleshooting

An unauthenticated canonical request should return 401 with an OAuth challenge,
not **Origin or host is not allowed**. If 403 remains, inspect its public error code,
canonical `APP_URL`, proxy Host and explicit Origin. Do not disable protection.
Local code changes do not update a deployed endpoint: rebuild/redeploy through
the normal release procedure, then verify the challenge and reconnect.

Tests use the isolated release profile, never the working dataset:

```sh
npm run staging -- init
npm run staging -- dev
# Separate terminals:
npm run staging -- sync
npm run staging -- worker
npm run staging -- test tests/e2e/canvas-platform.spec.ts -g 'MCP OAuth'
npm run staging -- test tests/e2e/mcp-settings.spec.ts
```

Run typecheck, lint, unit tests, UI/theme/documentation validation and build gates
alongside applicable browser acceptance. PostgreSQL must be running before
staging setup; that does not authorize tests against working research data.
