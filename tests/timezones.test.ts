import { expect, it } from "vitest";
import {
  filterTimeZones,
  isTimeZone,
  timeZoneOffset,
  timeZoneOptions,
} from "@axiom/shared/timezones";
it("offers runtime IANA zones, UTC and accepted aliases without duplicates", () => {
  const zones = timeZoneOptions("US/Eastern");
  expect(zones).toContain("UTC");
  expect(zones).toContain("Asia/Shanghai");
  expect(zones).toContain("US/Eastern");
  expect(zones.length).toBeGreaterThan(300);
  expect(new Set(zones).size).toBe(zones.length);
});
it("searches cities, regions and multiword zone identifiers", () => {
  const zones = timeZoneOptions();
  expect(filterTimeZones(zones, "new york")).toContain("America/New_York");
  expect(filterTimeZones(zones, "kolkata")).toContain("Asia/Kolkata");
  expect(filterTimeZones(zones, "america / los_angeles")).toEqual([
    "America/Los_Angeles",
  ]);
  expect(filterTimeZones(zones, "nonexistent")).toEqual([]);
});
it("validates typed values and reports date-sensitive UTC offsets", () => {
  expect(isTimeZone("Asia/Shanghai")).toBe(true);
  expect(isTimeZone("Not/AZone")).toBe(false);
  expect(isTimeZone(" UTC ")).toBe(false);
  expect(timeZoneOffset("Asia/Shanghai", new Date("2026-01-01"))).toBe("UTC+8");
  expect(timeZoneOffset("America/New_York", new Date("2026-01-01"))).toBe(
    "UTC-5",
  );
  expect(timeZoneOffset("America/New_York", new Date("2026-07-01"))).toBe(
    "UTC-4",
  );
});
