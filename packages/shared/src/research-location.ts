import { z } from "zod";
import { query } from "./db";
import { HttpError, resourceAccess, fileAccess } from "./access";
import {
  checkLibraryScope,
  resolveLibraryScope,
  referenceAccess,
} from "./research-library-service";
import { workspaceResearchRoute } from "./research-navigation";

/** Resolve legacy entry points without exposing an inaccessible workspace. */
export async function researchLocation(user: string, input: URLSearchParams) {
  const p = new URLSearchParams(input),
    focus = p.get("focus") ?? "",
    referenceId =
      p.get("reference") ||
      (focus.startsWith("reference:") ? focus.slice(10) : ""),
    collectionId = p.get("collection"),
    explicit = p.get("spaceId") || p.get("space");
  let spaceId = explicit ? z.uuid().parse(explicit) : "";
  if (referenceId) {
    const [reference] = await query(
      "SELECT b.id,b.space_id FROM bibliography b WHERE b.id=coalesce((SELECT reference_id FROM research_workspace_reference_map WHERE original_id=$1 AND space_id=$2::uuid),$1::uuid)",
      [z.uuid().parse(referenceId), spaceId || null],
    );
    if (!reference || (spaceId && reference.space_id !== spaceId))
      throw new HttpError(404, "Reference unavailable in this workspace.");
    await referenceAccess(user, reference.id);
    spaceId = reference.space_id;
    if (p.has("reference")) p.set("reference", reference.id);
    if (focus.startsWith("reference:"))
      p.set("focus", "reference:" + reference.id);
  } else if (/^(note|pdf):/.test(focus)) {
    const [kind, value] = focus.split(":");
    const source =
      kind === "note"
        ? await resourceAccess(user, z.uuid().parse(value))
        : await fileAccess(user, z.uuid().parse(value));
    if (spaceId && source.space.id !== spaceId)
      throw new HttpError(404, "Source unavailable in this workspace.");
    spaceId = source.space.id;
  }
  if (collectionId && collectionId !== "unfiled") {
    const [collection] = await query(
      "SELECT c.id,c.space_id FROM reference_collections c WHERE c.id=coalesce((SELECT collection_id FROM research_workspace_collection_map WHERE original_id=$1 AND space_id=$2::uuid),$1::uuid)",
      [z.uuid().parse(collectionId), spaceId || null],
    );
    if (!collection || (spaceId && collection.space_id !== spaceId))
      throw new HttpError(404, "Collection unavailable in this workspace.");
    spaceId = collection.space_id;
    p.set("collection", collection.id);
  }
  const scope = await resolveLibraryScope(
    user,
    spaceId
      ? { spaceId }
      : { groupId: p.get("groupId") || p.get("group") || null },
  );
  await checkLibraryScope(user, scope);
  return { route: workspaceResearchRoute(scope.spaceId, p) };
}
