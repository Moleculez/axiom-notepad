import type pg from "pg";
import { HttpError } from "./access";
import { currentAuditContext, type AuditContext } from "./audit-context";
import {
  activeConnection,
  connectionAllowsSpace,
} from "./integration-security";

/** Narrow native reads, never a capability upgrade for other integration code. */
export async function requireResearchIntegrationRead(
  user: string,
  spaceId: string,
  area: NonNullable<AuditContext["integrationReadArea"]>,
  client?: pg.PoolClient,
) {
  const context = currentAuditContext();
  if (!context?.integrationId && !context?.allowedSpaceIds) return;
  if (
    context.integrationReadArea !== area ||
    !context.integrationId ||
    context.actorId !== user ||
    !context.integrationClient ||
    !context.integrationVersion ||
    context.integrationScope !== "workspace:read" ||
    context.allowedSpaceIds?.length !== 1 ||
    context.allowedSpaceIds[0] !== spaceId
  )
    throw new HttpError(
      403,
      "Select an explicitly granted research workspace.",
    );
  const live = await activeConnection(
    context.integrationId,
    user,
    "workspace:read",
    client,
    context.integrationVersion,
  );
  if (live.client_id !== context.integrationClient)
    throw new HttpError(403, "The connected application's identity changed.");
  connectionAllowsSpace(live, spaceId);
}
