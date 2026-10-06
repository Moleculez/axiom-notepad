import type { PoolClient } from "pg";
import { z } from "zod";
import { HttpError } from "./access";
import {
  customFieldsPatchSchema,
  parseFieldValue,
  labLimits,
  fieldFiltersSchema,
  validateFieldFilterValue,
  type TaskField,
  type FieldDefinitions,
  type FieldValue,
  type FieldFilter,
} from "./planning-lab";

export async function fieldDefinitions(
  db: PoolClient,
  space: string,
): Promise<FieldDefinitions> {
  const items = await db.query<TaskField>(
      "SELECT id,space_id,name,kind,unit,options,archived,position,version FROM planning_fields WHERE space_id=$1 ORDER BY archived,position,lower(name),id",
      [space],
    ),
    state = await db.query(
      "SELECT planning_fields_version FROM spaces WHERE id=$1",
      [space],
    );
  return {
    items: items.rows,
    version: state.rows[0].planning_fields_version,
    limits: labLimits,
  };
}
export async function validateCustomPatch(
  db: PoolClient,
  space: string,
  raw: unknown,
  revision: unknown,
  previous: Record<string, FieldValue> = {},
  definitions?: FieldDefinitions,
  permittedPeople?: Set<string>,
) {
  const patch = customFieldsPatchSchema.parse(raw),
    defs = definitions ?? (await fieldDefinitions(db, space));
  if (defs.version !== z.number().int().positive().parse(revision))
    throw new HttpError(
      409,
      "Task fields changed. Review the latest field definitions; your draft has been retained.",
    );
  const result = { ...previous };
  for (const [id, rawValue] of Object.entries(patch)) {
    const field = defs.items.find((f) => f.id === id && !f.archived);
    if (!field)
      throw new HttpError(
        409,
        "A task field is unavailable or archived. Remove it from this change or reopen it first.",
      );
    let value: FieldValue;
    try {
      value = parseFieldValue(field, rawValue);
    } catch (e) {
      throw new HttpError(400, `${field.name}: ${(e as Error).message}`);
    }
    if (
      field.kind === "person" &&
      value !== null &&
      !(permittedPeople
        ? permittedPeople.has(String(value))
        : (
            await db.query(
              "SELECT 1 WHERE axiom_space_role($1,$2) IS NOT NULL",
              [value, space],
            )
          ).rowCount)
    )
      throw new HttpError(
        400,
        `${field.name}: choose a person with workspace access.`,
      );
    if (value === null) delete result[id];
    else result[id] = value;
  }
  return result;
}
export function parseFieldQuery(params: URLSearchParams) {
  let filters: FieldFilter[] = [];
  try {
    filters = fieldFiltersSchema.parse(
      JSON.parse(params.get("fieldFilters") ?? "[]"),
    );
  } catch {
    throw new HttpError(400, "Invalid task field filters.");
  }
  const include = z
    .array(z.uuid())
    .max(labLimits.columns)
    .parse((params.get("includeFields") ?? "").split(",").filter(Boolean));
  const sortField = params.get("sortField")
    ? z.uuid().parse(params.get("sortField"))
    : null;
  const direction = z
    .enum(["asc", "desc"])
    .parse(params.get("sortDirection") ?? "asc");
  return { filters, include: [...new Set(include)], sortField, direction };
}
export function validateFieldFilter(field: TaskField, filter: FieldFilter) {
  if (field.archived)
    throw new HttpError(
      409,
      `${field.name} is archived. Remove this filter or reopen the field.`,
    );
  try {
    validateFieldFilterValue(field, filter);
  } catch (e) {
    throw new HttpError(400, `${field.name}: ${(e as Error).message}`);
  }
}
/** Only validated IDs/operations choose SQL structure; all values remain bindings. */
export function fieldWhere(
  filters: FieldFilter[],
  definitions: TaskField[],
  args: unknown[],
  alias = "t",
) {
  const bind = (v: unknown) => {
    args.push(v);
    return `$${args.length}`;
  };
  return filters
    .map((filter) => {
      const field = definitions.find((f) => f.id === filter.fieldId);
      if (!field)
        throw new HttpError(
          409,
          "A saved field filter is unavailable. Remove it before continuing.",
        );
      validateFieldFilter(field, filter);
      const scope = `v.task_id=${alias}.id AND v.space_id=${alias}.space_id AND v.field_id=${bind(field.id)}::uuid`;
      const empty = `(v.value='null'::jsonb OR v.value='""'::jsonb OR v.value='[]'::jsonb)`;
      if (filter.op === "empty")
        return `NOT EXISTS(SELECT 1 FROM planning_field_values v WHERE ${scope} AND NOT ${empty})`;
      if (filter.op === "notEmpty")
        return `EXISTS(SELECT 1 FROM planning_field_values v WHERE ${scope} AND NOT ${empty})`;
      let match: string;
      if (filter.op === "contains")
        match = `v.text_value ILIKE ${bind("%" + String(filter.value).replace(/[\\%_]/g, "\\$&") + "%")}`;
      else if (filter.op === "in")
        match =
          field.kind === "multiselect"
            ? `v.value ?| ${bind(filter.value)}::text[]`
            : `v.text_value=ANY(${bind(filter.value)}::text[])`;
      else if (filter.op === "gte" || filter.op === "lte")
        match = `${field.kind === "number" ? "v.number_value" : "v.text_value"} ${filter.op === "gte" ? ">=" : "<="} ${bind(filter.value)}${field.kind === "number" ? "::numeric" : "::text"}`;
      else {
        const value = bind(JSON.stringify(filter.value));
        match =
          field.kind === "multiselect"
            ? `(v.value @> ${value}::jsonb AND v.value <@ ${value}::jsonb)`
            : `v.value=${value}::jsonb`;
      }
      return `EXISTS(SELECT 1 FROM planning_field_values v WHERE ${scope} AND ${match})`;
    })
    .map((s) => " AND " + s)
    .join("");
}
export async function fieldSummaries(
  db: PoolClient,
  space: string,
  ids: string[],
  fields: string[],
) {
  const map = new Map<
    string,
    Record<string, { value: FieldValue; truncated: boolean }>
  >();
  if (!ids.length || !fields.length) return map;
  const rows = (
    await db.query(
      "SELECT task_id,field_id,CASE WHEN jsonb_typeof(value)='string' AND length(text_value)>200 THEN to_jsonb(left(text_value,200)) WHEN jsonb_typeof(value)='array' THEN jsonb_path_query_array(value,'$[0 to 7]') ELSE value END AS value,CASE WHEN jsonb_typeof(value)='array' THEN jsonb_array_length(value)>8 ELSE coalesce(length(text_value),0)>200 END AS truncated FROM planning_field_values WHERE space_id=$1 AND task_id=ANY($2::uuid[]) AND field_id=ANY($3::uuid[])",
      [space, ids, fields],
    )
  ).rows;
  for (const row of rows) {
    const values = map.get(row.task_id) ?? {};
    values[row.field_id] = { value: row.value, truncated: row.truncated };
    map.set(row.task_id, values);
  }
  return map;
}
