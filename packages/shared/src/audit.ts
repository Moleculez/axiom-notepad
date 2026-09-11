export type AuditEvent = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string;
  contributors: string[];
  space_id: string | null;
  space_name: string | null;
  entity_id: string;
  entity_type: string;
  entity_name: string;
  action: string;
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  operation_id: string | null;
  version_id: string | null;
  version_available: boolean;
  resource_available: boolean;
  resource_kind: string | null;
  resource_space_id: string | null;
  evidence: string;
};
export type AuditPage = { items: AuditEvent[]; nextCursor: string | null };
export type OperationSummary = {
  id: string;
  kind: "files" | "trash" | "workspace";
  command: string;
  status: string;
  created_at: string;
  total: number;
  done: number;
  blocked: number;
  space_id?: string;
};
export function auditChanges(
  event: Pick<AuditEvent, "before_values" | "after_values">,
) {
  const before = event.before_values ?? {},
    after = event.after_values ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ key, before: before[key], after: after[key] }));
}
export const auditLabel = (value: string) => value.replace(/[-_]/g, " ");

/** Bounded line comparison; common edges remain context, changed lines are explicit. */
export function auditVersionDiff(before: string, after: string) {
  const a = before.split("\n"),
    b = after.split("\n");
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  return [
    ...a.slice(0, start).map((text) => ({ kind: "context" as const, text })),
    ...a
      .slice(start, a.length - end)
      .map((text) => ({ kind: "removed" as const, text })),
    ...b
      .slice(start, b.length - end)
      .map((text) => ({ kind: "added" as const, text })),
    ...a
      .slice(a.length - end)
      .map((text) => ({ kind: "context" as const, text })),
  ];
}
