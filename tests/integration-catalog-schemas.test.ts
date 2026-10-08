import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

// Discovery must be safe in static builds/tests and must never seed OAuth or DB.
vi.mock("../packages/shared/src/db", () => {
  throw new Error("Catalog loaded the database.");
});
vi.mock("../packages/shared/src/auth", () => {
  throw new Error("Catalog loaded authentication.");
});
import {
  getIntegrationActionSchema,
  integrationActions,
} from "../packages/shared/src/integration-catalog";
import {
  integrationPayloadSchemas,
  integrationQuerySchemas,
} from "../packages/shared/src/integration-catalog-schemas";
import { taskInput, calendarSchema } from "../packages/shared/src/planning";
import {
  goalInputSchema,
  intakeInputSchema,
  planningBulkInputSchema,
} from "../packages/shared/src/planning-suite";
import { commentCreateSchema } from "../packages/shared/src/note-comments";
import { resourceAnchor } from "../packages/shared/src/resource-comments";
import {
  changeSetInput,
  orderedActions,
  resolveActionReferences,
} from "../packages/shared/src/productivity";

const spaceId = randomUUID(),
  id = randomUUID(),
  mutationId = randomUUID();
const revision = { version: 1, mutationId };
const milestone = { title: "Read literature" };
const transfer = {
  ...revision,
  destinationSpaceId: spaceId,
  parentId: null,
  confirmAudience: true,
};
const groupItems = { items: [{ id, version: 1 }], mutationId };
const payloads: Record<string, Record<string, unknown>> = {
  workspace_goal_create: {
    title: "Master vectors",
    kind: "linked",
    taskIds: [id],
  },
  workspace_goal_update: { version: 1, currentValue: 4 },
  workspace_intake_submit: { title: "Read paper", kind: "paper-review" },
  workspace_intake_update: { version: 1, title: "Read new paper" },
  workspace_intake_review: {
    version: 1,
    decision: "accepted",
    task: { assigneeId: null },
  },
  workspace_tasks_bulk: {
    items: [{ id, version: 1 }],
    patch: { status: "in_progress" },
  },
  workspace_routine_create: {
    rule: {
      frequency: "weekly",
      interval: 1,
      start: "2026-10-08",
      weekdays: [4],
    },
    template: { title: "Review notes" },
  },
  workspace_routine_update: { version: 1, enabled: false },
  workspace_planning_view_create: {
    name: "Study",
    state: { view: "board" },
    shared: false,
  },
  workspace_baseline_capture: { name: "Course start", version: 1 },
  group_portfolio_create: { name: "Courses", spaceIds: [spaceId], version: 0 },
  group_availability_update: {
    userId: "student",
    version: 0,
    settings: { weeklyHours: 20, workingDays: [1, 2, 3, 4, 5], exceptions: [] },
  },
  workspace_task_create: {
    title: "Read",
    dependencyLinks: [{ taskId: id, lagDays: -1 }],
    progressPercent: 50,
  },
  workspace_task_update: {
    version: 1,
    title: "Review",
    customFields: { [id]: null },
    fieldsVersion: 1,
  },
  workspace_milestone_create: milestone,
  workspace_discussion_create: { body: "Open question", taskId: id },
  workspace_schedule_preview: {
    changes: [{ id, version: 1, startOn: "2026-10-08", dueOn: "2026-10-09" }],
  },
  workspace_schedule_apply: { previewId: id, mode: "proposed" },
  workspace_schedule_undo: { previewId: id },
  workspace_calendar_update: { version: 1, calendar: { timezone: "UTC" } },
  file_create: {
    name: "Lesson 1",
    type: "markdown",
    source: "# Lesson",
    mutationId,
  },
  folder_create: { name: "Course", kind: "folder", mutationId },
  file_update: { ...revision, name: "Vectors", parentId: null, tags: ["math"] },
  file_favorite: { favorite: true },
  file_copy: transfer,
  file_transfer: transfer,
  file_trash: revision,
  file_restore: revision,
  file_purge: revision,
  note_checkpoint: { label: "Study checkpoint" },
  note_comment: {
    body: "Explain this",
    kind: "annotation",
    visibility: "private",
  },
  resource_comment: {
    body: "Review figure",
    anchor: { kind: "page", page: 3 },
    versionId: id,
  },
  studio_settings: { version: 1, settings: { color: "#112233" } },
  studio_checkpoint: { label: "Equation", source: "x^2", mutationId },
  task_create: {
    title: "Read",
    priority: "high",
    body: "Canonical native task body",
  },
  milestone_create: milestone,
  project_discussion_create: { body: "Question", mentions: ["student"] },
  project_review_create: { noteId: id, reviewerId: "student" },
  project_update: { version: 1, name: "Course", audience: "restricted" },
  project_members_update: { userId: "student", role: "viewer" },
  group_invite: {
    emails: ["student@example.test"],
    contentRole: "commenter",
    role: "member",
  },
  group_members_update: {
    items: [{ id: "student", version: 1 }],
    remove: true,
  },
  group_invitations_reissue: groupItems,
  group_invitations_revoke: groupItems,
  workspace_archive: revision,
  workspace_unarchive: revision,
  workspace_trash: revision,
  workspace_restore: revision,
  workspace_purge: { ...revision, confirmation: "Course" },
  workspace_update: { ...revision, name: "Course", description: "Research" },
};
const envelope = (name: string, payload?: Record<string, unknown>) => ({
  spaceId,
  ...(integrationActions.find((action) => action.name === name)!.target !==
    "workspace" ||
  integrationActions
    .find((action) => action.name === name)!
    .path.includes(":entity")
    ? { id }
    : {}),
  ...(payload ? { payload } : {}),
});

