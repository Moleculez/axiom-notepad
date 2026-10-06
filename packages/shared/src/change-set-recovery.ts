import {
  actionReferences,
  orderedActions,
  type ChangeAction,
} from "./productivity";

type RecoveryAction = {
  data: ChangeAction;
  state: string;
  selected: boolean;
  entity_id: string;
};
/** Completed/indeterminate work can never enter a new execution request. */
export function remainingChangeActions(rows: RecoveryAction[], keys: string[]) {
  const byKey = new Map(rows.map((r) => [r.data.key, r]));
  const wanted = new Set<string>();
  const completedIds = Object.fromEntries(
    rows
      .filter(
        (r) =>
          r.state === "complete" &&
          [
            "file_create",
            "folder_create",
            "workspace_task_create",
            "workspace_milestone_create",
          ].includes(r.data.action),
      )
      .map((r) => [r.data.key, r.entity_id]),
  );
  const visit = (key: string) => {
    const row = byKey.get(key);
    if (!row) throw new Error("Unknown remaining action: " + key);
    if (row.state === "complete") return;
    if (!row.selected || !["pending", "failed"].includes(row.state))
      throw new Error(
        "Inspect and reconcile uncertain or unapplied prerequisites before preparing this action.",
      );
    if (wanted.has(key)) return;
    wanted.add(key);
    [
      ...row.data.dependsOn,
      ...actionReferences([row.data.targetId, row.data.payload]),
    ].forEach(visit);
  };
  keys.forEach(visit);
  if (!wanted.size)
    throw new Error(
      "There are no eligible unfinished actions in this selection.",
    );
  const replaceCompleted = <T>(value: T): T => {
    if (typeof value === "string")
      return value.replace(
        /@\{([a-z][a-z0-9_-]{0,39})\}/g,
        (literal, key: string) => completedIds[key] ?? literal,
      ) as T;
    if (Array.isArray(value)) return value.map(replaceCompleted) as T;
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, replaceCompleted(v)]),
      ) as T;
    return value;
  };
  const actions = rows
    .filter((r) => wanted.has(r.data.key))
    .map((r) => ({
      ...replaceCompleted(r.data),
      dependsOn: r.data.dependsOn.filter((key) => wanted.has(key)),
    }));
  // Full validation still runs in create/preview; this validates the reduced graph.
  orderedActions(actions);
  return actions;
}
