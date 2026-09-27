import { expect, test } from "vitest";
import { clampPanelWidth, storedPanelWidth } from "../apps/web/lib/panel-width";

test("panel sizing stays inside the available desktop bounds", () => {
  expect(clampPanelWidth(90, 220, 480)).toBe(220);
  expect(clampPanelWidth(900, 220, 480)).toBe(480);
  expect(clampPanelWidth(320.6, 220, 480)).toBe(321);
});
test.each([null, "", "broken", "NaN", "Infinity", "-1", "999999"])(
  "invalid saved width %s uses the safe default",
  (value) => {
    expect(storedPanelWidth(value, 248, 220, 420)).toBe(248);
  },
);
test("valid stored width survives reload", () => {
  expect(storedPanelWidth("330", 248, 220, 420)).toBe(330);
});