describe("operation-specific integration discovery", () => {
  it("covers all 98 legacy names explicitly and emits serializable input schemas", () => {
    expect(integrationActions).toHaveLength(98);
    expect(new Set(integrationActions.map((action) => action.name)).size).toBe(
      98,
    );
    expect(Object.keys(integrationPayloadSchemas).sort()).toEqual(
      integrationActions
        .filter((action) => action.method !== "GET")
        .map((action) => action.name)
        .sort(),
    );
    expect(Object.keys(integrationQuerySchemas).sort()).toEqual(
      integrationActions
        .filter((action) => action.method === "GET")
        .map((action) => action.name)
        .sort(),
    );
    for (const action of integrationActions) {
      expect(getIntegrationActionSchema(action.name)).toBe(action.inputSchema);
      const schema = z.toJSONSchema(action.inputSchema, { io: "input" });
      expect(schema.type, action.name).toBe("object");
      expect(schema.additionalProperties, action.name).toBe(false);
      expect(schema.properties?.spaceId, action.name).toMatchObject({
        type: "string",
        format: "uuid",
      });
      if (action.method !== "GET") {
        const payload = schema.properties!.payload;
        if (!payload || typeof payload === "boolean")
          throw new Error(`Missing payload object: ${action.name}`);
        expect(
          Object.keys(payload.properties ?? {}).length,
          action.name,
        ).toBeGreaterThan(0);
      }
    }
    expect(() => getIntegrationActionSchema("shell_execute")).toThrow(
      "Unknown",
    );
  });
  it("accepts an explicit native fixture for every existing mutation", () => {
    expect(Object.keys(payloads).sort()).toEqual(
      Object.keys(integrationPayloadSchemas).sort(),
    );
    for (const [name, payload] of Object.entries(payloads)) {
      const result = getIntegrationActionSchema(name).safeParse(
        envelope(name, payload),
      );
      expect(
        result.success,
        `${name}: ${result.success ? "" : result.error.message}`,
      ).toBe(true);
    }
  });
  it("accepts every read and preserves the common string-query envelope", () => {
    for (const action of integrationActions.filter(
      (item) => item.method === "GET",
    )) {
      const query =
        action.name === "workspace_evidence_read"
          ? { id, from: "0", to: "10", hash: "a".repeat(64) }
          : action.name === "workspace_planning_lookup"
            ? { kind: "file", ids: id }
            : {};
      expect(
        action.inputSchema.safeParse({ ...envelope(action.name), query })
          .success,
        action.name,
      ).toBe(true);
    }
    const value = getIntegrationActionSchema("files_list").parse({
      spaceId,
      query: {
        limit: "1e2",
        view: "trash",
        sort: "updated",
        spaceIds: id,
        futureNativeFilter: "value",
      },
    });
    expect(value.query).toMatchObject({
      limit: "1e2",
      futureNativeFilter: "value",
    });
    expect(value.payload).toEqual({});
    expect(
      getIntegrationActionSchema("workspace_planning").safeParse({
        spaceId,
        query: { limit: "5001" },
      }).success,
    ).toBe(false);
    expect(
      getIntegrationActionSchema("files_list").safeParse({
        spaceId,
        query: { limit: 10 },
      }).success,
    ).toBe(false);
  });
  it("rejects omitted target IDs, malformed IDs, unsupported enums, missing versions and unknown top-level fields", () => {
    for (const value of [
      { spaceId, payload: { name: "Note", type: "exe" } },
      {
        spaceId,
        payload: { name: "Note", type: "markdown", parentId: "not-a-uuid" },
      },
      { spaceId, payload: { name: "../Note", type: "markdown" } },
      { spaceId, payload: { name: "Note", type: "markdown" }, execute: true },
    ])
      expect(
        getIntegrationActionSchema("file_create").safeParse(value).success,
      ).toBe(false);
    expect(
      getIntegrationActionSchema("file_details").safeParse({ spaceId }).success,
    ).toBe(false);
    expect(
      getIntegrationActionSchema("workspace_task_update").safeParse({
        spaceId,
        id,
        payload: { status: "in_progress" },
      }).success,
    ).toBe(false);
    expect(
      getIntegrationActionSchema("workspace_task_create").safeParse({ spaceId })
        .success,
    ).toBe(false);
    expect(
      getIntegrationActionSchema("workspace_evidence_read").safeParse({
        spaceId,
        query: { id, from: "0", to: "10" },
      }).success,
    ).toBe(false);
  });
});

