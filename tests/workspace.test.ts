import { describe, expect, it } from "vitest";
import { dateOnlySchema, recurrenceOccursOn, recurrenceSchema, resourceNameSchema, roleAllows, profileSchema, MAX_FILE_BYTES, UPLOAD_CHUNK_BYTES } from "../packages/shared/src/workspace";
import { parseByteRange } from "../packages/shared/src/storage-streams";

describe("workspace boundaries", () => {
  it("separates read, comment and edit capabilities", () => {
    expect(roleAllows(null, "read")).toBe(false);
    expect(roleAllows("viewer", "read")).toBe(true);
    expect(roleAllows("viewer", "comment")).toBe(false);
    expect(roleAllows("commenter", "comment")).toBe(true);
    expect(roleAllows("commenter", "edit")).toBe(false);
    expect(roleAllows("editor", "edit")).toBe(true);
  });
  it.each(["", ".", "..", "bad/name", "bad\\name", "line\nname", "nul\0name"])("rejects unsafe resource name %j", name => expect(resourceNameSchema.safeParse(name).success).toBe(false));
  it("allows scientific and international names", () => expect(resourceNameSchema.parse("  Schrödinger 方程 — α  ")).toBe("Schrödinger 方程 — α"));
  it("validates calendar dates without accepting rollover", () => {
    expect(dateOnlySchema.safeParse("2026-02-29").success).toBe(false);
    expect(dateOnlySchema.safeParse("2028-02-29").success).toBe(true);
  });
  it("never treats a profile link as executable markup", () => expect(profileSchema.safeParse({ name: "Ada", links: ["javascript:alert(1)"] }).success).toBe(false));
  it("bounds each upload independently of file size", () => expect(Math.ceil(MAX_FILE_BYTES / UPLOAD_CHUNK_BYTES)).toBe(120));
});
describe("calendar recurrence", () => {
  it("handles intervals and finite end dates", () => {
    const rule = recurrenceSchema.parse({ frequency: "daily", start: "2026-09-01", interval: 2, until: "2026-09-05" });
    expect(recurrenceOccursOn(rule, "2026-09-03")).toBe(true);
    expect(recurrenceOccursOn(rule, "2026-09-04")).toBe(false);
    expect(recurrenceOccursOn(rule, "2026-09-07")).toBe(false);
  });
  it("uses calendar weeks and selected weekdays", () => {
    const rule = recurrenceSchema.parse({ frequency: "weekly", start: "2026-09-01", weekdays: [1, 3], interval: 2 });
    expect(recurrenceOccursOn(rule, "2026-09-02")).toBe(true);
    expect(recurrenceOccursOn(rule, "2026-09-09")).toBe(false);
    expect(recurrenceOccursOn(rule, "2026-09-14")).toBe(true);
  });
  it("clamps monthly occurrences to the end of short months", () => {
    const rule = recurrenceSchema.parse({ frequency: "monthly", start: "2028-01-31" });
    expect(recurrenceOccursOn(rule, "2028-02-29")).toBe(true);
    expect(recurrenceOccursOn(rule, "2028-03-31")).toBe(true);
    expect(recurrenceOccursOn(rule, "2028-03-29")).toBe(false);
  });
});
describe("protected range downloads", () => {
  it.each([
    [null, 100, null], ["bytes=0-9", 100, { start: 0, end: 9 }],
    ["bytes=90-", 100, { start: 90, end: 99 }], ["bytes=-10", 100, { start: 90, end: 99 }],
    ["bytes=1-999", 100, { start: 1, end: 99 }], ["bytes=-1000", 100, { start: 0, end: 99 }],
    ["bytes=100-", 100, "invalid"], ["bytes=9-2", 100, "invalid"],
    ["bytes=-0", 100, "invalid"], ["bytes=0-1,4-5", 100, "invalid"],
    ["bytes=0-", 0, "invalid"], ["bytes=9007199254740993-", 100, "invalid"],
  ] as const)("handles %s for %i bytes", (header, bytes, result) => expect(parseByteRange(header, bytes)).toEqual(result));
});
