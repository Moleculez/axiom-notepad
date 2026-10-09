import { query } from "./db";
import {
  defaultLocaleRecord,
  localeMutationSchema,
  type LocaleRecord,
} from "./locale-preferences";
const returning = 'locale,version,mutation_id AS "mutationId"';
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
export async function localeApi(
  request: Request,
  userId: string,
): Promise<Response> {
  if (request.method === "GET") {
    const [record] = await query<LocaleRecord>(
      `SELECT ${returning} FROM user_locale_preferences WHERE user_id=$1`,
      [userId],
    );
    return json(record ?? defaultLocaleRecord);
  }
  if (request.method !== "PATCH")
    return json(
      { error: "Method not allowed.", code: "method_not_allowed" },
      405,
    );
  const input = localeMutationSchema.parse(await request.json());
  const [record] =
    input.version === 0
      ? await query<LocaleRecord>(
          `INSERT INTO user_locale_preferences(user_id,locale,mutation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING ${returning}`,
          [userId, input.locale, input.mutationId],
        )
      : await query<LocaleRecord>(
          `UPDATE user_locale_preferences SET locale=$2,version=version+1,mutation_id=$4,updated_at=now() WHERE user_id=$1 AND version=$3 AND mutation_id IS DISTINCT FROM $4 RETURNING ${returning}`,
          [userId, input.locale, input.version, input.mutationId],
        );
  if (record) return json(record);
  const [current] = await query<LocaleRecord>(
    `SELECT ${returning} FROM user_locale_preferences WHERE user_id=$1`,
    [userId],
  );
  // Retrying the same acknowledged mutation is successful and increments once.
  if (
    current?.mutationId === input.mutationId &&
    current.locale === input.locale
  )
    return json(current);
  return json(
    {
      error:
        "Language changed on another device. Choose which version to keep.",
      code: "locale_conflict",
      current: current ?? defaultLocaleRecord,
    },
    409,
  );
}