describe("native schema and reviewed-plan parity", () => {
  it("shares task, goal, intake, bulk, calendar, comment and resource-anchor validation", () => {
    const cases = [
      [
        "workspace_task_create",
        taskInput,
        { title: " Study ", labels: ["math"], progressPercent: 70 },
      ],
      [
        "workspace_goal_create",
        goalInputSchema,
        payloads.workspace_goal_create,
      ],
      [
        "workspace_intake_submit",
        intakeInputSchema,
        payloads.workspace_intake_submit,
      ],
      [
        "workspace_tasks_bulk",
        planningBulkInputSchema,
        payloads.workspace_tasks_bulk,
      ],
      ["note_comment", commentCreateSchema, payloads.note_comment],
    ] as const;
    for (const [name, native, raw] of cases) {
      const parsed = getIntegrationActionSchema(name).parse(
        envelope(name, raw),
      ).payload;
      expect(native.parse(parsed), name).toEqual(native.parse(raw));
    }
    const calendar = getIntegrationActionSchema(
      "workspace_calendar_update",
    ).parse(
      envelope("workspace_calendar_update", payloads.workspace_calendar_update),
    ).payload.calendar;
    expect(calendarSchema.parse(calendar)).toEqual(
      calendarSchema.parse({ timezone: "UTC" }),
    );
    expect(resourceAnchor.parse({ kind: "image", x: 0.5, y: 1 })).toEqual({
      kind: "image",
      x: 0.5,
      y: 1,
    });
    for (const labels of [[""], ["a".repeat(41)]])
      expect(
        getIntegrationActionSchema("workspace_task_create").safeParse({
          spaceId,
          payload: { title: "Study", labels },
        }).success,
      ).toBe(false);
  });
  it("keeps deferred dependency IDs valid until native validators see resolved UUIDs", () => {
    const prepared = changeSetInput.parse({
      mutationId,
      title: "Course",
      spaceIds: [spaceId],
      actions: [
        {
          key: "folder",
          action: "folder_create",
          spaceId,
          title: "Course",
          payload: { kind: "folder", name: "Course" },
        },
        {
          key: "note",
          action: "file_create",
          spaceId,
          title: "Lesson",
          payload: { type: "markdown", name: "Lesson", parentId: "@{folder}" },
        },
        {
          key: "task",
          action: "workspace_task_create",
          spaceId,
          title: "Study",
          payload: { title: "Read lesson", resourceIds: ["@{note}"] },
        },
      ],
    });
    expect(
      orderedActions(prepared.actions).map((action) => action.key),
    ).toEqual(["folder", "note", "task"]);
    for (const action of prepared.actions) {
      const resolved = resolveActionReferences(action.payload, {
        folder: id,
        note: mutationId,
      });
      expect(
        getIntegrationActionSchema(action.action).safeParse({
          spaceId,
          payload: resolved,
        }).success,
      ).toBe(true);
    }
    expect(
      getIntegrationActionSchema("file_create").safeParse({
        spaceId,
        payload: prepared.actions[1].payload,
      }).success,
    ).toBe(false);
  });
});
