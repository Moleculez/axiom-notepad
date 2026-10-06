import { z } from "zod";
import {
  dateOnlySchema,
  taskStatusSchema,
  taskPrioritySchema,
} from "./workspace";

export const labLimits = {
  activeFields: 32,
  retainedFields: 200,
  options: 50,
  filters: 8,
  columns: 8,
  rules: 100,
  enabledRules: 20,
  runTasks: 100,
  runBytes: 1_500_000,
} as const;
export const fieldKinds = [
  "text",
  "number",
  "date",
  "checkbox",
  "url",
  "select",
  "multiselect",
  "person",
] as const;
export const fieldValueSchema = z.union([
  z.string().max(2000),
  z.number().finite().min(-1e12).max(1e12),
  z.boolean(),
  z.array(z.uuid()).max(50),
  z.null(),
]);
export type FieldValue = z.infer<typeof fieldValueSchema>;
export const customFieldsPatchSchema = z
  .record(z.uuid(), fieldValueSchema)
  .refine(
    (v) => Object.keys(v).length <= labLimits.activeFields,
    "Change at most 32 fields at once.",
  );
export const fieldInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(fieldKinds),
    unit: z.string().trim().max(40).default(""),
    options: z
      .array(
        z.object({
          id: z.uuid(),
          label: z.string().trim().min(1).max(100),
          archived: z.boolean().default(false),
        }),
      )
      .max(labLimits.options)
      .default([]),
    archived: z.boolean().default(false),
    position: z.number().int().min(0).max(10000).default(0),
  })
  .refine(
    (v) =>
      new Set(v.options.map((o) => o.id)).size === v.options.length &&
      new Set(v.options.map((o) => o.label.toLocaleLowerCase())).size ===
        v.options.length,
    "Choice IDs and labels must be distinct.",
  )
  .refine(
    (v) =>
      ["select", "multiselect"].includes(v.kind)
        ? v.archived || v.options.some((o) => !o.archived)
        : v.options.length === 0,
    "Choice fields need an active option; other fields cannot have options.",
  );
export type TaskField = z.infer<typeof fieldInputSchema> & {
  id: string;
  version: number;
  space_id: string;
};
export type FieldDefinitions = {
  items: TaskField[];
  version: number;
  limits: typeof labLimits;
};
export const fieldPresets = {
  experiment: [
    { name: "Experiment ID", kind: "text" },
    { name: "Instrument", kind: "text" },
    { name: "Protocol", kind: "url" },
    { name: "Replicates", kind: "number", unit: "runs" },
    {
      name: "Evidence stage",
      kind: "select",
      choices: ["Preparing", "Collecting", "Analysing", "Verified"],
    },
  ],
  paperReview: [
    { name: "Paper URL", kind: "url" },
    { name: "Venue", kind: "text" },
    { name: "Review deadline", kind: "date" },
    { name: "Reviewer", kind: "person" },
    {
      name: "Review decision",
      kind: "select",
      choices: ["Unreviewed", "Discuss", "Revise", "Accept"],
    },
  ],
} satisfies Record<
  string,
  Array<{
    name: string;
    kind: TaskField["kind"];
    unit?: string;
    choices?: string[];
  }>
>;
export function parseFieldValue(
  field: Pick<TaskField, "kind" | "options">,
  value: unknown,
): FieldValue {
  if (value === null) return null;
  switch (field.kind) {
    case "text":
      return z.string().max(2000).parse(value);
    case "number":
      return z.number().finite().min(-1e12).max(1e12).parse(value);
    case "date":
      return dateOnlySchema.parse(value);
    case "checkbox":
      return z.boolean().parse(value);
    case "url":
      return z
        .url()
        .max(2000)
        .refine(
          (v) => ["https:", "http:"].includes(new URL(v).protocol),
          "Use an HTTP or HTTPS URL.",
        )
        .parse(value);
    case "person":
      return z.string().min(1).max(100).parse(value);
    case "select": {
      const id = z.uuid().parse(value);
      if (!field.options.some((o) => o.id === id && !o.archived))
        throw new Error("Choose an active option.");
      return id;
    }
    case "multiselect": {
      const ids = z.array(z.uuid()).max(50).parse(value);
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => !field.options.some((o) => o.id === id && !o.archived))
      )
        throw new Error("Choose distinct active options.");
      return ids;
    }
  }
}
/** Preserve unfinished numeric grammar; canonical task values remain numbers. */
export function parseNumberFieldDraft(raw: string): number | string | null {
  if (raw === "") return null;
  const text = raw.trim();
  return /^[+-]?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(text) &&
    Number.isFinite(Number(text))
    ? Number(text)
    : raw;
}
export const fieldFilterSchema = z
  .object({
    fieldId: z.uuid(),
    op: z.enum(["eq", "in", "contains", "gte", "lte", "empty", "notEmpty"]),
    value: fieldValueSchema.optional(),
  })
  .strict();
