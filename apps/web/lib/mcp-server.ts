import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import { query } from "@axiom/shared/db";
import { HttpError, spaceAccess } from "@axiom/shared/access";
import {
  activeConnection,
  connectionAllowsSpace,
  type IntegrationConnection,
} from "@axiom/shared/integration-security";
import {
  integrationActions,
  type IntegrationScope,
} from "@axiom/shared/integration-catalog";
import { documentCommandSchema } from "@axiom/shared/document-commands";
import {
  changeSetInput,
  isWorkspaceMutation,
  productivityLimits,
} from "@axiom/shared/productivity";
import { prepareIntegrationChange } from "@axiom/shared/integration-change-sets";
import {
  createChangeSet,
  changeSetView,
  cancelChangeSet,
} from "@axiom/shared/workspace-change-sets";
import {
  researchIntegrationTools,
  researchIntegrationResourceTemplates,
  executeResearchIntegrationRead,
  readResearchIntegrationResource,
} from "@axiom/shared/integration-research";
import {
  mcpSafetyInstructions,
  mcpWorkflowArguments,
  mcpWorkflows,
  mcpWorkflowMessage,
  mcpWorkflowTemplates,
} from "@axiom/shared/mcp-workflows";
import {
  mcpToolResult,
  mcpToolError,
  mcpFailure,
} from "@axiom/shared/mcp-results";
import { executeIntegrationAction } from "./integration-executor";

