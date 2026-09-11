import { z } from "zod";
import { query, transaction } from "./db";
import {
  defaults,
  preferencesSchema,
  type PreferenceRecord,
  APPEARANCE_SCHEMA,
  appearanceForClient,
} from "./appearance";
import {
  editorDefaults,
  validateEditorPreferences,
  type EditorPreferenceRecord,
} from "./editor";
import { normalizeBundle, type PreferencesBundle } from "./preferences-bundle";

const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
const appearanceFields =
  'preferences,version,previous_preferences AS "previousPreferences",mutation_id';
type Saved<T> = T & { mutation_id?: string };
class Conflict extends Error {}
export async function preferencesBundleApi(request: Request, userId: string) {
  const read = async (): Promise<PreferencesBundle> => {
    // One SQL statement gives a consistent snapshot, including absent rows.
    const [row] = await query<{
      appearance: PreferenceRecord | null;
      editor: EditorPreferenceRecord | null;
    }>(
      `SELECT (SELECT json_build_object('preferences',preferences,'version',version,'previousPreferences',previous_preferences) FROM user_preferences WHERE user_id=$1) AS appearance,(SELECT json_build_object('preferences',preferences,'version',version) FROM user_editor_preferences WHERE user_id=$1) AS editor`,
      [userId],
    );
    return normalizeBundle({
      appearance: row.appearance ?? { preferences: defaults, version: 0 },
      editor: row.editor ?? {
        preferences: row.appearance
          ? {
              ...editorDefaults,
              codeWrap: row.appearance.preferences.codeWrap,
              codeLineNumbers: row.appearance.preferences.lineNumbers,
            }
          : editorDefaults,
        version: 0,
      },
    });
  };
  if (request.method === "GET") {
    const bundle = await read();
    const appearance = appearanceForClient(request, bundle.appearance);
    return appearance
      ? json({ ...bundle, appearance })
      : json({ error: "Reload Axiom to load these appearance settings." }, 426);
  }
  if (request.method !== "PATCH")
    return json({ error: "Method not allowed." }, 405);
  const raw = await request.json();
  if (
    raw?.appearance?.preferences?.schemaVersion !== APPEARANCE_SCHEMA ||
    raw?.editor?.preferences?.schemaVersion !== 2
  )
    return json({ error: "Reload Axiom before saving preferences." }, 426);
  const revision = z.number().int().nonnegative();
  const input = z
    .object({
      appearance: z
        .object({ preferences: preferencesSchema, version: revision })
        .strict(),
      editor: z
        .object({ preferences: z.unknown(), version: revision })
        .strict(),
      mutationId: z.uuid(),
      savePrevious: z.boolean().optional(),
    })
    .strict()
    .parse(raw);
  let editor;
  try {
    editor = validateEditorPreferences(input.editor.preferences);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error ? error.message : "Invalid writing settings.",
      },
      422,
    );
  }
  try {
    return json(
      await transaction(async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('axiom:preferences:' || $1))",
          [userId],
        );
        const a = (
          await client.query<Saved<PreferenceRecord>>(
            `SELECT ${appearanceFields} FROM user_preferences WHERE user_id=$1 FOR UPDATE`,
            [userId],
          )
        ).rows[0];
        const e = (
          await client.query<Saved<EditorPreferenceRecord>>(
            "SELECT preferences,version,mutation_id FROM user_editor_preferences WHERE user_id=$1 FOR UPDATE",
            [userId],
          )
        ).rows[0];
        if (
          a?.mutation_id === input.mutationId &&
          e?.mutation_id === input.mutationId
        )
          return normalizeBundle({ appearance: a, editor: e });
        if (
          (a?.version ?? 0) !== input.appearance.version ||
          (e?.version ?? 0) !== input.editor.version
        )
          throw new Conflict();
        const appearance = a
          ? await client.query<PreferenceRecord>(
              `UPDATE user_preferences SET preferences=$2,version=version+1,mutation_id=$3,previous_preferences=CASE WHEN $4 THEN preferences ELSE previous_preferences END,updated_at=now() WHERE user_id=$1 RETURNING ${appearanceFields}`,
              [
                userId,
                input.appearance.preferences,
                input.mutationId,
                !!input.savePrevious,
              ],
            )
          : await client.query<PreferenceRecord>(
              `INSERT INTO user_preferences(user_id,preferences,mutation_id,previous_preferences) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING ${appearanceFields}`,
              [
                userId,
                input.appearance.preferences,
                input.mutationId,
                input.savePrevious ? defaults : null,
              ],
            );
        const writing = e
          ? await client.query<EditorPreferenceRecord>(
              "UPDATE user_editor_preferences SET preferences=$2,version=version+1,mutation_id=$3,updated_at=now() WHERE user_id=$1 RETURNING preferences,version",
              [userId, editor, input.mutationId],
            )
          : await client.query<EditorPreferenceRecord>(
              "INSERT INTO user_editor_preferences(user_id,preferences,mutation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING preferences,version",
              [userId, editor, input.mutationId],
            );
        if (!appearance.rowCount || !writing.rowCount) throw new Conflict();
        return normalizeBundle({
          appearance: appearance.rows[0],
          editor: writing.rows[0],
        });
      }),
    );
  } catch (error) {
    if (!(error instanceof Conflict)) throw error;
    return json(
      {
        error:
          "Preferences changed on another device. Review the conflicting fields.",
        current: await read(),
      },
      409,
    );
  }
}