export type FieldFilter = z.infer<typeof fieldFilterSchema>;
export const fieldFiltersSchema = z
  .array(fieldFilterSchema)
  .max(labLimits.filters);
/** The same typed filter contract is used by SQL reads and native rule drafts. */
export function validateFieldFilterValue(
  field: TaskField,
  filter: FieldFilter,
) {
  if (field.archived)
    throw new Error(
      `${field.name} is archived. Remove this filter or reopen the field.`,
    );
  if (["empty", "notEmpty"].includes(filter.op)) return;
  if (filter.value === undefined || filter.value === null)
    throw new Error("Choose a field filter value.");
  if (
    filter.value === "" ||
    (Array.isArray(filter.value) && !filter.value.length)
  )
    throw new Error(
      "Use Not set to find empty values, or choose a filter value.",
    );
  if (filter.op === "contains" && !["text", "url"].includes(field.kind))
    throw new Error("Contains is available for text and URLs.");
  if (
    ["gte", "lte"].includes(filter.op) &&
    !["number", "date"].includes(field.kind)
  )
    throw new Error("Range filters require a number or date field.");
  if (filter.op === "in") {
    if (
      !["select", "multiselect"].includes(field.kind) ||
      !Array.isArray(filter.value)
    )
      throw new Error("Use a choice field for included options.");
    if (
      !filter.value.length ||
      new Set(filter.value).size !== filter.value.length
    )
      throw new Error("Choose at least one distinct active option.");
    for (const id of filter.value)
      parseFieldValue({ ...field, kind: "select" }, id);
  } else if (filter.op === "contains")
    z.string().min(1, "Enter text to find.").max(2000).parse(filter.value);
  else parseFieldValue(field, filter.value);
}
export function fieldMatches(
  value: FieldValue | undefined,
  filter: Omit<FieldFilter, "fieldId">,
) {
  const empty =
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);
  if (filter.op === "empty") return empty;
  if (filter.op === "notEmpty") return !empty;
  if (empty || filter.value == null) return false;
  if (filter.op === "contains")
    return (
      typeof value === "string" &&
      typeof filter.value === "string" &&
      value.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase())
    );
  if (filter.op === "in") {
    const choices = filter.value;
    return (
      Array.isArray(choices) &&
      (Array.isArray(value)
        ? value.some((v) => choices.includes(v))
        : choices.includes(String(value)))
    );
  }
  if (filter.op === "eq" && Array.isArray(value) && Array.isArray(filter.value))
    return (
      JSON.stringify([...value].sort()) ===
      JSON.stringify([...filter.value].sort())
    );
  if (filter.op === "eq")
    return JSON.stringify(value) === JSON.stringify(filter.value);
  if (filter.op === "gte" || filter.op === "lte") {
    const bound = filter.value;
    if (typeof value === "number" && typeof bound === "number")
      return filter.op === "gte" ? value >= bound : value <= bound;
    if (typeof value === "string" && typeof bound === "string")
      return filter.op === "gte" ? value >= bound : value <= bound;
  }
  return false;
}
export function fieldDisplay(
  field: Pick<TaskField, "kind" | "options" | "unit">,
  value: FieldValue | undefined,
  people: Array<{ id: string; name: string }> = [],
) {
  if (value == null) return "—";
  if (field.kind === "checkbox") return value ? "Yes" : "No";
  if (field.kind === "select" || field.kind === "multiselect")
    return (
      (Array.isArray(value) ? value : [String(value)])
        .map(
          (id) =>
            field.options.find((o) => o.id === id)?.label ??
            "Unavailable option",
        )
        .join(", ") || "—"
    );
  if (field.kind === "person")
    return people.find((p) => p.id === value)?.name ?? "Unavailable person";
  return (
    String(value) +
    (field.kind === "number" && field.unit ? " " + field.unit : "")
  );
}
export function fieldSummaryText(
  field: TaskField,
  summaries:
    Record<string, { value: FieldValue; truncated: boolean }> | undefined,
  people: Array<{ id: string; name: string }> = [],
) {
  const v = summaries?.[field.id];
  return fieldDisplay(field, v?.value, people) + (v?.truncated ? "…" : "");
}
export const timeInputSchema = z
  .object({
    taskId: z.uuid(),
    spentOn: dateOnlySchema,
    minutes: z.number().int().min(1).max(1440),
    note: z.string().max(2000).default(""),
  })
  .strict();
