import { z } from "zod";
import { query } from "./db";
import {
  editorDefaults,
  editorPreferencesSchema,
  validateEditorPreferences,
  type EditorPreferenceRecord,
} from "./editor";
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
export async function editorPreferencesApi(request: Request, userId: string) {
  const read = async () =>
    (
      await query<EditorPreferenceRecord & { mutation_id?: string }>(
        "SELECT preferences,version,mutation_id FROM user_editor_preferences WHERE user_id=$1",
        [userId],
      )
    )[0];
  if (request.method === "GET") {
    const record = (await read()) ?? {
      preferences: editorDefaults,
      version: 0,
    };
    return json({
      ...record,
      preferences: editorPreferencesSchema.parse(record.preferences),
    });
  }
  if (request.method !== "PATCH")
    return json({ error: "Method not allowed." }, 405);
  const input = z
    .object({
      preferences: z.unknown(),
      version: z.number().int().nonnegative(),
      mutationId: z.uuid(),
    })
    .strict()
    .parse(await request.json());
  let preferences;
  if ((input.preferences as { schemaVersion?: number })?.schemaVersion !== 2)
    return json({ error: "Reload Axiom before saving writing settings." }, 426);
  try {
    preferences = validateEditorPreferences(input.preferences);
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid editor preferences.",
      },
      422,
    );
  }
  const [record] =
    input.version === 0
      ? await query<EditorPreferenceRecord>(
          "INSERT INTO user_editor_preferences(user_id,preferences,mutation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING preferences,version",
          [userId, preferences, input.mutationId],
        )
      : await query<EditorPreferenceRecord>(
          "UPDATE user_editor_preferences SET preferences=$2,version=version+1,mutation_id=$4,updated_at=now() WHERE user_id=$1 AND version=$3 AND mutation_id IS DISTINCT FROM $4 RETURNING preferences,version",
          [userId, preferences, input.version, input.mutationId],
        );
  if (record) return json(record);
  const current = await read();
  if (current?.mutation_id === input.mutationId) return json(current);
  return json(
    {
      error: "Editor settings changed on another device.",
      current: current ?? { preferences: editorDefaults, version: 0 },
    },
    409,
  );
}
