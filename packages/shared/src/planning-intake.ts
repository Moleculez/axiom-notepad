import { z } from "zod";
import { intakeInputSchema } from "./planning-suite";

export const intakeStatuses = [
  "pending",
  "needs-changes",
  "accepted",
  "rejected",
  "withdrawn",
] as const;
export const intakeStatusLabels: Record<
  (typeof intakeStatuses)[number],
  string
> = {
  pending: "Awaiting review",
  "needs-changes": "Changes requested",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};
export const intakeQuerySchema = z.object({
  filter: z.enum(["all", "open", "history", ...intakeStatuses]).default("all"),
  q: z.string().trim().max(200).default(""),
  kind: intakeInputSchema.shape.kind.optional(),
  mine: z.enum(["0", "1"]).default("0"),
  sort: z.enum(["newest", "oldest"]).default("newest"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(1200).optional(),
});
export type IntakeQuery = z.infer<typeof intakeQuerySchema>;
export type IntakeStatus = (typeof intakeStatuses)[number];
export type IntakeSummary = Omit<
  z.infer<typeof intakeInputSchema>,
  "body" | "dueOn"
> & {
  id: string;
  version: number;
  created_by: string | null;
  author_name: string | null;
  reviewer_name: string | null;
  status: IntakeStatus;
  due_on: string | null;
  decision_note: string;
  task_id: string | null;
  created_at: string;
  updated_at: string;
};
export type IntakeRequest = IntakeSummary & { body: string };
export type IntakePage = {
  canReview: boolean;
  items: IntakeSummary[];
  total: number;
  statusCounts: Record<IntakeStatus, number>;
  nextCursor: string | null;
  asOf: string;
};
export type IntakeDetail = { canReview: boolean; item: IntakeRequest };
