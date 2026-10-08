import { randomUUID } from "node:crypto";
import { appUrl } from "./auth";
import { query } from "./db";
import { HttpError } from "./access";
import { createChangeSet } from "./workspace-change-sets";
import { getIntegrationActionSchema } from "./integration-catalog";
import { documentCommandSchema } from "./document-commands";
import type { IntegrationConnection } from "./integration-security";

export async function prepareIntegrationChange(
  connection: IntegrationConnection,
  name: string,
  raw: unknown,
) {
  const input =
    name === "document_edit"
      ? null
      : getIntegrationActionSchema(name).parse(raw);
  const command =
    name === "document_edit" ? documentCommandSchema.parse(raw) : null;
  const target = command
    ? (
        await query("SELECT space_id FROM resources WHERE note_id=$1", [
          command.noteId,
        ])
      )[0]
    : null;
  if (command && !target) throw new HttpError(404, "Document unavailable.");
  const mutationId =
    input?.approvalId ??
    (command?.mutationId ||
      (typeof input?.payload.mutationId === "string"
        ? input.payload.mutationId
        : randomUUID()));
  const spaceId = command ? target!.space_id : input!.spaceId;
  const value = await createChangeSet(
    {
      userId: connection.user_id,
      spaceIds: connection.space_ids,
      connectionId: connection.id,
      grantVersion: connection.grant_version,
    },
    {
      mutationId,
      title: name.replaceAll("_", " "),
      spaceIds: [
        ...new Set([
          spaceId,
          ...(typeof input?.payload.destinationSpaceId === "string"
            ? [input.payload.destinationSpaceId]
            : []),
          ...(Array.isArray(input?.payload.spaceIds)
            ? input.payload.spaceIds
            : []),
        ]),
      ],
      actions: [
        {
          key: "action",
          action: name,
          spaceId,
          targetId: command?.noteId ?? input?.id,
          title: name.replaceAll("_", " "),
          explanation: "Requested by " + connection.name,
          dependsOn: [],
          payload: command ?? input!.payload,
        },
      ],
    },
  );
  await query(
    "INSERT INTO integration_calls(connection_id,actor_id,action,scope,outcome,resource_ids,operation_id) VALUES($1,$2,$3,'workspace:write','review-required',$4,$5)",
    [
      connection.id,
      connection.user_id,
      name,
      input?.id ? [input.id] : [],
      value.id,
    ],
  );
  return {
    requiresApproval: value.status === "draft",
    approvalId: value.id,
    changeSetId: value.id,
    status: value.status,
    approvalUrl: `${appUrl}/workbench/settings/connections?review=${value.id}`,
    results: value.actions.map((a) => ({
      key: a.data.key,
      status: a.state,
      result: a.result,
      error: a.error,
    })),
    message:
      "Review and apply in Axiom. The client cannot approve its own request. Poll change_set_status; retries return the existing receipt, not a second write.",
  };
}
