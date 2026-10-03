import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInOwner } from "./auth";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
const origin = process.env.TEST_APP_URL;
test.use({
  trace: "off",
  extraHTTPHeaders: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
  serviceWorkers: "block",
});
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Planning mutation acceptance requires isolated staging on 3004.",
    );
});
async function write(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
  method = "POST",
  ok = true,
) {
  const response = await request.fetch(`/api/v1/${path}`, {
    method,
    headers: { origin: origin! },
    data: { mutationId: randomUUID(), ...data },
  });
  if (ok) expect(response.ok(), await response.text()).toBeTruthy();
  return response;
}
async function read(request: APIRequestContext, path: string) {
  const response = await request.get(`/api/v1/${path}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function fixture(request: APIRequestContext) {
  const login = await signInOwner(request, origin!);
  expect(login.ok(), await login.text()).toBeTruthy();
  const group = await (
    await write(request, "groups", {
      name: `Suite ${randomUUID().slice(0, 8)}`,
    })
  ).json();
  const workspace = await (
    await write(request, "spaces", {
      groupId: group.id,
      name: "Physics planning suite",
      audience: "group",
    })
  ).json();
  return { id: workspace.space_id, group: group.id };
}
test("offset compatibility, atomic bulk changes, outcomes, intake retry, saved views and cohort fencing", async ({
  request,
}) => {
  test.setTimeout(180000);
  const { id, group } = await fixture(request),
    base = `spaces/${id}`;
  const a = await (
    await write(request, `${base}/tasks`, {
      title: "Prepare apparatus",
      startOn: "2026-09-24",
      dueOn: "2026-09-25",
      estimateHours: 4,
    })
  ).json();
  let b = await (
    await write(request, `${base}/tasks`, {
      title: "Analyze results",
      startOn: "2026-09-28",
      dueOn: "2026-09-29",
      dependencyLinks: [{ taskId: a.id, lagDays: 2 }],
      progressPercent: 40,
    })
  ).json();
  expect(b.dependencies).toEqual([a.id]);
  expect(b.dependencyLinks).toEqual([{ taskId: a.id, lagDays: 2 }]);
  expect(b.progress_percent).toBe(40);
  b = await (
    await write(
      request,
      `${base}/tasks/${b.id}`,
      { version: b.version, dependencies: [a.id], priority: "high" },
      "PATCH",
    )
  ).json();
  expect(b.dependencyLinks[0].lagDays).toBe(2);
  const contradictory = await write(
    request,
    `${base}/tasks/${b.id}`,
    {
      version: b.version,
      dependencies: [],
      dependencyLinks: [{ taskId: a.id, lagDays: 0 }],
    },
    "PATCH",
    false,
  );
  expect(contradictory.status()).toBe(400);
  const cycle = await write(
    request,
    `${base}/tasks/${a.id}`,
    { version: a.version, dependencies: [b.id] },
    "PATCH",
    false,
  );
  expect([400, 409]).toContain(cycle.status());
  const atomic = await write(
    request,
    `${base}/tasks-bulk`,
    {
      items: [
        { id: a.id, version: a.version },
        { id: b.id, version: b.version + 100 },
      ],
      patch: { status: "done" },
    },
    "POST",
    false,
  );
  expect(atomic.status()).toBe(409);
  expect((await read(request, `${base}/tasks/${a.id}`)).status).toBe("todo");
  const child = await (
    await write(request, `${base}/tasks`, {
      title: "Review data",
      parentId: a.id,
      status: "done",
    })
  ).json();
  const goal = await (
    await write(request, `${base}/goals`, {
      title: "Replicate observations",
      kind: "linked",
      taskIds: [a.id, child.id, b.id],
    })
  ).json();
  expect((await read(request, `${base}/goals`))[0].progress).toMatchObject({
    tracked: 2,
    percent: 70,
  });
  const archived = await (
    await write(
      request,
      `${base}/goals/${goal.id}`,
      { version: goal.version, archived: true },
      "PATCH",
    )
  ).json();
  expect(archived.archived).toBe(true);
  expect(
    (await read(request, `${base}/planning-history/${goal.id}`)).length,
  ).toBe(2);
  const intake = await (
      await write(request, `${base}/intake`, {
        title: "Check a control experiment",
        kind: "experiment",
        body: "## Hypothesis\nTest control.",
      })
    ).json(),
    mutationId = randomUUID(),
    decision = { version: intake.version, decision: "accepted", mutationId };
  const accepted = await (
      await write(request, `${base}/intake/${intake.id}`, decision, "PATCH")
    ).json(),
    retry = await (
      await write(request, `${base}/intake/${intake.id}`, decision, "PATCH")
    ).json();
  expect(retry.task_id).toBe(accepted.task_id);
  expect((await read(request, `${base}/planning?q=Check`)).total).toBe(1);
  const view = await (
    await write(request, `${base}/planning-views`, {
      name: "Critical week",
      shared: true,
      state: {
        view: "gantt",
        zoom: "quarter",
        grouping: "assignee",
        columns: ["progress"],
        filters: { risk: "blocked" },
      },
    })
  ).json();
  expect(
    (await read(request, `${base}/planning-views`)).find(
      (v: any) => v.id === view.id,
    ).state.zoom,
  ).toBe("quarter");
  const peer = await (
      await write(request, "spaces", {
        groupId: group,
        name: "Peer commitments",
        audience: "group",
      })
    ).json(),
    peerId = peer.space_id;
  const other = await (
    await write(request, `spaces/${peerId}/tasks`, {
      title: "Peer experiment",
      startOn: "2026-09-24",
      dueOn: "2026-09-25",
      estimateHours: 8,
    })
  ).json();
  const preview = await (
    await write(request, `${base}/schedule/preview`, {
      changes: [
        {
          id: a.id,
          version: a.version,
          startOn: "2026-09-28",
          dueOn: "2026-09-29",
        },
      ],
    })
  ).json();
  expect(preview.proposed.find((t: any) => t.id === b.id).startOn).toBe(
    "2026-10-02",
  );
  expect(preview.capacity.coverage).toContain("accessible active workspaces");
  expect(preview).not.toHaveProperty("capacity_context");
  await write(
    request,
    `spaces/${peerId}/tasks/${other.id}`,
    { version: other.version, estimateHours: 16 },
    "PATCH",
  );
  const stale = await write(
    request,
    `${base}/schedule/apply`,
    { previewId: preview.id, mode: "proposed" },
    "POST",
    false,
  );
  expect(stale.status()).toBe(409);
  const deletion = await (
    await write(request, `${base}/tasks-bulk`, {
      items: [
        { id: a.id, version: a.version },
        { id: child.id, version: child.version },
      ],
      patch: { deleted: true },
    })
  ).json();
  expect(deletion.count).toBe(2);
  const removed = await read(request, `${base}/planning?deleted=1`);
  const restore = await write(request, `${base}/tasks-bulk`, {
    items: removed.items
      .reverse()
      .map((t: any) => ({ id: t.id, version: t.version })),
    patch: { deleted: false },
  });
  expect(restore.ok()).toBeTruthy();
});
test("planning controls, timeline layers, goals and intake are usable without overflow", async ({
  page,
  context,
}, info) => {
  const request = context.request;
  test.setTimeout(180000);
  const { id } = await fixture(request),
    base = `spaces/${id}`;
  const currentTask = await (
    await write(request, `${base}/tasks`, {
      title: "Long research task",
      startOn: "2026-10-01",
      dueOn: "2026-10-20",
      progressPercent: 50,
    })
  ).json();
  const hiddenTask = await (
    await write(request, `${base}/tasks`, {
      title: "Unfiltered precursor",
      startOn: "2026-09-21",
      dueOn: "2026-09-25",
    })
  ).json();
  await write(request, `${base}/milestones`, {
    title: "Paper review",
    dueOn: "2026-10-21",
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/workbench/workspaces/${id}/planning?view=gantt`);
  const timeline = page.getByRole("region", { name: "Gantt schedule" });
  await expect(timeline).toBeVisible();
  await page.getByLabel("Timeline scale").selectOption("quarter");
  await page
    .getByRole("button", { name: "Timeline columns and layers" })
    .click();
  const display = page.getByRole("dialog", { name: "Timeline display" });
  await display.getByLabel("Group tasks").selectOption("assignee");
  await display.getByLabel("Progress", { exact: true }).check();
  await display.getByRole("button", { name: "Done", exact: true }).click();
  const resizer = page.getByRole("separator", { name: "Task column width" });
  await resizer.focus();
  await resizer.press("ArrowRight");
  await expect(resizer).toHaveAttribute("aria-valuenow", "310");
  await page.getByRole("button", { name: "Link tasks", exact: true }).click();
  const link = page.getByRole("dialog", { name: "Link tasks" });
  const picker = link.getByRole("combobox", { name: "Dependency predecessor" });
  await picker.fill("Long research");
  await expect(
    link.getByRole("option", { name: "Long research task" }),
  ).toBeVisible();
  await picker.press("Enter");
  await expect(picker).toHaveValue("Long research task");
  await link.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.screenshot({ path: info.outputPath("planning-timeline.png") });
  await page.getByLabel("Find tasks", { exact: true }).fill("Long");
  await expect(
    page
      .locator(".gantt-task-name")
      .filter({ hasText: "Unfiltered precursor" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Link tasks", exact: true }).click();
  const relationship = page.getByRole("dialog", { name: "Link tasks" }),
    before = relationship.getByRole("combobox", {
      name: "Dependency predecessor",
    }),
    after = relationship.getByRole("combobox", {
      name: "Dependency successor",
    });
  let failed = false;
  await page.route(`**/spaces/${id}/planning-options?**`, async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("q") === "Unfiltered" &&
      !failed
    ) {
      failed = true;
      await route.fulfill({
        status: 503,
        json: { error: "Temporary lookup failure" },
      });
    } else await route.continue();
  });
  await before.fill("Unfiltered");
  await relationship
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(
    relationship.getByRole("option", { name: "Unfiltered precursor" }),
  ).toBeVisible();
  await before.press("Enter");
  await expect(before).toHaveValue("Unfiltered precursor");
  await after.fill("Long");
  await expect(
    relationship.getByRole("option", { name: "Long research task" }),
  ).toBeVisible();
  await after.press("Enter");
  const offset = relationship.getByRole("spinbutton", {
      name: "Dependency offset in working days",
    }),
    save = relationship.getByRole("button", { name: "Save link", exact: true });
  await offset.fill("");
  await expect(save).toBeDisabled();
  await offset.pressSequentially("-2");
  await expect(offset).toHaveValue("-2");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(relationship).toHaveCount(0);
  const savedTask = await read(request, `${base}/tasks/${currentTask.id}`);
  expect(savedTask.dependencyLinks).toEqual([
    { taskId: hiddenTask.id, lagDays: -2 },
  ]);
  expect(savedTask.start_on).toBe("2026-10-01");
  await page.unroute(`**/spaces/${id}/planning-options?**`);
  await page
    .getByRole("navigation", { name: "Planning sections" })
    .getByRole("button", { name: "Goals", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Goals", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New goal", exact: true }).click();
  await page
    .getByRole("dialog", { name: "New goal" })
    .getByLabel("Outcome")
    .fill("Publish a reproducible study");
  await page.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Publish a reproducible study",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Planning sections" })
    .getByRole("button", { name: "Intake", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  const draft = page.getByRole("dialog", { name: "New research request" });
  await draft
    .getByLabel("Request", { exact: true })
    .fill("Review sampling method");
  await draft
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review sampling method", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