export type TimeInput = z.infer<typeof timeInputSchema>;
export type TimeEntry = {
  id: string;
  task_id: string;
  task_title: string;
  task_deleted_at: string | null;
  author_id: string | null;
  author_name: string | null;
  spent_on: string;
  minutes: number;
  note?: string;
  note_preview: string;
  note_truncated: boolean;
  withdrawn: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};
export type TimePage = {
  items: TimeEntry[];
  total: number;
  totals: {
    minutes: number;
    entries: number;
    byMember: Array<{
      id: string | null;
      name: string | null;
      minutes: number;
    }>;
    byWeek: Array<{ week: string; minutes: number }>;
  };
  asOf: string;
  nextCursor: string | null;
};
export function timeCsv(entries: TimeEntry[]) {
  const cell = (value: unknown) => {
    let s = String(value ?? "");
    if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return [
    ["Date", "Task", "Member", "Minutes", "Hours", "Note", "State", "Entry ID"],
    ...entries.map((e) => [
      e.spent_on,
      e.task_title,
      e.author_name ?? "Unavailable member",
      e.minutes,
      (e.minutes / 60).toFixed(2),
      e.note ?? e.note_preview,
      e.withdrawn ? "Withdrawn" : "Active",
      e.id,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
export const timeQuerySchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    member: z.string().max(100).optional(),
    task: z.uuid().optional(),
    descendants: z.enum(["0", "1"]).default("0"),
    state: z.enum(["active", "withdrawn", "all"]).default("active"),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().max(1200).optional(),
  })
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "The start date must precede the end date.",
  );
export const ruleConditionSchema = z
  .object({
    field: z.enum([
      "status",
      "priority",
      "assignee",
      "label",
      "overdue",
      "custom",
    ]),
    fieldId: z.uuid().optional(),
    op: z
      .enum(["eq", "in", "contains", "gte", "lte", "empty", "notEmpty"])
      .default("eq"),
    value: fieldValueSchema.optional(),
  })
  .strict()
  .transform((c) =>
    c.field === "label" && c.op === "contains" && typeof c.value === "string"
      ? { ...c, value: c.value.trim() }
      : c,
  );
export const ruleActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), value: taskStatusSchema }),
  z.object({ kind: z.literal("priority"), value: taskPrioritySchema }),
  z.object({
    kind: z.literal("assignee"),
    value: z.string().max(100).nullable(),
  }),
  z.object({
    kind: z.enum(["addLabel", "removeLabel"]),
    value: z.string().trim().min(1).max(40),
  }),
  z.object({
    kind: z.literal("custom"),
    fieldId: z.uuid(),
    value: fieldValueSchema,
  }),
]);
export const ruleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    trigger: z.enum(["created", "changed", "daily"]),
    watched: z
      .array(
        z.enum([
          "status",
          "priority",
          "assignee_id",
          "labels",
          "custom_fields",
        ]),
      )
      .max(5)
      .default(["status"]),
    at: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .default("09:00"),
    conditions: z.array(ruleConditionSchema).max(8).default([]),
    actions: z.array(ruleActionSchema).min(1).max(8),
    enabled: z.boolean().default(false),
    archived: z.boolean().default(false),
  })
  .strict()
  .refine(
    (r) => r.trigger !== "changed" || r.watched.length > 0,
    "Choose metadata to watch.",
  )
  .refine((r) => {
    const keys = r.actions.map((a) =>
      a.kind === "custom"
        ? "custom:" + a.fieldId
        : a.kind === "addLabel" || a.kind === "removeLabel"
          ? "label:" + a.value
          : a.kind,
    );
    return new Set(keys).size === keys.length;
  }, "Each property or label may have only one action.");