export function createWorkspaceMcpServer(
  connection: IntegrationConnection,
  scopes: IntegrationScope[],
  canonicalOrigin: string,
) {
  const check = async (
    scope: IntegrationScope = "workspace:read",
    spaceId?: string,
  ) => {
    if (!scopes.includes(scope))
      throw new HttpError(403, "The access token does not grant this action.");
    const live = await activeConnection(
      connection.id,
      connection.user_id,
      scope,
      undefined,
      connection.grant_version,
    );
    if (spaceId) {
      connectionAllowsSpace(live, spaceId);
      await spaceAccess(live.user_id, spaceId);
    }
    return live;
  };
  const run = async (
    work: () => Promise<unknown>,
    scope: IntegrationScope = "workspace:read",
  ) => {
    try {
      await check(scope);
      const result = await work();
      await check(scope);
      return mcpToolResult(result);
    } catch (error) {
      return mcpToolError(error);
    }
  };
  // The SDK serializes callback error messages. Never pass backend exceptions
  // through resource/prompt handlers, even though their transport is authenticated.
  const read = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      const failure = mcpFailure(error);
      throw new Error(
        `${failure.category}: ${failure.message} Request ID: ${failure.requestId}`,
      );
    }
  };
  const workspaces = async () => {
    const live = await check();
    const rows = await query(
      "SELECT s.id,s.kind,s.group_id,s.project_id,s.status,coalesce(p.name,g.name,'Personal space') AS name,axiom_space_role($1,s.id) AS role FROM spaces s LEFT JOIN groups g ON g.id=s.group_id LEFT JOIN projects p ON p.id=s.project_id WHERE s.id=ANY($2::uuid[]) AND axiom_base_space_role($1,s.id) IS NOT NULL AND axiom_space_state(s.id) IN ('active','archived') ORDER BY s.id LIMIT 500",
      [live.user_id, live.space_ids],
    );
    await check();
    return rows;
  };
  const mcp = new McpServer(
    { name: "axiom-research-workspace", version: "1.1.0" },
    { instructions: mcpSafetyInstructions },
  );
  const status = async () => {
    const live = await check();
    const value = {
      endpoint: `${canonicalOrigin}/mcp`,
      transport: "streamable-http",
      scopes,
      workspaces: await workspaces(),
      grantRevision: live.grant_version,
      tools: [
        ...integrationActions
          .filter((a) => scopes.includes(a.scope))
          .map((a) => a.name),
        ...researchIntegrationTools.map((a) => a.name),
        "workspaces_list",
        "mcp_connection_status",
        "change_set_status",
        "change_set_cancel",
        ...(scopes.includes("workspace:write")
          ? ["document_edit", "change_set_prepare"]
          : []),
      ],
      documentFormats: ["markdown", "latex", "text", "canvas"],
      approvalRequired: true,
      maximumActions: productivityLimits.actions,
      maximumRequestBytes: 5_500_000,
      maximumResultBytes: 4_000_000,
      subscriptions: false,
      binaryTransfers: false,
    };
    await check();
    return value;
  };
  mcp.registerTool(
    "workspaces_list",
    {
      description:
        "List only currently readable workspaces explicitly shared with this connection.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => run(workspaces),
  );
  mcp.registerTool(
    "mcp_connection_status",
    {
      description:
        "Read the canonical endpoint, current grants, capabilities and approval limits. No secrets are returned.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => run(status),
  );
  for (const action of integrationActions.filter((a) =>
    scopes.includes(a.scope),
  )) {
    const mutation = isWorkspaceMutation(action.name);
    mcp.registerTool(
      action.name,
      {
        title: action.name.replaceAll("_", " "),
        description:
          action.description +
          (mutation
            ? " Returns a review-required change set; no workspace write occurs until in-app approval."
            : ""),
        inputSchema: action.inputSchema,
        annotations: {
          readOnlyHint: !mutation,
          destructiveHint: !!action.approval,
          openWorldHint: false,
        },
      },
      (input) =>
        run(
          () => executeIntegrationAction(connection, action.name, input),
          action.scope,
        ),
    );
  }
  for (const action of researchIntegrationTools)
    mcp.registerTool(
      action.name,
      {
        description: action.description,
        inputSchema: action.inputSchema,
        annotations: action.annotations,
      },
      (input: unknown) =>
        run(() =>
          executeResearchIntegrationRead(connection, action.name, input),
        ),
    );
  if (scopes.includes("workspace:write")) {
    mcp.registerTool(
      "document_edit",
      {
        description:
          "Prepare a reviewed canonical-source edit using current generation/contentHash and a stable mutationId. Supports Markdown, LaTeX, text and Canvas commands. Never writes immediately; poll the returned change set after in-app approval.",
        inputSchema: documentCommandSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (command) =>
        run(
          () => prepareIntegrationChange(connection, "document_edit", command),
          "workspace:write",
        ),
    );
    mcp.registerTool(
      "change_set_prepare",
      {
        title: "Prepare coordinated changes",
        description:
          "Prepare up to 50 actions for in-app review. Use @{key} dependencies and stable mutationId. Users approve in Axiom; clients cannot self-approve.",
        inputSchema: changeSetInput,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      (input) =>
        run(async () => {
          for (const action of input.actions) {
            const registered = integrationActions.find(
              (a) => a.name === action.action,
            );
            if (
              action.action !== "document_edit" &&
              (!registered || !isWorkspaceMutation(action.action))
            )
              throw new HttpError(
                400,
                "Change sets accept only supported workspace mutation actions.",
              );
            const required = registered?.scope ?? "workspace:write";
            if (!scopes.includes(required))
              throw new HttpError(
                403,
                "The access token does not grant this action.",
              );
          }
          const result = await createChangeSet(
            {
              userId: connection.user_id,
              spaceIds: connection.space_ids,
              connectionId: connection.id,
              grantVersion: connection.grant_version,
            },
            input,
          );
          return {
            changeSetId: result.id,
            status: result.status,
            requiresApproval: true,
            approvalUrl: `${canonicalOrigin}/workbench/settings/connections?review=${result.id}`,
          };
        }, "workspace:write"),
    );
  }
  for (const operation of ["status", "cancel"] as const)
    mcp.registerTool(
      `change_set_${operation}`,
      {
        description:
          operation === "status"
            ? "Read this connection's change-set review and execution receipts."
            : "Cancel this connection's unapplied proposals. Completed work is never rolled back.",
        inputSchema: z.object({ id: z.uuid() }).strict(),
        annotations: {
          readOnlyHint: operation === "status",
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      ({ id }) =>
        run(() =>
          operation === "status"
            ? changeSetView(id, connection.user_id, connection.id)
            : cancelChangeSet(id, connection.user_id, connection.id),
        ),
    );
  const resource = (uri: URL, value: unknown) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: mcpToolResult(value).content[0].text,
      },
    ],
  });
  mcp.registerResource(
    "workspace-guide",
    "axiom://guide",
    {
      mimeType: "text/plain",
      description: "Safe discovery, exact evidence and reviewed changes.",
    },
    async (uri) =>
      read(async () => {
        await check();
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `${mcpSafetyInstructions} Discover workspaces and tools first. Use change_set_prepare for dependent batches, open approvalUrl, then poll change_set_status. Research library and annotation tools are read-only. Binary transfers and resource subscriptions are not supported.`,
            },
          ],
        };
      }),
  );
  mcp.registerResource(
    "connection-capabilities",
    "axiom://capabilities",
    {
      mimeType: "application/json",
      description: "Current connection capabilities and shared workspaces.",
    },
    async (uri) => read(async () => resource(uri, await status())),
  );
  mcp.registerResource(
    "study-workflow-templates",
    "axiom://workflows",
    {
      mimeType: "application/json",
      description:
        "Course, lesson and research templates; creating files requires review.",
    },
    async (uri) =>
      read(async () => {
        await check();
        return resource(uri, mcpWorkflowTemplates());
      }),
  );
  mcp.registerResource(
    "authorized-workspace",
    new ResourceTemplate("axiom://workspaces/{spaceId}", {
      list: async () =>
        read(async () => ({
          resources: (await workspaces()).map((s) => ({
            uri: `axiom://workspaces/${s.id}`,
            name: String(s.name),
            mimeType: "application/json",
          })),
        })),
    }),
    {
      mimeType: "application/json",
      description: "One explicitly shared workspace summary.",
    },
    async (uri, variables) =>
      read(async () => {
        const spaceId = z.uuid().parse(variables.spaceId);
        await check("workspace:read", spaceId);
        const value = (await workspaces()).find((s) => s.id === spaceId);
        if (!value) throw new HttpError(404, "Workspace unavailable.");
        return resource(uri, value);
      }),
  );
  mcp.registerResource(
    "canonical-document-evidence",
    new ResourceTemplate(
      "axiom://workspaces/{spaceId}/documents/{resourceId}",
      { list: undefined },
    ),
    {
      mimeType: "application/json",
      description:
        "Exact bounded canonical evidence with generation/hash, not recursive file discovery.",
    },
    async (uri, variables) =>
      read(async () => {
        const spaceId = z.uuid().parse(variables.spaceId),
          id = z.uuid().parse(variables.resourceId);
        await check("workspace:read", spaceId);
        const value = await executeIntegrationAction(
          connection,
          "workspace_evidence_read",
          { spaceId, query: { id } },
        );
        await check("workspace:read", spaceId);
        return resource(uri, value);
      }),
  );
  for (const {
    name,
    uriTemplate,
    description,
  } of researchIntegrationResourceTemplates)
    mcp.registerResource(
      name,
      new ResourceTemplate(uriTemplate, { list: undefined }),
      { mimeType: "application/json", description },
      async (uri) =>
        read(async () =>
          resource(uri, await readResearchIntegrationResource(connection, uri)),
        ),
    );
  for (const workflow of mcpWorkflows)
    mcp.registerPrompt(
      workflow.name,
      {
        title: workflow.title,
        description: workflow.description,
        argsSchema: mcpWorkflowArguments,
      },
      async (args) =>
        read(async () => {
          await check("workspace:read", args.spaceId);
          return {
            description: workflow.description,
            messages: [
              {
                role: "user" as const,
                content: {
                  type: "text" as const,
                  text: mcpWorkflowMessage(workflow.name, args),
                },
              },
            ],
          };
        }),
    );
  return mcp;
}
