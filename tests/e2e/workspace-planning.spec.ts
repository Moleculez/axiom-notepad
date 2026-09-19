import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInOwner } from "./auth";
import {
  APPEARANCE_SCHEMA,
  appearanceVariables,
  defaults,
} from "../../packages/shared/src/appearance";
const origin = process.env.TEST_APP_URL;
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Workspace acceptance only runs against isolated staging on 3004.",
    );
});
test.use({ trace: "off" });
async function post(context: BrowserContext, path: string, data: unknown) {
  const response = await context.request.post(`/api/v1/${path}`, {
    headers: { origin: origin! },
    data: { mutationId: randomUUID(), ...(data as object) },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test("unified workspace, task inspector, Gantt preview, undo, settings and legacy links", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: {
      "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA),
    },
    serviceWorkers: "block",
  });
  const login = await signInOwner(context.request, origin!);
  expect(login.ok(), await login.text()).toBeTruthy();
  const group = await post(context, "groups", {
      name: `Planning acceptance ${randomUUID().slice(0, 6)}`,
    }),
    workspace = await post(context, "spaces", {
      groupId: group.id,
      name: "Quantum materials study",
      audience: "group",
      description: "Evidence, experiments and review milestones.",
    });
  const id = workspace.space_id,
    route = `/workbench/workspaces/${id}`;
  const a = await post(context, `spaces/${id}/tasks`, {
    title: "Prepare experiment",
    startOn: "2026-09-21",
    dueOn: "2026-09-22",
  });
  await post(context, `spaces/${id}/tasks`, {
    title: "Analyze observations",
    startOn: "2026-09-23",
    dueOn: "2026-09-24",
    dependencies: [a.id],
  });
  await post(context, `spaces/${id}/milestones`, {
    title: "Lab review",
    dueOn: "2026-09-30",
  });
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(route + "/planning?view=gantt");
    await expect(
      page.getByRole("heading", {
        name: "Quantum materials study",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".gantt-bar")).toHaveCount(2);
    const bar = page.locator(".gantt-bar").first(),
      bounds = (await bar.boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 36,
      bounds.y + bounds.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    const preview = page.getByRole("dialog", {
      name: "Preview schedule changes",
    });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("1 dependent tasks proposed");
    await preview
      .getByRole("button", { name: "Apply 2 changes", exact: true })
      .click();
    await expect(preview).not.toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page.getByText("Schedule restored.", { exact: true }),
    ).toBeVisible();
    const resize = page.getByRole("button", {
      name: "Resize end of Prepare experiment",
      exact: true,
    });
    const handle = (await resize.boundingBox())!;
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.width / 2 + 24,
      handle.y + handle.height / 2,
      { steps: 6 },
    );
    await page.mouse.up();
    await expect(preview).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Task details" }),
    ).toHaveCount(0);
    await preview.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "New task", exact: true }).click();
    const inspector = page.getByRole("complementary", { name: "New task" });
    await expect(inspector).toBeVisible();
    await inspector
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Reproduce baseline");
    await expect(page.getByTestId("task-description")).toBeVisible();
    await inspector
      .getByRole("textbox", { name: "Labels (comma separated)" })
      .pressSequentially("physics, analysis");
    await expect(
      inspector.getByRole("textbox", { name: "Labels (comma separated)" }),
    ).toHaveValue("physics, analysis");
    await inspector
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    await expect(inspector).not.toBeVisible();
    await expect(
      page.locator(".gantt-label").filter({ hasText: "Reproduce baseline" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.locator(".planning-board-card")).toHaveCount(3);
    await page
      .getByRole("navigation", { name: "Workspace sections" })
      .getByRole("link", { name: "Overview", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Bring the work into focus." }),
    ).toBeVisible();
    await expect(
      page
        .locator(".workspace-overview")
        .getByText("Reproduce baseline", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("workspace-overview.png"),
      animations: "disabled",
    });
    await page
      .getByRole("navigation", { name: "Workspace sections" })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Working calendar", exact: true }),
    ).toBeVisible();
    const identity = page.locator(".settings-card").filter({
      has: page.getByRole("heading", { name: "Workspace identity" }),
    });
    await identity
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Quantum workspace renamed");
    await identity
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Quantum workspace renamed",
        exact: true,
      }),
    ).toBeVisible();
    const unchanged = await (
      await context.request.get(`/api/v1/group-admin/${group.id}/overview`)
    ).json();
    expect(unchanged.name).toBe(group.name);
    await page.goto(
      `/workbench/projects/${workspace.project_id}/tasks?task=${a.id}`,
    );
    await expect(page).toHaveURL(
      new RegExp(`/workspaces/${id}/planning\\?task=${a.id}`),
    );
    await expect(
      page.getByRole("complementary", { name: "Task details" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close task details", exact: true })
      .click();
    await page.getByRole("button", { name: "Gantt", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Gantt", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".gantt-bar")).toHaveCount(2);
    await page.screenshot({
      path: test.info().outputPath("workspace-gantt-light.png"),
      animations: "disabled",
    });
    await page.evaluate(
      (palette) => {
        document.documentElement.dataset.theme = "dark";
        document.documentElement.style.colorScheme = "dark";
        for (const [name, value] of Object.entries(palette))
          document.documentElement.style.setProperty(name, value);
        document.documentElement.style.setProperty("--size-ui", "18px");
      },
      appearanceVariables(defaults, true),
    );
    await page.screenshot({
      path: test.info().outputPath("workspace-gantt-dark-large-type.png"),
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
test("personal task drafts recover and 5,000-row Gantt remains virtualized", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext({
    baseURL: origin,
    extraHTTPHeaders: {
      "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA),
    },
    serviceWorkers: "block",
  });
  expect((await signInOwner(context.request, origin!)).ok()).toBeTruthy();
  const spaces = await (await context.request.get("/api/v1/spaces")).json(),
    personal = spaces.find((s: any) => s.kind === "personal"),
    page = await context.newPage();
  try {
    await page.goto(`/workbench/workspaces/${personal.id}/planning?task=new`);
    const inspector = page.getByRole("complementary", { name: "New task" });
    await inspector
      .getByRole("textbox", { name: "Title", exact: true })
      .fill("Recoverable research draft");
    await inspector.getByRole("button", { name: "Close task details" }).click();
    await page.getByRole("button", { name: "Keep draft and leave" }).click();
    await expect(inspector).not.toBeVisible();
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await expect(
      inspector.getByRole("textbox", { name: "Title", exact: true }),
    ).toHaveValue("Recoverable research draft");
    await inspector.getByRole("button", { name: "Discard draft" }).click();
    await expect(inspector).not.toBeVisible();
    const tasks = Array.from({ length: 5000 }, (_, i) => ({
      id: randomUUID(),
      space_id: personal.id,
      title: `Experiment ${i}`,
      body: "",
      version: 1,
      status: "todo",
      priority: "normal",
      start_on: "2026-09-21",
      due_on: "2026-09-25",
      dependencies: [],
      labels: [],
      resource_ids: [],
      parent_id: null,
    }));
    await page.route("**/api/v1/spaces/*/planning?*", (route) =>
      route.fulfill({
        json: {
          items: tasks,
          total: 5000,
          completed: 0,
          nextOffset: null,
          milestones: [],
          version: 1,
          calendar: {
            timezone: "UTC",
            workingDays: [1, 2, 3, 4, 5],
            exceptions: [],
          },
        },
      }),
    );
    await page.goto(`/workbench/workspaces/${personal.id}/planning?view=gantt`);
    await expect(page.locator(".planning-count")).toContainText("5,000 tasks");
    await expect(page.locator(".gantt-row")).not.toHaveCount(0);
    expect(await page.locator(".gantt-row").count()).toBeLessThan(80);
    await page.locator(".gantt-scroll").evaluate((el) => {
      el.scrollTop = 210000;
    });
    await expect(
      page.locator(".gantt-label").filter({ hasText: "Experiment 4773" }),
    ).toBeVisible();
    expect(await page.locator(".gantt-row").count()).toBeLessThan(80);
    await page.screenshot({
      path: test.info().outputPath("gantt-5000-virtual-rows.png"),
    });
  } finally {
    await context.close();
  }
});