export type AutomationRule = z.infer<typeof ruleInputSchema> & {
  id: string;
  version: number;
  configured_by: string | null;
  space_id: string;
};
/** Pure validation; the server separately checks current workspace-person access. */
export function validateRuleConfiguration(
  rule: Pick<AutomationRule, "conditions" | "actions">,
  definitions: TaskField[],
) {
  const activeField = (id: string | undefined) => {
    const field = definitions.find((f) => f.id === id && !f.archived);
    if (!field)
      throw new Error(
        "Choose an available custom field, or remove it from this rule.",
      );
    return field;
  };
  const message = (error: unknown) =>
    error instanceof z.ZodError
      ? (error.issues[0]?.message ?? "Choose a valid value.")
      : error instanceof Error
        ? error.message
        : "Choose a valid value.";
  rule.conditions.forEach((condition, index) => {
    try {
      const c = condition;
      if (c.field === "custom") {
        const field = activeField(c.fieldId);
        validateFieldFilterValue(field, {
          fieldId: field.id,
          op: c.op,
          value: c.value,
        });
      } else if (c.field === "overdue") {
        if (c.op !== "eq" || typeof c.value !== "boolean")
          throw new Error("Overdue conditions use Yes or No.");
      } else if (c.field === "label") {
        if (!["contains", "empty", "notEmpty"].includes(c.op))
          throw new Error("Use a label name or an empty/nonempty condition.");
        if (c.op === "contains")
          z.string().trim().min(1).max(40).parse(c.value);
      } else {
        if (!["eq", "empty", "notEmpty"].includes(c.op))
          throw new Error("Choose one status, priority or assignee value.");
        if (c.op === "eq") {
          if (c.field === "status") taskStatusSchema.parse(c.value);
          else if (c.field === "priority") taskPrioritySchema.parse(c.value);
          else z.string().min(1).max(100).parse(c.value);
        }
      }
    } catch (error) {
      throw new Error(`Condition ${index + 1}: ${message(error)}`);
    }
  });
  rule.actions.forEach((action, index) => {
    try {
      if (action.kind === "custom")
        parseFieldValue(activeField(action.fieldId), action.value);
    } catch (error) {
      throw new Error(`Action ${index + 1}: ${message(error)}`);
    }
  });
}
export type AutomationTask = {
  id: string;
  version: number;
  title: string;
  status: string;
  priority: string;
  assignee_id: string | null;
  labels: string[];
  due_on: string | null;
  custom_fields: Record<string, FieldValue>;
  deleted_at?: string | null;
};
export type MetadataPatch = {
  status?: string;
  priority?: string;
  assigneeId?: string | null;
  labels?: string[];
  customFields?: Record<string, FieldValue>;
};
export type AutomationChange = {
  id: string;
  version: number;
  title: string;
  before: MetadataPatch;
  patch: MetadataPatch;
  resultVersion?: number;
};
export type AutomationRun = {
  id: string;
  rule_id: string;
  rule_name: string;
  status: "pending" | "applied" | "cancelled" | "undone" | "noop" | "blocked";
  version: number;
  error: string | null;
  created_at: string;
  tasks: number;
  changes?: AutomationChange[];
  preview?: {
    id: string;
    selected: string[];
    expiresAt: string;
    userId: string;
  } | null;
};
export function localDay(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function localClock(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}
export function ruleMatches(
  rule: Pick<AutomationRule, "conditions">,
  task: AutomationTask,
  today: string,
) {
  return (
    !task.deleted_at &&
    rule.conditions.every((c) => {
      const value =
        c.field === "custom"
          ? task.custom_fields[c.fieldId ?? ""]
          : c.field === "assignee"
            ? task.assignee_id
            : c.field === "label"
              ? task.labels
              : c.field === "overdue"
                ? !!task.due_on &&
                  task.due_on < today &&
                  !["done", "cancelled"].includes(task.status)
                : task[c.field];
      if (c.field === "label")
        return c.op === "contains" && typeof c.value === "string"
          ? task.labels.includes(c.value)
          : c.op === "empty"
            ? task.labels.length === 0
            : c.op === "notEmpty"
              ? task.labels.length > 0
              : false;
      return fieldMatches(value, c);
    })
  );
}
export function ruleChange(
  rule: Pick<AutomationRule, "actions">,
  task: AutomationTask,
): AutomationChange | null {
  const patch: MetadataPatch = {},
    before: MetadataPatch = {};
  let labels = [...task.labels];
  for (const a of rule.actions) {
    if (a.kind === "addLabel") {
      if (!labels.includes(a.value)) labels.push(a.value);
    } else if (a.kind === "removeLabel")
      labels = labels.filter((v) => v !== a.value);
    else if (a.kind === "custom") {
      const old = task.custom_fields[a.fieldId] ?? null;
      if (JSON.stringify(old) !== JSON.stringify(a.value)) {
        (patch.customFields ??= {})[a.fieldId] = a.value;
        (before.customFields ??= {})[a.fieldId] = old;
      }
    } else {
      const key = a.kind === "assignee" ? "assigneeId" : a.kind,
        old = a.kind === "assignee" ? task.assignee_id : task[a.kind];
      if (old !== a.value) {
        Object.assign(patch, { [key]: a.value });
        Object.assign(before, { [key]: old });
      }
    }
  }
  if (labels.length > 20)
    throw new Error("This rule would exceed the 20-label task limit.");
  if (JSON.stringify(labels) !== JSON.stringify(task.labels)) {
    patch.labels = labels;
    before.labels = task.labels;
  }
  return Object.keys(patch).length
    ? { id: task.id, version: task.version, title: task.title, before, patch }
    : null;
}
