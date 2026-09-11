import { query } from "./db";
import type { FileOperation } from "./file-workflows";

export async function visibleFileOperation<T extends FileOperation>(
  op: T,
  userId: string,
): Promise<T> {
  const ids = [
    ...new Set(
      op.input.items
        .map((item) => item.id)
        .concat(op.results.flatMap((r) => (r.resource ? [r.resource.id] : []))),
    ),
  ];
  const allowed = new Set(
    (
      await query<{ id: string }>(
        "SELECT id FROM resources WHERE id=ANY($2::uuid[]) AND axiom_base_space_role($1,space_id) IS NOT NULL",
        [userId, ids],
      )
    ).map((r) => r.id),
  );
  const spaces = [
    ...new Set(
      op.input.items
        .map((i) => i.original.space_id)
        .concat(op.input.destination?.spaceId ?? []),
    ),
  ];
  const accessibleSpaces = new Set(
    (
      await query<{ id: string }>(
        "SELECT id FROM spaces WHERE id=ANY($2::uuid[]) AND axiom_base_space_role($1,id) IS NOT NULL",
        [userId, spaces],
      )
    ).map((r) => r.id),
  );
  const hidden = (item: FileOperation["input"]["items"][number]) =>
    !allowed.has(item.id) || !accessibleSpaces.has(item.original.space_id);
  return {
    ...op,
    input: {
      ...op.input,
      destination:
        op.input.destination &&
        accessibleSpaces.has(op.input.destination.spaceId)
          ? op.input.destination
          : undefined,
      items: op.input.items.map((item) =>
        hidden(item)
          ? {
              ...item,
              name: undefined,
              original: {
                ...item.original,
                name: "Unavailable item",
                parent_id: null,
                space_id: "",
              },
            }
          : item,
      ),
    },
    results: op.results.map((result) => {
      const item = op.input.items.find((i) => i.id === result.id);
      return !item ||
        hidden(item) ||
        (result.resource && !allowed.has(result.resource.id))
        ? {
            id: result.id,
            ok: result.ok,
            error: "Access changed. Item details are unavailable.",
          }
        : result;
    }),
  };
}
