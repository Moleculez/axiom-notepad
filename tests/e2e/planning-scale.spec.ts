import { test, expect } from "@playwright/test";
import { signInOwner } from "./auth";
import {
  stageDatabase,
  stageFixture,
} from "../../scripts/verify/stage-fixtures";
import { insertScaleTasks } from "../../scripts/verify/stage-scale-fixtures";

test("real 5,000-row planning data remains virtualized and scrollable", async ({
  request,
  page,
}, info) => {
  test.setTimeout(180000);
  const login = await signInOwner(request, "http://localhost:3004");
  expect(login.ok()).toBe(true);
  const user = (await login.json()).user;
  expect(user?.id).toBeTruthy();
  const db = await stageDatabase();
  let space: string;
  try {
    const f = await stageFixture(db, "Real Gantt scale fixture", user.id);
    space = f.space;
    // The initial synthetic task occupies one row; the total is exactly 5,000.
    await insertScaleTasks(db, space, user.id, 4999);
  } finally {
    await db.end();
  }
  const fetched = await request.get(
    `/api/v1/spaces/${space}/planning?limit=5000`,
  );
  expect(fetched.ok()).toBe(true);
  const data = await fetched.json();
  expect(data.total).toBe(5000);
  expect(data.items).toHaveLength(5000);
  expect(
    data.items.every((t: any) => t.body === undefined || t.body === ""),
  ).toBe(true);
  await signInOwner(page.request, "http://localhost:3004");
  const started = Date.now();
  await page.goto(`/workbench/workspaces/${space}/planning?view=gantt`);
  await expect(page.locator(".planning-count")).toContainText("5,000 tasks");
  await expect(page.locator(".gantt-row")).not.toHaveCount(0);
  expect(await page.locator(".gantt-row").count()).toBeLessThan(80);
  await page.locator(".gantt-scroll").evaluate((el) => {
    const height = el
      .querySelector<HTMLElement>(".gantt-row")!
      .getBoundingClientRect().height;
    el.scrollTop = 4773 * height;
  });
  await expect(
    page.locator(".gantt-label").filter({ hasText: "Experiment 4773" }),
  ).toBeVisible();
  expect(await page.locator(".gantt-row").count()).toBeLessThan(80);
  await page.screenshot({ path: info.outputPath("real-gantt-5000.png") });
  await info.attach("real-planning-scale", {
    body: JSON.stringify({
      rows: data.total,
      mountedRows: await page.locator(".gantt-row").count(),
      elapsedMs: Date.now() - started,
      scope:
        "One real-data navigation/scroll check, not a p95 latency benchmark.",
    }),
    contentType: "application/json",
  });
});
