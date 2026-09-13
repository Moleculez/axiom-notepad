import { createHash } from "node:crypto";
import { query, transaction } from "@axiom/shared/db";
import { HttpError, noteAccess, spaceAccess } from "@axiom/shared/access";
import { flushNote } from "@axiom/shared/documents";
import { sourceHash } from "@axiom/shared/document-commands";
import {
  activeConnection,
  connectionAllowsSpace,
  type IntegrationConnection,
} from "@axiom/shared/integration-security";
import {
  integrationActions,
  integrationActionInput,
} from "@axiom/shared/integration-catalog";
import { withAuditContext } from "@axiom/shared/audit-context";
import { appUrl } from "@axiom/shared/auth";
import { handleAuthorized } from "./api-handler";
const stable = (value: unknown): string =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(stable).join(",")}]`
      : `{${Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => JSON.stringify(k) + ":" + stable(v))
          .join(",")}}`;
export async function executeIntegrationAction(
  connection: IntegrationConnection,
  name: string,
  raw: unknown,
) {
  const action = integrationActions.find((a) => a.name === name);
  if (!action) throw new HttpError(404, "Unknown workspace action.");
  const input = integrationActionInput.parse(raw),
    live = await activeConnection(
      connection.id,
      connection.user_id,
      action.scope,
      undefined,
      connection.grant_version,
    );
  connectionAllowsSpace(live, input.spaceId);
  const space = await spaceAccess(live.user_id, input.spaceId);
  const verifyTargets = async () => {
    await activeConnection(
      live.id,
      live.user_id,
      action.scope,
      undefined,
      live.grant_version,
    );
    if (action.target === "resource") {
      const [row] = await query("SELECT space_id FROM resources WHERE id=$1", [
        input.id,
      ]);
      if (!row || row.space_id !== input.spaceId)
        throw new HttpError(
          403,
          "Resource is not in the selected authorized workspace.",
        );
    }
    if (action.target === "project" && input.id !== space.project_id)
      throw new HttpError(
        403,
        "Project does not match the authorized workspace.",
      );
    if (
      action.target === "group" &&
      (input.id !== space.group_id || space.kind !== "team")
    )
      throw new HttpError(
        403,
        "Select the group's team workspace for administration.",
      );
    for (const field of ["spaceId", "destinationSpaceId"])
      if (typeof input.payload[field] === "string")
        connectionAllowsSpace(live, input.payload[field] as string);
    for (const field of ["parentId", "resourceId", "noteId"])
      if (typeof input.payload[field] === "string") {
        const [row] = await query(
          name === "note_comment" && field === "parentId"
            ? "SELECT r.space_id FROM comments c JOIN resources r ON r.note_id=c.note_id WHERE c.id=$1"
            : "SELECT space_id FROM resources WHERE id=$1",
          [input.payload[field]],
        );
        if (!row || !live.space_ids.includes(row.space_id))
          throw new HttpError(
            403,
            "A referenced target is outside this connection's workspaces.",
          );
      }
  };
  await verifyTargets();
  let approvalId: string | undefined;
  const { approvalId: provided, ...argumentsValue } = input;
  const requestHash = createHash("sha256")
    .update(name + stable(argumentsValue))
    .digest("hex");
  if (action.approval) {
    if (!provided) {
      const [approval] = await query(
        "INSERT INTO integration_approvals(connection_id,action,arguments,request_hash) VALUES($1,$2,$3,$4) RETURNING id,expires_at",
        [live.id, name, JSON.stringify(argumentsValue), requestHash],
      );
      return {
        requiresApproval: true,
        approvalId: approval.id,
        expiresAt: approval.expires_at,
        approvalUrl: `${appUrl}/workbench/settings/connections`,
        message:
          "Ask the user to review this exact action in Axiom. After approval, retry with the same arguments and approvalId. The client cannot approve its own request.",
      };
    }
    const claim = await transaction(async (client) => {
      await activeConnection(
        live.id,
        live.user_id,
        action.scope,
        client,
        live.grant_version,
      );
      const {
        rows: [approval],
      } = await client.query(
        "SELECT * FROM integration_approvals WHERE id=$1 AND connection_id=$2 FOR UPDATE",
        [provided, live.id],
      );
      if (
        !approval ||
        approval.action !== name ||
        approval.request_hash !== requestHash
      )
        throw new HttpError(
          403,
          "Approval does not match these exact arguments.",
        );
      if (approval.status === "complete")
        return { complete: true, result: approval.result };
      if (
        approval.status !== "approved" ||
        new Date(approval.expires_at).valueOf() <= Date.now()
      )
        throw new HttpError(
          409,
          "Approval is pending, expired, or already used. Review it in Axiom.",
        );
      await client.query(
        "UPDATE integration_approvals SET status='executing' WHERE id=$1",
        [provided],
      );
      return { complete: false };
    });
    if (claim.complete) return claim.result;
    approvalId = provided;
  }
  const operationId =
    typeof input.payload.mutationId === "string"
      ? input.payload.mutationId
      : approvalId;
  try {
    const result = await withAuditContext(
      {
        actorId: live.user_id,
        operationId,
        integrationId: live.id,
        integrationClient: live.client_id,
        integrationScope: action.scope,
        integrationVersion: live.grant_version,
      },
      async () => {
        const [user] = await query<{ id: string; email: string; name: string }>(
          'SELECT id,email,name FROM "user" WHERE id=$1',
          [live.user_id],
        );
        if (!user) throw new HttpError(401, "Account unavailable.");
        if (name === "note_read") {
          const note = await noteAccess(user.id, input.id!);
          await flushNote(note);
          const current = await noteAccess(user.id, input.id!);
          await verifyTargets();
          return { ...current, contentHash: sourceHash(current.body) };
        }
        const path = action.path.replace(
          ":id",
          encodeURIComponent(
            action.target === "workspace" ? input.spaceId : (input.id ?? ""),
          ),
        );
        if (path.includes(":id") || path.endsWith("//"))
          throw new HttpError(400, "This action needs a target ID.");
        const url = new URL(`${appUrl}/api/v1/${path}`);
        for (const [k, v] of Object.entries(input.query))
          url.searchParams.set(k, v);
        url.searchParams.set("spaceId", input.spaceId);
        url.searchParams.set("space", input.spaceId);
        url.searchParams.set("spaces", input.spaceId);
        if (name === "files_list" && !url.searchParams.has("view"))
          url.searchParams.set("view", "all");
        const payload = {
          ...input.payload,
          ...(action.target === "workspace" &&
          ["file_create", "folder_create"].includes(name)
            ? { spaceId: input.spaceId }
            : {}),
          ...(operationId ? { mutationId: operationId } : {}),
        };
        const response = await handleAuthorized(
          new Request(url, {
            method: action.method,
            headers: { origin: appUrl, "content-type": "application/json" },
            ...(action.method !== "GET"
              ? { body: JSON.stringify(payload) }
              : {}),
          }),
          path.split("/"),
          user,
        );
        const text = await response.text();
        if (text.length > 4_000_000)
          throw new HttpError(
            413,
            "Result is too large. Use pagination or the file download tool.",
          );
        const output = JSON.parse(text);
        if (!response.ok)
          throw new HttpError(
            response.status,
            output.error ?? "Action failed.",
          );
        if (action.method === "GET") await verifyTargets();
        return output;
      },
    );
    if (approvalId)
      await query(
        "UPDATE integration_approvals SET status='complete',result=$2,completed_at=now() WHERE id=$1",
        [approvalId, JSON.stringify(result)],
      );
    await query(
      "INSERT INTO integration_calls(connection_id,actor_id,action,scope,outcome,resource_ids,operation_id) VALUES($1,$2,$3,$4,'complete',$5,$6)",
      [
        live.id,
        live.user_id,
        name,
        action.scope,
        input.id ? [input.id] : [],
        operationId ?? null,
      ],
    );
    return result;
  } catch (e) {
    if (approvalId)
      await query(
        "UPDATE integration_approvals SET status='failed',error=$2,completed_at=now() WHERE id=$1",
        [approvalId, (e as Error).message.slice(0, 500)],
      );
    await query(
      "INSERT INTO integration_calls(connection_id,actor_id,action,scope,outcome,resource_ids) VALUES($1,$2,$3,$4,'failed',$5)",
      [live.id, live.user_id, name, action.scope, input.id ? [input.id] : []],
    );
    throw e;
  }
}
