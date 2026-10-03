/** Server adapter: only catalogued actions reach the existing application services. */
import { query } from "@axiom/shared/db";
import { appUrl } from "@axiom/shared/auth";
import { HttpError } from "@axiom/shared/access";
import {
  integrationActions,
  integrationPath,
} from "@axiom/shared/integration-catalog";
import {
  authorizeAction,
  type ActionExecutor,
} from "@axiom/shared/workspace-actions";
import { handleAuthorized } from "./api-handler";

export const executeReviewedAction: ActionExecutor = async (
  actor,
  action,
  operationId,
  setId,
) => {
  await authorizeAction(actor, action);
  if (action.action === "document_edit") {
    const response = await fetch(
      `${process.env.SYNC_INTERNAL_URL ?? "http://127.0.0.1:1234"}/internal/document-command`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.SYNC_SECRET}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actorId: actor.userId,
          setId,
          actionId: operationId,
          command: action.payload,
        }),
        signal: AbortSignal.timeout(30000),
      },
    );
    const result = await response.json();
    if (!response.ok)
      throw new HttpError(
        response.status,
        result.error ?? "Document edit failed.",
      );
    return result;
  }
  const definition = integrationActions.find((a) => a.name === action.action);
  if (!definition) throw new HttpError(400, "Unknown reviewed action.");
  const [user] = await query<{ id: string; email: string; name: string }>(
    'SELECT id,email,name FROM "user" WHERE id=$1',
    [actor.userId],
  );
  if (!user) throw new HttpError(401, "Account unavailable.");
  const path = integrationPath(definition, action.spaceId, action.targetId);
  if (path.includes(":id") || path.includes("//"))
    throw new HttpError(400, "Action needs a target.");
  const url = new URL(`${appUrl}/api/v1/${path}`);
  url.searchParams.set("spaceId", action.spaceId);
  const response = await handleAuthorized(
    new Request(url, {
      method: definition.method,
      headers: { origin: appUrl, "content-type": "application/json" },
      body: JSON.stringify({
        ...action.payload,
        ...(["file_create", "folder_create"].includes(action.action)
          ? { spaceId: action.spaceId }
          : {}),
        mutationId: operationId,
      }),
    }),
    path.split("/"),
    user,
  );
  const result = await response.json();
  if (!response.ok)
    throw new HttpError(
      response.status,
      result.error ?? "Reviewed action failed.",
    );
  return result;
};
