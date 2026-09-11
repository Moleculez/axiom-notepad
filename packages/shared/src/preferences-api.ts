import { z } from "zod";
import { query } from "./db";
import {
  defaults,
  normalizePreferenceRecord,
  preferencesSchema,
  type PreferenceRecord,
  APPEARANCE_SCHEMA,
  appearanceForClient,
} from "./appearance";
const returning =
  'preferences,version,previous_preferences AS "previousPreferences"';
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
export async function preferencesApi(
  request: Request,
  userId: string,
): Promise<Response> {
  if (request.method === "GET") {
    const [record] = await query<PreferenceRecord>(
      `SELECT ${returning} FROM user_preferences WHERE user_id=$1`,
      [userId],
    );
    const current = appearanceForClient(
      request,
      normalizePreferenceRecord(
        record ?? { preferences: defaults, version: 0 },
      ),
    );
    return current
      ? json(current)
      : json({ error: "Reload Axiom to load these appearance settings." }, 426);
  }
  if (request.method === "PATCH") {
    const raw = await request.json();
    // Older clients cannot represent all fonts and fields. Require a refresh
    // instead of allowing a legacy profile to overwrite them with defaults.
    if (raw?.preferences?.schemaVersion !== APPEARANCE_SCHEMA)
      return json(
        { error: "Reload Axiom before saving appearance settings." },
        426,
      );
    const input = z
      .object({
        preferences: preferencesSchema,
        version: z.number().int().nonnegative(),
        mutationId: z.uuid(),
        savePrevious: z.boolean().optional(),
      })
      .strict()
      .parse(raw);
    const [record] =
      input.version === 0
        ? await query<PreferenceRecord>(
            `INSERT INTO user_preferences(user_id,preferences,mutation_id,previous_preferences) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING ${returning}`,
            [
              userId,
              input.preferences,
              input.mutationId,
              input.savePrevious ? defaults : null,
            ],
          )
        : await query<PreferenceRecord>(
            `UPDATE user_preferences SET previous_preferences=CASE WHEN $5 THEN preferences ELSE previous_preferences END,preferences=$2,version=version+1,mutation_id=$4,updated_at=now() WHERE user_id=$1 AND version=$3 AND mutation_id IS DISTINCT FROM $4 RETURNING ${returning}`,
            [
              userId,
              input.preferences,
              input.version,
              input.mutationId,
              input.savePrevious ?? false,
            ],
          );
    if (record) return json(normalizePreferenceRecord(record));
    const [current] = await query<PreferenceRecord & { mutation_id?: string }>(
      `SELECT ${returning},mutation_id FROM user_preferences WHERE user_id=$1`,
      [userId],
    );
    if (current?.mutation_id === input.mutationId)
      return json(normalizePreferenceRecord(current));
    return json(
      {
        error: "Preferences changed on another device.",
        current: current
          ? normalizePreferenceRecord(current)
          : { preferences: defaults, version: 0 },
      },
      409,
    );
  }
  return json({ error: "Method not allowed." }, 405);
}
