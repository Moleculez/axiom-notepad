import { createHash } from "node:crypto";
import { z } from "zod";
import { dateOnlySchema } from "./workspace";
import {
  goalQuerySchema,
  historyQuerySchema,
  occurrenceQuerySchema,
} from "./planning-archives";

const instant = z.iso.datetime().regex(/\.\d{1,6}Z$|:\d{2}Z$/);
const cursorSchema = z
  .object({
    v: z.literal(1),
    context: z.string().regex(/^[a-f0-9]{64}$/),
    asOf: instant,
    at: z.union([instant, dateOnlySchema]),
    id: z.uuid(),
  })
  .strict();
export type ArchiveCursor = z.infer<typeof cursorSchema>;
export const archiveCursorLifetime = 24 * 60 * 60 * 1000;
// PostgreSQL keeps microseconds. Date.parse alone would round the read position.
const exactInstant = (value: string) =>
  value.replace(
    /(?:\.(\d+))?Z$/,
    (_, fraction: string | undefined) => `.${(fraction ?? "").padEnd(6, "0")}Z`,
  );

/** Read positions are not credentials. The caller rechecks access on every page. */
export function parsePage<Q extends { cursor?: string }>(
  query: Q,
  namespace: string,
  space: string,
  user: string,
  entity: string | null,
  datePosition: boolean,
  now: number,
) {
  const { cursor: encoded, ...filters } = query;
  const context = createHash("sha256")
    .update(JSON.stringify([namespace, space, user, entity, filters]))
    .digest("hex");
  let cursor: ArchiveCursor | null = null;
  if (encoded) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
      );
      const age = now - Date.parse(cursor.asOf);
      if (
        cursor.context !== context ||
        age < -5000 ||
        age > archiveCursorLifetime ||
        (datePosition
          ? !dateOnlySchema.safeParse(cursor.at).success
          : !instant.safeParse(cursor.at).success ||
            exactInstant(cursor.at) > exactInstant(cursor.asOf))
      )
        throw new Error();
    } catch {
      throw new Error(
        "This results page expired or its filters changed. Refresh to start from the first page.",
      );
    }
  }
  return { query, context, cursor };
}
export function parseGoalPageQuery(
  params: URLSearchParams,
  space: string,
  user: string,
  now = Date.now(),
) {
  return parsePage(
    goalQuerySchema.parse(Object.fromEntries(params)),
    "goals",
    space,
    user,
    null,
    false,
    now,
  );
}
export function parseHistoryPageQuery(
  params: URLSearchParams,
  space: string,
  user: string,
  entity: string,
  now = Date.now(),
) {
  return parsePage(
    historyQuerySchema.parse(Object.fromEntries(params)),
    "history",
    space,
    user,
    entity,
    false,
    now,
  );
}
export function parseOccurrencePageQuery(
  params: URLSearchParams,
  space: string,
  user: string,
  entity: string,
  now = Date.now(),
) {
  return parsePage(
    occurrenceQuerySchema.parse(Object.fromEntries(params)),
    "occurrences",
    space,
    user,
    entity,
    true,
    now,
  );
}
export function encodeArchiveCursor(cursor: ArchiveCursor) {
  return Buffer.from(JSON.stringify(cursorSchema.parse(cursor))).toString(
    "base64url",
  );
}
