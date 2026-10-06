import { z } from "zod";
import { dateOnlySchema, taskStatusSchema } from "./workspace";
import type { goalProgress } from "./planning-suite";

/** Archived goals still count toward this workspace-wide creation limit. */
export const workspaceGoalLimit = 200;
const pageFields = {
  q: z.string().trim().max(200).default(""),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(1200).optional(),
};
export const goalQuerySchema = z.object({
  ...pageFields,
  filter: z.enum(["active", "archived", "all"]).default("active"),
  kind: z.enum(["linked", "metric"]).optional(),
  mine: z.enum(["0", "1"]).default("0"),
});
export const historyQuerySchema = z.object({
  ...pageFields,
  mine: z.enum(["0", "1"]).default("0"),
});
export const occurrenceQuerySchema = z
  .object({
    ...pageFields,
    state: z.enum(["all", "active", "deleted"]).default("all"),
    status: taskStatusSchema.optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "End date must be on or after the start date.",
    path: ["to"],
  });
export type GoalQuery = z.infer<typeof goalQuerySchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type OccurrenceQuery = z.infer<typeof occurrenceQuerySchema>;
export type ArchivePage<T> = {
  items: T[];
  total: number;
  nextCursor: string | null;
  /** Creation ceiling, not an immutable snapshot of later edits. */
  asOf: string;
};
export type GoalSummary = {
  id: string;
  title: string;
  owner_id: string | null;
  owner_name: string | null;
  due_on: string | null;
  kind: "linked" | "metric";
  target: number;
  current_value: number;
  unit: string;
  archived: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  progress: ReturnType<typeof goalProgress>;
};
export type GoalDetail = GoalSummary & {
  body: string;
  task_ids: string[];
  milestone_ids: string[];
};
export type GoalPage = ArchivePage<GoalSummary> & {
  stateCounts: { active: number; archived: number };
  /** Unfiltered live count: a search never grants extra creation capacity. */
  workspaceTotal: number;
  goalLimit: number;
};
export type HistoryEntry = {
  id: string;
  kind: string;
  summary: string;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
};
export type HistoryPage = ArchivePage<HistoryEntry>;
export type OccurrenceSummary = {
  id: string;
  title: string;
  occurs_on: string;
  status: z.infer<typeof taskStatusSchema>;
  deleted_at: string | null;
};
export type OccurrencePage = ArchivePage<OccurrenceSummary>;
