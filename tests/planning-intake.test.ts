import { describe, expect, it } from "vitest";
import {
  intakeQuerySchema,
  intakeStatuses,
} from "../packages/shared/src/planning-intake";
import {
  encodeIntakeCursor,
  intakeCursorContext,
  intakeCursorLifetime,
  intakeFilterStatuses,
  parseIntakePageQuery,
} from "../packages/shared/src/planning-intake-pagination";
import {
  integrationActions,
  integrationPath,
} from "../packages/shared/src/integration-catalog";
const space = "00000000-0000-4000-8000-000000000001",
  id = "00000000-0000-4000-8000-000000000002";
const now = Date.parse("2026-10-04T12:00:00Z");
const params = new URLSearchParams(
  "filter=open&q=evidence&kind=research&mine=1&sort=oldest&limit=15",
);
const parsed = parseIntakePageQuery(params, space, "owner", now);
const position = {
  v: 1 as const,
  context: parsed.context,
  asOf: "2026-10-04T11:59:59.123456Z",
  at: "2026-10-04T11:55:23.123457Z",
  id,
};
describe("research intake page contract", () => {
  it("bounds pages and normalizes a literal search without interpreting it", () => {
    expect(intakeQuerySchema.parse({})).toMatchObject({
      filter: "all",
      limit: 30,
      mine: "0",
      sort: "newest",
    });
    expect(
      intakeQuerySchema.parse({ q: "  100%_\\  ", limit: "100" }),
    ).toMatchObject({ q: "100%_\\", limit: 100 });
  });
  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: -1 },
    { limit: 1.5 },
    { limit: "NaN" },
    { sort: "SQL" },
    { filter: "missing" },
    { kind: "secret" },
    { mine: "true" },
    { q: "a".repeat(201) },
    { cursor: "" },
    { cursor: "a".repeat(1201) },
  ])("rejects unbounded or ambiguous query %j", (input) => {
    expect(intakeQuerySchema.safeParse(input).success).toBe(false);
  });
  it("groups only actual closed decisions and leaves requested changes open", () => {
    expect(intakeFilterStatuses("open")).toEqual(["pending", "needs-changes"]);
    expect(intakeFilterStatuses("history")).toEqual([
      "accepted",
      "rejected",
      "withdrawn",
    ]);
    expect(intakeFilterStatuses("all")).toBeNull();
    for (const status of intakeStatuses)
      expect(intakeFilterStatuses(status)).toEqual([status]);
  });
  it("round-trips exact PostgreSQL microseconds and never uses millisecond Dates as positions", () => {
    const query = new URLSearchParams(params);
    query.set("cursor", encodeIntakeCursor(position));
    expect(parseIntakePageQuery(query, space, "owner", now).cursor).toEqual(
      position,
    );
    expect(encodeIntakeCursor(position)).not.toEqual(
      encodeIntakeCursor({ ...position, at: "2026-10-04T11:55:23.123456Z" }),
    );
  });
  it("binds positions to account, workspace and every result-affecting filter", () => {
    const query = new URLSearchParams(params);
    query.set("cursor", encodeIntakeCursor(position));
    expect(() => parseIntakePageQuery(query, id, "owner", now)).toThrow(
      "filters changed",
    );
    expect(() =>
      parseIntakePageQuery(query, space, "another-member", now),
    ).toThrow("filters changed");
    for (const [key, value] of Object.entries({
      q: "other",
      filter: "all",
      kind: "experiment",
      mine: "0",
      sort: "newest",
      limit: "30",
    })) {
      const changed = new URLSearchParams(query);
      changed.set(key, value);
      expect(() => parseIntakePageQuery(changed, space, "owner", now)).toThrow(
        "filters changed",
      );
    }
  });
  it("does not bind a position to incidental query parameter order", () => {
    const reversed = Object.fromEntries([...params].reverse());
    expect(
      intakeCursorContext(intakeQuerySchema.parse(reversed), space, "owner"),
    ).toBe(parsed.context);
  });
  it.each(["not-json", "eyJ2IjoxfQ", "a+b/c=", "<script>"])(
    "rejects malformed cursor %s",
    (cursor) => {
      const query = new URLSearchParams(params);
      query.set("cursor", cursor);
      expect(() => parseIntakePageQuery(query, space, "owner", now)).toThrow(
        "first page",
      );
    },
  );
  it("expires old or future snapshots, and rejects impossible positions", () => {
    for (const invalid of [
      {
        ...position,
        asOf: new Date(now - intakeCursorLifetime - 1).toISOString(),
        at: new Date(now - intakeCursorLifetime - 2).toISOString(),
      },
      { ...position, asOf: new Date(now + 10000).toISOString() },
      { ...position, at: new Date(now + 10000).toISOString() },
    ]) {
      const query = new URLSearchParams(params);
      query.set("cursor", encodeIntakeCursor(invalid));
      expect(() => parseIntakePageQuery(query, space, "owner", now)).toThrow(
        "first page",
      );
    }
  });
  it("rejects extra cursor claims rather than treating them as access authority", () => {
    const query = new URLSearchParams(params);
    query.set(
      "cursor",
      Buffer.from(JSON.stringify({ ...position, canReview: true })).toString(
        "base64url",
      ),
    );
    expect(() => parseIntakePageQuery(query, space, "owner", now)).toThrow(
      "first page",
    );
  });
  it("makes full bodies an explicit scoped read in the connected tool catalog", () => {
    const action = integrationActions.find(
      (a) => a.name === "workspace_intake_detail",
    )!;
    expect(action.scope).toBe("workspace:read");
    expect(action.method).toBe("GET");
    expect(integrationPath(action, space, id)).toBe(
      `spaces/${space}/intake/${id}`,
    );
  });
});
