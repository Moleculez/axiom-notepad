"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import {
  fieldDisplay,
  parseFieldValue,
  parseNumberFieldDraft,
  fieldInputSchema,
  fieldKinds,
  type TaskField,
  type FieldValue,
  type FieldDefinitions,
  type FieldFilter,
  fieldFiltersSchema,
  fieldPresets,
  validateFieldFilterValue,
} from "@axiom/shared/planning-lab";
import Dialog, { DialogBody, DialogFooter } from "../Dialog";
import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  HelpText,
  IconButton,
  NativeSelect,
  Picker,
  TextInput,
} from "../ui/controls";
import DraftGuard from "./DraftGuard";
import { errorMessage } from "../../lib/client";
import {
  useAction,
  useData,
  useWorkspace,
  ErrorNotice,
  Loading,
  Empty,
  mutate,
} from "./ui";
import { closePlanningDraft, PersonPicker } from "./PlanningFields";
import type { Space } from "@axiom/shared/workspace";

export function TaskFieldInput({
  field,
  value,
  onChange,
  people = [],
  disabled = false,
  onValidity,
}: {
  field: TaskField;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  people?: Array<{ id: string; name: string }>;
  disabled?: boolean;
  onValidity?: (valid: boolean) => void;
}) {
  const id = useId();
  const [numberDraft, setNumberDraft] = useState(() => ({
    fieldId: field.id,
    value,
    text: value == null ? "" : String(value),
  }));
  let error = "";
  try {
    if (value !== undefined && value !== null) parseFieldValue(field, value);
  } catch (e) {
    error = errorMessage(e);
  }
  const validity = useRef(onValidity);
  validity.current = onValidity;
  useEffect(() => {
    validity.current?.(!error);
  }, [error]);
  useEffect(() => () => validity.current?.(true), []);
  const change = (raw: string) => {
    const next =
      field.kind === "number"
        ? parseNumberFieldDraft(raw)
        : raw === ""
          ? null
          : raw;
    if (field.kind === "number")
      setNumberDraft({ fieldId: field.id, value: next, text: raw });
    onChange(next);
  };
  const options = field.options
    .filter((o) => !o.archived)
    .map((o) => ({ value: o.id, label: o.label }));
  return (
    <Field
      className="planning-custom-control"
      id={id}
      label={field.name}
      error={error}
      action={
        <IconButton
          type="button"
          label={`Clear ${field.name}`}
          disabled={disabled || value == null}
          onClick={() => {
            onChange(null);
            document.getElementById(id)?.focus();
          }}
        >
          <X size={14} />
        </IconButton>
      }
      hint={
        field.kind === "number" && field.unit
          ? `Unit: ${field.unit}`
          : field.kind === "checkbox"
            ? value == null
              ? "Not set"
              : value
                ? "Yes"
                : "No"
            : undefined
      }
    >
      {field.kind === "checkbox" ? (
        <Checkbox
          id={id}
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      ) : field.kind === "person" ? (
        <PersonPicker
          people={people}
          value={String(value ?? "")}
          label={field.name}
          disabled={disabled}
          onChange={(v) => onChange(v || null)}
        />
      ) : field.kind === "select" || field.kind === "multiselect" ? (
        <Picker
          label={field.name}
          options={options}
          selectedOptions={field.options.map((o) => ({
            value: o.id,
            label: o.label + (o.archived ? " (archived)" : ""),
          }))}
          value={
            value == null
              ? field.kind === "multiselect"
                ? []
                : ""
              : (value as string | string[])
          }
          multiple={field.kind === "multiselect"}
          disabled={disabled}
          onChange={(v) => onChange(typeof v === "string" && !v ? null : v)}
        />
      ) : (
        <TextInput
          id={id}
          aria-label={field.name}
          aria-invalid={!!error}
          type={
            field.kind === "date"
              ? "date"
              : field.kind === "url"
                ? "url"
                : "text"
          }
          inputMode={field.kind === "number" ? "decimal" : undefined}
          maxLength={2000}
          disabled={disabled}
          value={
            field.kind === "number" &&
            numberDraft.fieldId === field.id &&
            Object.is(numberDraft.value, value)
              ? numberDraft.text
              : value == null
                ? ""
                : String(value)
          }
          onChange={(e) => change(e.target.value)}
        />
      )}
    </Field>
  );
}
export function TaskCustomFields({
  spaceId,
  values,
  patch,
  onChange,
  onValidity,
  people,
}: {
  spaceId: string;
  values: Record<string, FieldValue>;
  patch: Record<string, FieldValue>;
  onChange: (patch: Record<string, FieldValue>, revision: number) => void;
  onValidity: (valid: boolean) => void;
  people: Array<{ id: string; name: string }>;
}) {
  const { revision } = useWorkspace(),
    data = useData<FieldDefinitions>(
      `spaces/${spaceId}/planning-fields`,
      revision,
    );
  const valid = Object.entries(patch).every(([id, value]) => {
    const f = data.data?.items.find((f) => f.id === id && !f.archived);
    if (!f) return false;
    try {
      parseFieldValue(f, value);
      return true;
    } catch {
      return false;
    }
  });
  const validity = useRef(onValidity);
  validity.current = onValidity;
  useEffect(() => validity.current(valid), [valid]);
  if (!data.data)
    return <ErrorNotice message={data.error} retry={data.reload} />;
  const fields = data.data.items.filter((f) => !f.archived),
    archived = data.data.items.filter(
      (f) => f.archived && values[f.id] != null,
    );
  if (!fields.length && !archived.length) return null;
  return (
    <section className="planning-custom-fields">
      <h3>Research properties</h3>
      <ErrorNotice message={data.error} retry={data.reload} />
      <div className="planning-field-grid">
        {fields.map((f) => (
          <TaskFieldInput
            key={f.id}
            field={f}
            people={people}
            value={Object.hasOwn(patch, f.id) ? patch[f.id] : values[f.id]}
            onChange={(v) =>
              onChange({ ...patch, [f.id]: v }, data.data!.version)
            }
          />
        ))}
      </div>
      {archived.length > 0 && (
        <details>
          <summary>Archived properties · {archived.length}</summary>
          <dl>
            {archived.map((f) => (
              <div key={f.id}>
                <dt>{f.name}</dt>
                <dd>{fieldDisplay(f, values[f.id], people)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}
export function PlanningPropertyView({
  spaceId,
  params,
  change,
  people,
}: {
  spaceId: string;
  params: URLSearchParams;
  change: (v: Record<string, string | null>) => void;
  people: Array<{ id: string; name: string }>;
}) {
  const { revision } = useWorkspace(),
    data = useData<FieldDefinitions>(
      `spaces/${spaceId}/planning-fields`,
      revision,
    ),
    [open, setOpen] = useState(false);
  return (
    <>
      <Button size="compact" onClick={() => setOpen(true)}>
        <SlidersHorizontal size={14} />
        Properties
      </Button>
      {open && (
        <PropertyViewEditor
          definitions={data.data ?? undefined}
          error={data.error}
          retry={data.reload}
          params={params}
          people={people}
          onClose={() => setOpen(false)}
          onApply={(v) => {
            change(v);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
function PropertyViewEditor({
  definitions,
  error,
  retry,
  params,
  people,
  onClose,
  onApply,
}: {
  definitions?: FieldDefinitions;
  error: string;
  retry: () => void;
  params: URLSearchParams;
  people: Array<{ id: string; name: string }>;
  onClose: () => void;
  onApply: (v: Record<string, string | null>) => void;
}) {
  const [filterSource] = useState(() => {
      try {
        return {
          items: fieldFiltersSchema.parse(
            JSON.parse(params.get("fieldFilters") ?? "[]"),
          ),
          error: "",
        };
      } catch (error) {
        return {
          items: [] as FieldFilter[],
          error: `Saved conditions are invalid: ${errorMessage(error)} Use Reset to explicitly remove them.`,
        };
      }
    }),
    [filters, setFilters] = useState(filterSource.items),
    [sourceError, setSourceError] = useState(filterSource.error),
    [columns, setColumns] = useState(
      (params.get("includeFields") ?? "").split(",").filter(Boolean),
    ),
    [sort, setSort] = useState(params.get("sortField") ?? ""),
    [direction, setDirection] = useState(params.get("sortDirection") ?? "asc");
  const fields = definitions?.items ?? [],
    active = fields.filter((f) => !f.archived);
  let viewError = "";
  if (definitions) {
    try {
      if (sourceError) throw new Error(sourceError);
      if (columns.length > 8)
        throw new Error("Choose at most eight displayed properties.");
      if (columns.some((id) => !fields.some((f) => f.id === id)))
        throw new Error(
          "A displayed property is unavailable. Remove it from the selected columns.",
        );
      if (sort && !active.some((f) => f.id === sort))
        throw new Error(
          "The sort property is archived or unavailable. Choose another sort order.",
        );
      for (const [index, filter] of fieldFiltersSchema
        .parse(filters)
        .entries()) {
        const field = fields.find((f) => f.id === filter.fieldId);
        if (!field)
          throw new Error(
            `Condition ${index + 1}: this property is unavailable. Remove it before continuing.`,
          );
        try {
          validateFieldFilterValue(field, filter);
        } catch (error) {
          throw new Error(`Condition ${index + 1}: ${errorMessage(error)}`);
        }
      }
    } catch (error) {
      viewError = errorMessage(error);
    }
  }
  const setFilter = (i: number, p: Partial<FieldFilter>) =>
    setFilters((old) => old.map((v, n) => (n === i ? { ...v, ...p } : v)));
  return (
    <Dialog title="Task properties and filters" onClose={onClose}>
      <DialogBody>
        <ErrorNotice message={error} retry={retry} />
        {!definitions ? (
          <Loading />
        ) : (
          <>
            <Field
              label="Displayed columns"
              hint="Up to eight in List and Gantt; only selected values are loaded."
            >
              <Picker
                label="Property columns"
                multiple
                value={columns}
                options={fields.map((f) => ({
                  value: f.id,
                  label: f.name + (f.archived ? " (archived)" : ""),
                }))}
                onChange={(v) => setColumns(v as string[])}
              />
            </Field>
            <div className="planning-field-grid">
              <Field label="Sort by property">
                <NativeSelect
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="">Standard task order</option>
                  {sort && !active.some((f) => f.id === sort) && (
                    <option value={sort} disabled>
                      {fields.find((f) => f.id === sort)?.name ??
                        "Unavailable property"}{" "}
                      (unavailable)
                    </option>
                  )}
                  {active.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Direction">
                <NativeSelect
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </NativeSelect>
              </Field>
            </div>
            <h3>All conditions must match</h3>
            {filters.map((c, i) => {
              const field = fields.find((f) => f.id === c.fieldId),
                ops = !field
                  ? ["empty"]
                  : [
                      "empty",
                      "notEmpty",
                      "eq",
                      ...(["text", "url"].includes(field.kind)
                        ? ["contains"]
                        : []),
                      ...(["number", "date"].includes(field.kind)
                        ? ["gte", "lte"]
                        : []),
                      ...(["select", "multiselect"].includes(field.kind)
                        ? ["in"]
                        : []),
                    ];
              return (
                <ActionRow
                  className="planning-rule-clause"
                  size="standard"
                  key={i}
                >
                  <Field
                    label={`Property ${i + 1}`}
                    action={
                      <IconButton
                        type="button"
                        label={`Remove property filter ${i + 1}`}
                        onClick={() =>
                          setFilters(filters.filter((_, n) => n !== i))
                        }
                      >
                        <X size={14} />
                      </IconButton>
                    }
                  >
                    <NativeSelect
                      value={c.fieldId}
                      onChange={(e) =>
                        setFilter(i, {
                          fieldId: e.target.value,
                          op: "empty",
                          value: undefined,
                        })
                      }
                    >
                      {!field && (
                        <option value={c.fieldId} disabled>
                          Unavailable property
                        </option>
                      )}
                      {fields.map((f) => (
                        <option key={f.id} value={f.id} disabled={f.archived}>
                          {f.name}
                          {f.archived ? " (archived)" : ""}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label="Condition">
                    <NativeSelect
                      value={c.op}
                      onChange={(e) =>
                        setFilter(i, {
                          op: e.target.value as FieldFilter["op"],
                          value: undefined,
                        })
                      }
                    >
                      {ops.map((op) => (
                        <option key={op} value={op}>
                          {
                            (
                              {
                                eq: "Equals",
                                in: "Any of",
                                contains: "Contains",
                                gte: "At least",
                                lte: "At most",
                                empty: "Not set",
                                notEmpty: "Has value",
                              } as Record<string, string>
                            )[op]
                          }
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  {field && !["empty", "notEmpty"].includes(c.op) && (
                    <TaskFieldInput
                      field={
                        c.op === "contains"
                          ? { ...field, kind: "text" }
                          : c.op === "in"
                            ? { ...field, kind: "multiselect" }
                            : field
                      }
                      value={c.value}
                      people={people}
                      onChange={(value) => setFilter(i, { value })}
                    />
                  )}
                  {(!field || field.archived) && (
                    <HelpText>
                      This property is unavailable or archived. Remove the
                      filter or reopen the field; it will not be silently
                      ignored.
                    </HelpText>
                  )}
                </ActionRow>
              );
            })}
            <Button
              type="button"
              size="compact"
              disabled={filters.length >= 8 || !active.length}
              onClick={() =>
                setFilters([...filters, { fieldId: active[0].id, op: "empty" }])
              }
            >
              <Plus size={14} />
              Add condition
            </Button>
            <HelpText>
              Filters are ANDed. Saved views retain these conditions and
              columns.
            </HelpText>
            <ErrorNotice message={viewError} />
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button
          onClick={() => {
            setFilters([]);
            setSourceError("");
            setColumns([]);
            setSort("");
          }}
        >
          Reset
        </Button>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!definitions || !!viewError}
          onClick={() =>
            onApply({
              includeFields: columns.join(",") || null,
              fieldFilters: filters.length ? JSON.stringify(filters) : null,
              sortField: sort || null,
              sortDirection: sort ? direction : null,
            })
          }
        >
          Apply view
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
export function PlanningFieldSettings({ space }: { space: Space }) {
  const { revision } = useWorkspace(),
    data = useData<FieldDefinitions>(
      `spaces/${space.id}/planning-fields`,
      revision,
    ),
    [editing, setEditing] = useState<TaskField | "new" | null>(null),
    [preset, setPreset] = useState<keyof typeof fieldPresets | null>(null);
  return (
    <section className="planning-lab-settings">
      <ActionRow align="between">
        <div>
          <h2>Task fields</h2>
          <HelpText>
            Typed properties for research tasks. Archiving preserves existing
            values.
          </HelpText>
        </div>
        <ActionRow>
          <NativeSelect
            aria-label="Review field preset"
            value=""
            disabled={
              !space.can_manage ||
              space.effective_status !== "active" ||
              !data.data
            }
            onChange={(e) => {
              if (e.target.value)
                setPreset(e.target.value as keyof typeof fieldPresets);
            }}
          >
            <option value="">Add preset…</option>
            <option value="experiment">Experiment</option>
            <option value="paperReview">Paper review</option>
          </NativeSelect>
          <Button
            disabled={
              !space.can_manage ||
              space.effective_status !== "active" ||
              !data.data
            }
            onClick={() => setEditing("new")}
          >
            <Plus size={15} />
            New field
          </Button>
        </ActionRow>
      </ActionRow>
      <ErrorNotice message={data.error} retry={data.reload} />
      {!data.data ? (
        <Loading />
      ) : !data.data.items.length ? (
        <Empty title="No custom fields">
          Add the properties your research workflow needs.
        </Empty>
      ) : (
        <div className="planning-lab-list">
          {data.data.items.map((f) => (
            <div className="planning-lab-row" key={f.id}>
              <Button variant="ghost" onClick={() => setEditing(f)}>
                {f.name}
              </Button>
              <HelpText>
                {f.kind}
                {f.unit ? ` · ${f.unit}` : ""}
                {f.archived ? " · Archived" : ""}
              </HelpText>
            </div>
          ))}
        </div>
      )}
      {editing && data.data && (
        <FieldEditor
          key={editing === "new" ? "new" : editing.id}
          space={space}
          definitions={data.data}
          value={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {preset && data.data && (
        <FieldPresetDialog
          spaceId={space.id}
          preset={preset}
          version={data.data.version}
          onClose={() => setPreset(null)}
        />
      )}
    </section>
  );
}
function FieldPresetDialog({
  spaceId,
  preset,
  version,
  onClose,
}: {
  spaceId: string;
  preset: keyof typeof fieldPresets;
  version: number;
  onClose: () => void;
}) {
  const { refresh, notify } = useWorkspace(),
    action = useAction(),
    [fieldsVersion] = useState(version);
  return (
    <Dialog
      title={`Review ${preset === "experiment" ? "Experiment" : "Paper review"} fields`}
      onClose={() => {
        if (!action.busy) onClose();
      }}
    >
      <DialogBody>
        <ErrorNotice message={action.error} />
        <HelpText>
          This creates five new fields, not a template applied to existing
          values. Conflicting names block the whole preset.
        </HelpText>
        <dl>
          {fieldPresets[preset].map((f) => (
            <div key={f.name}>
              <dt>{f.name}</dt>
              <dd>
                {f.kind}
                {"unit" in f ? ` · ${f.unit}` : ""}
                {"choices" in f ? ` · ${f.choices?.join(", ")}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      </DialogBody>
      <DialogFooter>
        <Button disabled={action.busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          pending={action.busy}
          onClick={() =>
            void action.run(async () => {
              await mutate(`spaces/${spaceId}/planning-fields/presets`, {
                preset,
                fieldsVersion,
              });
              refresh();
              notify("Preset fields created.");
              onClose();
            })
          }
        >
          Create reviewed fields
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
function FieldEditor({
  space,
  definitions,
  value,
  onClose,
}: {
  space: Space;
  definitions: FieldDefinitions;
  value?: TaskField;
  onClose: () => void;
}) {
  const { refresh, notify } = useWorkspace(),
    action = useAction(),
    [initial] = useState(() =>
      value
        ? fieldInputSchema.parse(value)
        : {
            name: "",
            kind: "text" as const,
            unit: "",
            options: [] as TaskField["options"],
            archived: false,
            position: 0,
          },
    ),
    [draft, setDraft] =
      useState<ReturnType<typeof fieldInputSchema.parse>>(initial),
    [fieldsVersion] = useState(definitions.version);
  const validation = fieldInputSchema.safeParse(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial),
    valid = validation.success,
    close = () =>
      closePlanningDraft(dirty, action.busy, onClose, "Unsaved task field"),
    editable = space.can_manage && space.effective_status === "active";
  return (
    <Dialog
      title={value ? "Edit task field" : "New task field"}
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!editable || !valid || action.busy || (value && !dirty)) return;
          void action.run(async () => {
            await mutate(
              `spaces/${space.id}/planning-fields${value ? "/" + value.id : ""}`,
              {
                ...draft,
                version: value?.version,
                fieldsVersion,
              },
              value ? "PATCH" : "POST",
            );
            refresh();
            notify("Task field saved.");
            onClose();
          });
        }}
      >
        <DialogBody>
          <DraftGuard dirty={dirty} title="Unsaved task field" />
          <ErrorNotice message={action.error} />
          <fieldset
            disabled={!editable || action.busy}
            className="planning-suite-form"
          >
            <Field label="Name">
              <TextInput
                required
                maxLength={120}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field
              label="Type"
              hint={
                value
                  ? "Types are immutable; create a new field to change type."
                  : undefined
              }
            >
              <NativeSelect
                disabled={!!value}
                value={draft.kind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    kind: e.target.value as TaskField["kind"],
                    options: ["select", "multiselect"].includes(e.target.value)
                      ? [
                          {
                            id: crypto.randomUUID(),
                            label: "Option 1",
                            archived: false,
                          },
                        ]
                      : [],
                  })
                }
              >
                {fieldKinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </NativeSelect>
            </Field>
            {draft.kind === "number" && (
              <Field label="Unit">
                <TextInput
                  maxLength={40}
                  value={draft.unit}
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                />
              </Field>
            )}
            {["select", "multiselect"].includes(draft.kind) && (
              <section>
                <h3>Choices</h3>
                {draft.options.map((o) => (
                  <div className="planning-choice-row" key={o.id}>
                    <TextInput
                      aria-label="Choice label"
                      required
                      maxLength={100}
                      value={o.label}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          options: draft.options.map((x) =>
                            x.id === o.id ? { ...x, label: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <label className="planning-check-label">
                      <Checkbox
                        checked={o.archived}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            options: draft.options.map((x) =>
                              x.id === o.id
                                ? { ...x, archived: e.target.checked }
                                : x,
                            ),
                          })
                        }
                      />
                      Archived
                    </label>
                    <IconButton
                      type="button"
                      label="Remove choice"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          options: draft.options.filter((x) => x.id !== o.id),
                        })
                      }
                    >
                      <X size={14} />
                    </IconButton>
                  </div>
                ))}
                <Button
                  type="button"
                  size="compact"
                  disabled={draft.options.length >= 50}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      options: [
                        ...draft.options,
                        { id: crypto.randomUUID(), label: "", archived: false },
                      ],
                    })
                  }
                >
                  <Plus size={14} />
                  Add choice
                </Button>
              </section>
            )}
            <label className="planning-check-label">
              <Checkbox
                checked={draft.archived}
                onChange={(e) =>
                  setDraft({ ...draft, archived: e.target.checked })
                }
              />
              Archive field
            </label>
            {dirty && !validation.success && (
              <ErrorNotice message={errorMessage(validation.error)} />
            )}
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={close} disabled={action.busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            pending={action.busy}
            disabled={!editable || !valid || (!!value && !dirty)}
          >
            Save field
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
