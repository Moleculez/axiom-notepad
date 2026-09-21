import { randomUUID } from "node:crypto";
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { addDays } from "../../packages/shared/src/planning";
import { capacityWeekStart } from "../../packages/shared/src/planning-analysis";

type Api = (
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method?: string,
) => Promise<any>;

/** Fictional, additive fixtures. Called only after the capture runner's staging guard. */
export async function productivityShowcase({
  api,
  member,
  colleague,
  groupId,
  spaceId,
  noteId,
  output,
}: {
  api: Api;
  member: BrowserContext;
  colleague: BrowserContext;
  groupId: string;
  spaceId: string;
  noteId: string;
  output: string;
}) {
  const mutation = (data: object) => ({ mutationId: randomUUID(), ...data });
  const me = (await api(member.request, "me")).user;
  const peer = (await api(colleague.request, "me")).user;
  const monday = capacityWeekStart(new Date().toISOString().slice(0, 10));
  const date = (offset: number) => addDays(monday, offset);
  const extra = await api(
    member.request,
    "spaces",
    mutation({
      groupId,
      name: "Transfer experiments",
      audience: "group",
      description: "Fictional cross-graph replication study.",
    }),
  );
  const milestone = await api(
    member.request,
    `spaces/${spaceId}/milestones`,
    mutation({
      title: "Reproducibility review",
      dueOn: date(18),
    }),
  );
  const tasks: any[] = [];
  for (const [title, from, to, effort, assignee, dependencies, status] of [
    ["Define the graph and normalization", 0, 1, 8, me.id, [], "done"],
    ["Reproduce the spectral baseline", 2, 4, 20, me.id, [0], "in_progress"],
    ["Compare diffusion scales", 7, 9, 18, peer.id, [1], "todo"],
    ["Measure stability across seeds", 7, 11, 16, me.id, [1], "todo"],
    ["Cross-graph transfer study", 14, 16, 16, peer.id, [2, 3], "todo"],
    [
      "Document assumptions and limitations",
      0,
      11,
      12,
      peer.id,
      [],
      "in_progress",
    ],
  ] as const) {
    tasks.push(
      await api(
        member.request,
        `spaces/${spaceId}/tasks`,
        mutation({
          title,
          startOn: date(from),
          dueOn: date(to),
          estimateHours: effort,
          assigneeId: assignee,
          dependencies: dependencies.map((i) => tasks[i].id),
          status,
          priority: dependencies.length ? "high" : "normal",
          milestoneId: milestone.id,
          labels: ["spectral-learning"],
          resourceIds: [noteId],
        }),
      ),
    );
  }
  await api(
    member.request,
    `spaces/${extra.space_id}/tasks`,
    mutation({
      title: "Build the held-out graph benchmark",
      startOn: date(0),
      dueOn: date(4),
      estimateHours: 16,
      assigneeId: me.id,
      status: "in_progress",
      labels: ["replication"],
    }),
  );
  await api(
    member.request,
    `spaces/${extra.space_id}/tasks`,
    mutation({
      title: "Independent replication report",
      startOn: date(7),
      dueOn: date(16),
      estimateHours: 24,
      assigneeId: peer.id,
      labels: ["replication"],
    }),
  );
  const analysis = await api(
    member.request,
    `spaces/${spaceId}/planning-analysis`,
  );
  const baseline = await api(
    member.request,
    `spaces/${spaceId}/baselines`,
    mutation({
      name: "Protocol agreed",
      version: analysis.version,
    }),
  );
  await api(
    member.request,
    `spaces/${spaceId}/tasks/${tasks[4].id}`,
    mutation({
      version: tasks[4].version,
      dueOn: date(18),
      estimateHours: 20,
    }),
    "PATCH",
  );
  for (const [userId, weeklyHours] of [
    [me.id, 24],
    [peer.id, 28],
  ] as const)
    await api(
      member.request,
      `groups/${groupId}/capacity`,
      mutation({
        userId,
        version: 0,
        settings: { weeklyHours, workingDays: [1, 2, 3, 4, 5], exceptions: [] },
      }),
      "PATCH",
    );
  const portfolio = await api(
    member.request,
    `groups/${groupId}/portfolios`,
    mutation({
      name: "Learning from structure",
      version: 0,
      spaceIds: [spaceId, extra.space_id],
    }),
  );
  // This provider is never contacted. Captures stop before preparing or sending a turn.
  // The staging server needs a disposable TOOL_PROVIDER_KEY and loopback allowlist.
  await api(member.request, `group-admin/${groupId}/providers`, {
    name: "Demonstration · preview only",
    kind: "private",
    endpoint: "http://127.0.0.1:8096/v1/",
    model: "local-preview",
    credential: "documentation-preview-only",
    capabilities: ["assistant"],
    enabled: true,
    dailyLimit: 1,
  });
  async function settled(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".workspace-progress")).toHaveAttribute(
      "data-phase",
      "idle",
    );
    await page.mouse.move(1580, 1020);
  }
  async function shot(page: Page, name: string, mode: string) {
    await settled(page);
    await page.screenshot({
      path: `${output}/${name}-${mode}.png`,
      animations: "disabled",
    });
  }
  return {
    receipt: {
      portfolio: portfolio.id,
      baseline: baseline.id,
      referenceMonday: monday,
      extraSpace: extra.space_id,
    },
    async capture(page: Page, mode: "light" | "dark") {
      await page.setViewportSize({ width: 1600, height: 1200 });
      await page.goto(`/workbench/workspaces/${spaceId}/planning?view=gantt`);
      await expect(page.locator(".gantt-bar")).toHaveCount(tasks.length);
      await page.getByRole("button", { name: "Fit", exact: true }).click();
      await page.getByRole("button", { name: "Insights & baselines" }).click();
      await page
        .getByLabel("Baseline", { exact: true })
        .selectOption(baseline.id);
      await expect(page.locator(".gantt-baseline")).toHaveCount(tasks.length);
      await expect(
        page.getByRole("region", { name: "Schedule insights" }),
      ).toContainText("1 changed tasks");
      await shot(page, "planning", mode);
      await page.setViewportSize({ width: 1600, height: 1040 });

      await page.goto(
        `/workbench/groups/${groupId}/planning?portfolio=${portfolio.id}`,
      );
      await expect(
        page.locator(".productivity-data-table tbody tr"),
      ).toHaveCount(2);
      await shot(page, "portfolio", mode);
      await page.getByRole("button", { name: "Capacity", exact: true }).click();
      await page.getByLabel("Week of", { exact: true }).fill(monday);
      await page.getByLabel("Range").selectOption("4");
      await expect(
        page.getByRole("table", { name: "Weekly capacity" }),
      ).toBeVisible();
      await expect(page.locator(".capacity-name")).toHaveCount(2);
      await page
        .getByRole("heading", { name: "Spectral Lab", exact: true })
        .click();
      await shot(page, "capacity", mode);

      await page.goto(`/workbench/workspaces/${spaceId}/planning?view=gantt`);
      await page
        .getByRole("button", { name: "Ask about this plan", exact: true })
        .click();
      const panel = page.getByRole("complementary", {
        name: "Workspace research assistant",
      });
      await expect(panel.locator(".assistant-picked")).toContainText("6 tasks");
      if (
        (await panel.locator(".assistant-group-scope").getAttribute("open")) ===
        null
      )
        await panel.locator(".assistant-group-scope summary").click();
      await panel.getByLabel("Transfer experiments", { exact: true }).check();
      await expect(panel).toContainText("2 selected group workspaces");
      await panel
        .getByLabel("Assistant request")
        .fill(
          "Identify schedule risks in these selected tasks. Distinguish the working-day forecast from your interpretation, and explain what evidence is still missing.",
        );
      await shot(page, "assistant", mode);
      await panel.getByRole("button", { name: "Close assistant" }).click();

      // Hold a real refresh, without modifying the returned content or UI pixels.
      await page.goto(
        `/workbench/groups/${groupId}/planning?portfolio=${portfolio.id}`,
      );
      await expect(
        page.locator(".productivity-data-table tbody tr"),
      ).toHaveCount(2);
      await settled(page);
      const url = `**/api/v1/groups/${groupId}/portfolio*`;
      let release = () => {};
      const gate = new Promise<void>((done) => {
        release = done;
      });
      await page.route(url, async (route) => {
        await gate;
        await route.continue().catch(() => {});
      });
      try {
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(page.locator(".group-planning h1")).toContainText(
          "Spectral Lab",
        );
        await expect(
          page.getByRole("progressbar", { name: "Workspace loading" }),
        ).toBeVisible();
        await expect(
          page.locator(".productivity-data-table tbody tr"),
        ).toHaveCount(2);
        await page.evaluate(() => document.fonts.ready);
        // Wait for the actual sweep to enter the viewport; do not freeze or redraw it.
        await page.waitForFunction(() => {
          const fill = document
            .querySelector(".workspace-progress-fill")
            ?.getBoundingClientRect();
          if (!fill) return false;
          return (
            fill.width >= innerWidth * 0.9 ||
            (fill.left >= innerWidth * 0.15 && fill.right <= innerWidth * 0.85)
          );
        });
        await page.screenshot({ path: `${output}/loading-${mode}.png` });
      } finally {
        release();
        await page.unroute(url);
      }
      await settled(page);
      const conversations = await api(
        member.request,
        `spaces/${spaceId}/assistant/conversations`,
      );
      for (const c of conversations) {
        const detail = await api(
          member.request,
          `assistant/conversations/${c.id}`,
        );
        expect(detail.turns).toHaveLength(0);
      }
    },
  };
}
