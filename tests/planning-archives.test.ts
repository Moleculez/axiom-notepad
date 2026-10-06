import { describe, expect, it } from "vitest";
import {
  workspaceGoalLimit,
  goalQuerySchema,
  historyQuerySchema,
  occurrenceQuerySchema,
} from "../packages/shared/src/planning-archives";
import {
  archiveCursorLifetime,
  encodeArchiveCursor,
  parseGoalPageQuery,
  parseHistoryPageQuery,
  parseOccurrencePageQuery,
} from "../packages/shared/src/planning-archive-pagination";
import {
  integrationActions,
  integrationPath,
} from "../packages/shared/src/integration-catalog";

const space = "00000000-0000-4000-8000-000000000001",
  entity = "00000000-0000-4000-8000-000000000002",
  other = "00000000-0000-4000-8000-000000000003";
const now = Date.parse("2026-10-06T12:00:00Z");
const params = new URLSearchParams("q=100%25_%5C&sort=oldest&limit=15");
const parsers = {
  goals: (p: URLSearchParams, s = space, u = "owner", e = entity) => {
    void e;
    return parseGoalPageQuery(p, s, u, now);
  },
  history: (p: URLSearchParams, s = space, u = "owner", e = entity) =>
    parseHistoryPageQuery(p, s, u, e, now),
  occurrences: (p: URLSearchParams, s = space, u = "owner", e = entity) =>
    parseOccurrencePageQuery(p, s, u, e, now),
};
describe("planning archive contracts", () => {
  it("keeps the total goal cap, including archives, and bounds every page", () => {
    expect(workspaceGoalLimit).toBe(200);
    expect(goalQuerySchema.parse({})).toEqual({
      q: "",
      sort: "newest",
      limit: 30,
      filter: "active",
      mine: "0",
    });
    expect(historyQuerySchema.parse({})).toMatchObject({
      limit: 30,
      mine: "0",
    });
    expect(occurrenceQuerySchema.parse({})).toMatchObject({
      state: "all",
      limit: 30,
    });
    for (const schema of [
      goalQuerySchema,
      historyQuerySchema,
      occurrenceQuerySchema,
    ]) {
      expect(schema.parse({ q: "  100%_\\  ", limit: "100" })).toMatchObject({
        q: "100%_\\",
        limit: 100,
      });
      for (const input of [
        { limit: 0 },
        { limit: 101 },
        { limit: 1.5 },
        { limit: "NaN" },
        { sort: "SQL" },
        { q: "a".repeat(201) },
        { cursor: "" },
        { cursor: "a".repeat(1201) },
      ])
        expect(schema.safeParse(input).success).toBe(false);
    }
  });
  it("validates calendar ranges, availability, status and goal filters", () => {
    expect(goalQuerySchema.safeParse({ filter: "deleted" }).success).toBe(
      false,
    );
    expect(goalQuerySchema.safeParse({ kind: "secret" }).success).toBe(false);
    expect(goalQuerySchema.safeParse({ mine: "true" }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ mine: "true" }).success).toBe(false);
    for (const input of [
      { from: "2026-02-30" },
      { from: "2026-10-07", to: "2026-10-06" },
      { state: "lost" },
      { status: "secret" },
    ])
      expect(occurrenceQuerySchema.safeParse(input).success).toBe(false);
    expect(
      occurrenceQuerySchema.parse({
        from: "2026-10-06",
        to: "2026-10-06",
        state: "deleted",
      }),
    ).toMatchObject({ from: "2026-10-06", to: "2026-10-06" });
  });
  for (const [name, parse] of Object.entries(parsers)) {
    describe(name, () => {
      const position = {
        v: 1 as const,
        context: parse(params).context,
        asOf: "2026-10-06T11:59:59.123456Z",
        at:
          name === "occurrences" ? "2026-10-09" : "2026-10-06T11:55:23.123457Z",
        id: entity,
      };
      const query = (patch = {}) => {
        const p = new URLSearchParams(params);
        p.set("cursor", encodeArchiveCursor({ ...position, ...patch }));
        return p;
      };
      it("retains exact positions (including future scheduled occurrence dates)", () => {
        expect(parse(query()).cursor).toEqual(position);
        expect(
          parse(new URLSearchParams([...query()].reverse())).cursor,
        ).toEqual(position);
      });
      it.each(["space", "account", "sort", "q", "limit"])(
        "rejects a changed %s",
        (key) => {
          const p = query();
          if (key === "space")
            expect(() => parse(p, other)).toThrow("first page");
          else if (key === "account")
            expect(() => parse(p, space, "viewer")).toThrow("first page");
          else {
            p.set(
              key,
              key === "sort" ? "newest" : key === "limit" ? "30" : "another",
            );
            expect(() => parse(p)).toThrow("first page");
          }
        },
      );
      if (name !== "goals")
        it("binds the entity rather than reusing another archive position", () => {
          expect(() => parse(query(), space, "owner", other)).toThrow(
            "first page",
          );
        });
      it.each(["not-json", "eyJ2IjoxfQ", "a+b/c=", "<script>"])(
        "rejects malformed position %s",
        (cursor) => {
          const p = new URLSearchParams(params);
          p.set("cursor", cursor);
          expect(() => parse(p)).toThrow("first page");
        },
      );
      it("expires old/future ceilings and does not accept permission claims", () => {
        expect(() =>
          parse(
            query({
              asOf: new Date(now - archiveCursorLifetime - 1).toISOString(),
              at:
                name === "occurrences"
                  ? "2026-01-01"
                  : new Date(now - archiveCursorLifetime - 2).toISOString(),
            }),
          ),
        ).toThrow("first page");
        expect(() =>
          parse(query({ asOf: new Date(now + 10000).toISOString() })),
        ).toThrow("first page");
        const p = new URLSearchParams(params);
        p.set(
          "cursor",
          Buffer.from(
            JSON.stringify({ ...position, canManage: true }),
          ).toString("base64url"),
        );
        expect(() => parse(p)).toThrow("first page");
      });
      it("rejects the other position type", () => {
        expect(() =>
          parse(
            query({
              at:
                name === "occurrences" ? "2026-10-06T11:55:00Z" : "2026-10-06",
            }),
          ),
        ).toThrow("first page");
      });
      if (name !== "occurrences")
        it("rejects positions later than the ceiling by one microsecond", () => {
          expect(() =>
            parse(query({ at: "2026-10-06T11:59:59.123457Z" })),
          ).toThrow("first page");
        });
    });
  }
  it("binds all optional goal and occurrence filters", () => {
    for (const [parse, filters] of [
      [parsers.goals, { filter: "all", kind: "metric", mine: "1" }],
      [parsers.history, { mine: "1" }],
      [
        parsers.occurrences,
        {
          state: "active",
          status: "done",
          from: "2026-01-01",
          to: "2027-01-01",
        },
      ],
    ] as const) {
      const p = new URLSearchParams(params);
      p.set(
        "cursor",
        encodeArchiveCursor({
          v: 1,
          context: parse(params).context,
          asOf: "2026-10-06T11:59:59.123456Z",
          at:
            parse === parsers.occurrences
              ? "2026-10-09"
              : "2026-10-06T11:55:00Z",
          id: entity,
        }),
      );
      for (const [key, value] of Object.entries(filters)) {
        const changed = new URLSearchParams(p);
        changed.set(key, value);
        expect(() => parse(changed)).toThrow("first page");
      }
    }
  });
  it("keeps full bodies and generated history as explicit scope-checked connected reads", () => {
    for (const [name, path] of [
      ["workspace_goal_detail", `spaces/${space}/goals/${entity}`],
      [
        "workspace_planning_history",
        `spaces/${space}/planning-history/${entity}`,
      ],
      [
        "workspace_routine_occurrences",
        `spaces/${space}/recurrences/${entity}/occurrences`,
      ],
    ]) {
      const action = integrationActions.find((a) => a.name === name)!;
      expect(action.scope).toBe("workspace:read");
      expect(action.method).toBe("GET");
      expect(integrationPath(action, space, entity)).toBe(path);
    }
  });
});
