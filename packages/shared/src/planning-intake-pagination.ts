import { createHash } from "node:crypto";
import { z } from "zod";
import { intakeQuerySchema, type IntakeQuery } from "./planning-intake";

const instant = z.iso.datetime();
const cursorSchema = z
  .object({
    v: z.literal(1),
    context: z.string().regex(/^[a-f0-9]{64}$/),
    asOf: instant,
    at: instant,
    id: z.uuid(),
  })
  .strict();
export type IntakeCursor = z.infer<typeof cursorSchema>;
export const intakeCursorLifetime = 24 * 60 * 60 * 1000;

/** A cursor is a read position, never authorization. Every page rechecks access. */
export function intakeCursorContext(
  query: IntakeQuery,
  space: string,
  user: string,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        space,
        user,
        query.filter,
        query.q,
        query.kind ?? null,
        query.mine,
        query.sort,
        query.limit,
      ]),
    )
    .digest("hex");
}
export function parseIntakePageQuery(
  params: URLSearchParams,
  space: string,
  user: string,
  now = Date.now(),
) {
  const query = intakeQuerySchema.parse(Object.fromEntries(params));
  const context = intakeCursorContext(query, space, user);
  let cursor: IntakeCursor | null = null;
  if (query.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")),
      );
      const age = now - Date.parse(cursor.asOf);
      if (
        cursor.context !== context ||
        age < -5000 ||
        age > intakeCursorLifetime ||
        Date.parse(cursor.at) > Date.parse(cursor.asOf)
      )
        throw new Error();
    } catch {
      throw new Error(
        "This results page expired or its filters changed. Start from the first page.",
      );
    }
  }
  return { query, context, cursor };
}
export function encodeIntakeCursor(value: IntakeCursor) {
  return Buffer.from(JSON.stringify(cursorSchema.parse(value))).toString(
    "base64url",
  );
}
export function intakeFilterStatuses(filter: IntakeQuery["filter"]) {
  return filter === "all"
    ? null
    : filter === "open"
      ? ["pending", "needs-changes"]
      : filter === "history"
        ? ["accepted", "rejected", "withdrawn"]
        : [filter];
}
