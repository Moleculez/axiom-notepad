import { z } from "zod";

export const MAX_FILE_BYTES = 1_000_000_000;
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const contentRoleSchema = z.enum(["viewer", "commenter", "editor"]);
export type ContentRole = z.infer<typeof contentRoleSchema>;
export type Capability = "read" | "comment" | "edit" | "manage";
export const resourceKindSchema = z.enum([
  "folder",
  "note",
  "file",
  "shortcut",
]);
export const resourceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (name) => !/[\u0000-\u001f/\\]/.test(name) && name !== "." && name !== "..",
    "Use a name without slashes or control characters.",
  );
export function roleAllows(
  role: ContentRole | null | undefined,
  action: Exclude<Capability, "manage">,
) {
  return (
    !!role &&
    (action === "read" ||
      role === "editor" ||
      (action === "comment" && role === "commenter"))
  );
}
export interface Space {
  id: string;
  kind: "personal" | "team" | "project";
  name: string;
  description?: string;
  group_name?: string;
  audience?: "group" | "restricted";
  color?: string;
  timezone?: string;
  project_version?: number;
  archived_at?: string | null;
  deleted_at?: string | null;
  stored_bytes?: number;
  owner_id: string | null;
  group_id: string | null;
  project_id: string | null;
  quota_bytes: number | null;
  role: ContentRole;
  can_manage: boolean;
  status: SpaceStatus;
  effective_status: SpaceStatus;
  parent_status?: SpaceStatus | null;
  version: number;
  group_role?: "owner" | "admin" | "member";
  lifecycle_actions: SpaceLifecycleAction[];
}
export type SpaceStatus = "active" | "archived" | "trashed" | "purging";
export type SpaceLifecycleAction =
  "archive" | "unarchive" | "trash" | "restore" | "purge";
export function spaceLifecycleActions(
  space: Pick<
    Space,
    | "kind"
    | "status"
    | "effective_status"
    | "parent_status"
    | "can_manage"
    | "group_role"
  >,
): SpaceLifecycleAction[] {
  if (space.kind === "personal" || !space.can_manage) return [];
  if (space.parent_status && space.parent_status !== "active") return [];
  if (space.effective_status === "purging")
    return space.status === "purging" && space.group_role === "owner"
      ? ["restore"]
      : [];
  // An inherited trash/archive state can only be lifted at the parent.
  if (
    space.effective_status !== space.status &&
    ["trashed", "archived"].includes(space.effective_status)
  )
    return [];
  if (space.status === "trashed")
    return space.group_role === "owner"
      ? space.kind === "team"
        ? ["restore"]
        : ["restore", "purge"]
      : space.kind === "project"
        ? ["restore"]
        : [];
  const actions: SpaceLifecycleAction[] = [
    space.status === "archived" ? "unarchive" : "archive",
  ];
  if (space.kind === "project" || space.group_role === "owner")
    actions.push("trash");
  return actions;
}
export interface Resource {
  document_type?: "markdown" | "math" | "text" | "canvas" | "image";
  id: string;
  space_id: string;
  parent_id: string | null;
  kind: "folder" | "note" | "file" | "shortcut";
  name: string;
  description: string;
  owner_id: string;
  note_id: string | null;
  current_version_id: string | null;
  version: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  favorite?: boolean;
  mime?: string;
  bytes?: number;
  role?: ContentRole;
  has_children?: boolean;
  shortcut_target_id?: string | null;
  folder_color?: string | null;
}
export interface ResourcePage {
  items: Resource[];
  nextCursor: string | null;
  breadcrumbs: Pick<Resource, "id" | "name" | "kind">[];
}
/** Authorized, root-first physical location, independent of how a file was opened. */
export interface ResourceLocation {
  resource: Pick<Resource, "id" | "space_id" | "parent_id" | "name" | "kind">;
  space: Pick<Space, "id" | "name" | "kind">;
  ancestors: Pick<Resource, "id" | "name" | "kind">[];
}
export const taskStatusSchema = z.enum([
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
]);
export const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const date = new Date(v + "T00:00:00Z");
    return (
      Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === v
    );
  }, "Enter a valid calendar date.");
export const timezoneSchema = z
  .string()
  .max(100)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone.");
export const recurrenceSchema = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(52).default(1),
    start: dateOnlySchema,
    until: dateOnlySchema.optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  })
  .refine(
    (v) => !v.until || v.until >= v.start,
    "End date must follow the start date.",
  );
export type Recurrence = z.infer<typeof recurrenceSchema>;
export interface Task {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  body: string;
  status: z.infer<typeof taskStatusSchema>;
  priority: z.infer<typeof taskPrioritySchema>;
  assignee_id: string | null;
  start_on: string | null;
  due_on: string | null;
  estimate_hours: number | null;
  labels: string[];
  milestone_id: string | null;
  note_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  blocked?: boolean;
  assignee_name?: string;
  dependencies?: string[];
}
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  affiliation: z.string().max(200).default(""),
  interests: z.string().max(500).default(""),
  biography: z.string().max(3000).default(""),
  links: z
    .array(
      z
        .url()
        .max(1000)
        .refine((v) => /^https?:\/\//i.test(v), "Use an HTTP or HTTPS URL."),
    )
    .max(8)
    .default([]),
  timezone: timezoneSchema.default("UTC"),
  weeklyCapacity: z.number().min(0).max(168).default(40),
});
export const notificationPreferencesSchema = z.object({
  assignments: z.boolean().default(true),
  mentions: z.boolean().default(true),
  reviews: z.boolean().default(true),
  reminders: z.boolean().default(true),
  discussions: z.boolean().default(true),
  email: z.boolean().default(false),
});
export function recurrenceOccursOn(rule: Recurrence, date: string): boolean {
  if (
    !dateOnlySchema.safeParse(date).success ||
    date < rule.start ||
    (rule.until && date > rule.until)
  )
    return false;
  const start = new Date(rule.start + "T00:00:00Z"),
    target = new Date(date + "T00:00:00Z");
  const days = Math.round((target.valueOf() - start.valueOf()) / 86400000);
  if (rule.frequency === "daily") return days % rule.interval === 0;
  if (rule.frequency === "weekly") {
    const week = Math.floor((days + start.getUTCDay()) / 7);
    return (
      week % rule.interval === 0 &&
      (rule.weekdays?.length ? rule.weekdays : [start.getUTCDay()]).includes(
        target.getUTCDay(),
      )
    );
  }
  const months =
    (target.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    target.getUTCMonth() -
    start.getUTCMonth();
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return (
    months % rule.interval === 0 &&
    target.getUTCDate() === Math.min(start.getUTCDate(), lastDay)
  );
}
export function nextCalendarDate(date: string) {
  return new Date(new Date(date + "T00:00:00Z").valueOf() + 86400000)
    .toISOString()
    .slice(0, 10);
}
