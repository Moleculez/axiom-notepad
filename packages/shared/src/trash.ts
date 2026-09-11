import { z } from "zod";
export const trashSelectionSchema = z
  .object({
    mutationId: z.uuid(),
    action: z.enum(["purge", "restore"]),
    target: z.enum(["files", "workspaces"]).default("files"),
    restorePolicy: z.enum(["root", "retain"]).default("root"),
    destinationId: z.uuid().nullable().default(null),
    conflictPolicy: z.enum(["keep-both", "skip"]).default("keep-both"),
    after: z.iso.date().optional(),
    before: z.iso.date().optional(),
    spaceIds: z.array(z.uuid()).min(1).max(500),
    ids: z.array(z.uuid()).max(5000).default([]),
    allMatching: z.boolean().default(false),
    q: z.string().max(200).default(""),
    kind: z.enum(["", "note", "folder", "file", "shortcut"]).default(""),
  })
  .refine(
    (v) => (v.allMatching ? !v.ids.length : v.ids.length > 0),
    "Choose selected items or all matching items, not both.",
  );
export type TrashSelection = z.infer<typeof trashSelectionSchema>;
export type TrashItem = {
  resource_id: string;
  space_id: string;
  component_id: string;
  version: number;
  deleted_at: string;
  parent_id: string | null;
  kind: string;
  note_id: string | null;
  name: string;
  original_path: string;
  bytes: number;
  status: "pending" | "done" | "blocked" | "skipped" | "cancelled";
  reason: string | null;
};
export type TrashOperation = {
  id: string;
  action: "purge" | "restore";
  target_kind: "files" | "workspaces";
  destination_id: string | null;
  conflict_policy: "keep-both" | "skip";
  restore_policy: "root" | "retain";
  status: "preview" | "queued" | "running" | "completed" | "cancelled";
  scope_ids: string[];
  created_at: string;
  attempt: number;
  total: number;
  done: number;
  pending: number;
  blocked: number;
  skipped: number;
  cancelled: number;
  bytes: number;
};
export type TrashOperationPage = {
  operation: TrashOperation;
  items: TrashItem[];
  nextOffset: number | null;
};
/** Hierarchy and existing reference edges form atomic units. Independent units
 * can finish, resume or be cancelled without breaking internal references. */
export function trashComponents(
  ids: string[],
  edges: [string, string][],
): Map<string, string> {
  const parents = new Map(ids.map((id) => [id, id]));
  const root = (id: string): string => {
    let top = id;
    while (parents.get(top) !== top) top = parents.get(top)!;
    while (parents.get(id) !== id) {
      const next = parents.get(id)!;
      parents.set(id, top);
      id = next;
    }
    return top;
  };
  for (const [a, b] of edges)
    if (parents.has(a) && parents.has(b)) {
      const x = root(a),
        y = root(b);
      if (x !== y) parents.set(x > y ? x : y, x > y ? y : x);
    }
  return new Map(ids.map((id) => [id, root(id)]));
}
