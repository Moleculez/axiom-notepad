import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type Locator,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mutationTestTarget } from "../../packages/shared/src/test-target";
import type {
  ArchivePage,
  GoalPage,
  GoalDetail,
  HistoryPage,
  OccurrencePage,
} from "../../packages/shared/src/planning-archives";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
import {
  interfaceStyleIds,
  type InterfaceStyleId,
} from "../../packages/shared/src/interface-styles";
import { signInOwner } from "./auth";
const pg = createRequire(import.meta.url)("pg") as typeof import("pg");
const origin = "http://localhost:3004";
test.use({
  trace: "off",
  serviceWorkers: "block",
  extraHTTPHeaders: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
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
    headers: { origin },
    data: { mutationId: randomUUID(), ...data },
  });
  if (ok) expect(response.ok(), await response.text()).toBeTruthy();
  return response;
}
async function read<T = any>(
  request: APIRequestContext,
  path: string,
): Promise<T> {
  const response = await request.get(`/api/v1/${path}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
function database() {
  const target = mutationTestTarget(process.env, process.env.AXIOM_TEST_ROOT);
  if (target.profile !== "reliability")
    throw new Error(
      "Planning archives require the attested reliability staging profile, not the working dataset.",
    );
  return new pg.Client({ connectionString: target.databaseUrl });
}
async function fixture(request: APIRequestContext) {
  const login = await signInOwner(request, origin);
  expect(login.ok(), await login.text()).toBeTruthy();
  const group = await (
    await write(request, "groups", {
      name: `Archives ${randomUUID().slice(0, 8)}`,
    })
  ).json();
  const workspace = await (
    await write(request, "spaces", {
      groupId: group.id,
      name: "Laboratory planning archives",
      audience: "group",
    })
  ).json();
  const space = workspace.space_id as string,
    collaborator = `archive-fixture-${randomUUID()}`,
    routine = randomUUID();
  const db = database();
  await db.connect();
  let owner = "",
    goal = "";
  try {
    const scoped = (
      await db.query(
        'SELECT u.id FROM "user" u WHERE email=$1 AND axiom_manage_space(u.id,$2)',
        [process.env.TEST_OWNER_EMAIL, space],
      )
    ).rows;
    expect(scoped).toHaveLength(1);
    owner = scoped[0].id;
    await db.query("BEGIN");
    await db.query(
      "INSERT INTO \"user\"(id,name,email) VALUES($1,'Fixture collaborator',$2)",
      [collaborator, `${collaborator}@axiom.test`],
    );
    await db.query(
      "INSERT INTO members(group_id,user_id,role,content_role) VALUES($1,$2,'member','editor')",
      [group.id, collaborator],
    );
    await db.query(
      `INSERT INTO planning_goals(space_id,title,body,owner_id,kind,current_value,target,unit,due_on,archived,created_by,created_at)
      SELECT $1,'Lab outcome '||lpad(n::text,4,'0')||CASE WHEN n=174 THEN ' · Reproducible multi-physics experiment and uncertainty quantification for our international research cohort' ELSE '' END,
      CASE WHEN n=1 THEN '# Source-only sentinel\n\nPrivate canonical goal description.\n\n$$E=mc^2$$' ELSE repeat('Private source evidence. ',150) END,
      CASE WHEN n%4=0 THEN $3 ELSE $2 END,CASE WHEN n%2=0 THEN 'metric' ELSE 'linked' END,n%10,10,'experiments','2026-12-01',n>175,$2,
      now()-interval '1 hour'+(n/20)*interval '1 second'+((n%20)/10)*interval '1 microsecond' FROM generate_series(1,200) n`,
      [space, owner, collaborator],
    );
    goal = (
      await db.query(
        "SELECT id FROM planning_goals WHERE space_id=$1 AND title='Lab outcome 0001'",
        [space],
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO planning_history(space_id,entity_id,kind,actor_id,summary,created_at)
      SELECT $1,$2,'goal',CASE WHEN n%4=0 THEN $4 ELSE $3 END,'Recorded outcome change '||lpad(n::text,4,'0')||CASE WHEN n=17 THEN ' · 100%_\\ literal' ELSE '' END,
      now()-interval '1 hour'+(n/20)*interval '1 second'+((n%20)/10)*interval '1 microsecond' FROM generate_series(1,1250) n`,
      [space, goal, owner, collaborator],
    );
    await db.query(
      `INSERT INTO task_recurrences(id,space_id,project_id,created_by,rule,template,enabled)
      SELECT $1,id,project_id,$3,$4::jsonb,$5::jsonb,false FROM spaces WHERE id=$2`,
      [
        routine,
        space,
        owner,
        JSON.stringify({
          frequency: "daily",
          interval: 1,
          start: "2025-01-01",
          until: "2025-12-31",
        }),
        JSON.stringify({
          title: "Historical laboratory checks",
          body: "Future template remains unchanged",
        }),
      ],
    );
    await db.query(
      `WITH created AS (INSERT INTO tasks(space_id,project_id,title,body,status,created_by,created_at,deleted_at)
      SELECT id,project_id,'Generated check '||lpad(n::text,4,'0'),'Not a summary body',CASE WHEN n%3=0 THEN 'done' ELSE 'todo' END,$2,
      now()-interval '1 hour'+n*interval '1 second',CASE WHEN n%5=0 THEN now()-interval '1 minute' ELSE NULL END
      FROM spaces CROSS JOIN generate_series(1,215) n WHERE id=$1 RETURNING id,title)
      INSERT INTO task_occurrences(recurrence_id,occurs_on,task_id) SELECT $3,'2025-01-01'::date+(right(title,4)::int-1),id FROM created`,
      [space, owner, routine],
    );
    await db.query(
      `INSERT INTO planning_history(space_id,entity_id,kind,actor_id,summary,created_at)
      SELECT $1,$2,'routine',$3,'Routine template change '||n,now()-interval '1 hour'+n*interval '1 second' FROM generate_series(1,135) n`,
      [space, routine, owner],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }
  return {
    space,
    group: group.id,
    owner,
    goal,
    routine,
    base: `spaces/${space}`,
    route: `/workbench/workspaces/${space}/planning?section=goals`,
  };
}
async function walk<T extends { id: string }>(
  request: APIRequestContext,
  endpoint: string,
  query: string,
) {
  const ids: string[] = [];
  let cursor: string | null = null,
    first: ArchivePage<T> | null = null;
  do {
    const page: ArchivePage<T> = await read(
      request,
      `${endpoint}?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    first ??= page;
    expect(page.total).toBe(first.total);
    expect(page.asOf).toBe(first.asOf);
    expect(page.items.length).toBeLessThanOrEqual(37);
    ids.push(...page.items.map((r) => r.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toHaveLength(first!.total);
  return ids;
}
test("complete bounded goal/archive pages, exact tied cursors, scoped detail, cap and revoked access", async ({
  context,
  browser,
}, info) => {
  const f = await fixture(context.request),
    request = context.request,
    db = database();
  await db.connect();
  try {
    const goals = await read<GoalPage>(
      request,
      `${f.base}/goals?filter=all&limit=37`,
    );
    expect(goals.total).toBe(200);
    expect(goals.workspaceTotal).toBe(200);
    expect(goals.goalLimit).toBe(200);
    expect(goals.stateCounts).toEqual({ active: 175, archived: 25 });
    expect(goals.items).toHaveLength(37);
    expect(goals.items[0]).not.toHaveProperty("body");
    expect(goals.items[0]).not.toHaveProperty("task_ids");
    const detail = await read<{ item: GoalDetail }>(
      request,
      `${f.base}/goals/${f.goal}`,
    );
    expect(detail.item.body).toContain("Source-only sentinel");
    expect(detail.item.due_on).toBe("2026-12-01");
    const bodySearch = await read<GoalPage>(
      request,
      `${f.base}/goals?q=Source-only%20sentinel`,
    );
    expect(bodySearch.items.map((g) => g.id)).toEqual([f.goal]);
    expect(bodySearch.items[0]).not.toHaveProperty("body");
    expect(
      (await read<GoalPage>(request, `${f.base}/goals?mine=1`)).total,
    ).toBe(132);
    expect(
      (await read<GoalPage>(request, `${f.base}/goals?filter=all&kind=metric`))
        .total,
    ).toBe(100);
    expect(
      (
        await write(
          request,
          `${f.base}/goals`,
          { title: "Over cap", kind: "metric" },
          "POST",
          false,
        )
      ).status(),
    ).toBe(413);
    expect(
      (await request.get(`/api/v1/${f.base}/goals/${randomUUID()}`)).status(),
    ).toBe(404);
    const peer = await (
      await write(request, "spaces", {
        groupId: f.group,
        name: "Unrelated workspace",
        audience: "group",
      })
    ).json();
    expect(
      (
        await request.get(`/api/v1/spaces/${peer.space_id}/goals/${f.goal}`)
      ).status(),
    ).toBe(404);
    const historyBase = `${f.base}/planning-history/${f.goal}`,
      occurrenceBase = `${f.base}/recurrences/${f.routine}/occurrences`;
    for (const sort of ["oldest", "newest"]) {
      const direction = sort === "oldest" ? "ASC" : "DESC";
      const goalIds = await walk(
        request,
        `${f.base}/goals`,
        `filter=all&limit=37&sort=${sort}`,
      );
      expect(goalIds).toEqual(
        (
          await db.query(
            `SELECT id FROM planning_goals WHERE space_id=$1 ORDER BY created_at ${direction},id ${direction}`,
            [f.space],
          )
        ).rows.map((r) => r.id),
      );
      const historyIds = await walk(
        request,
        historyBase,
        `limit=37&sort=${sort}`,
      );
      expect(historyIds).toEqual(
        (
          await db.query(
            `SELECT id FROM planning_history WHERE space_id=$1 AND entity_id=$2 ORDER BY created_at ${direction},id ${direction}`,
            [f.space, f.goal],
          )
        ).rows.map((r) => r.id),
      );
      const occurrenceIds = await walk(
        request,
        occurrenceBase,
        `limit=37&sort=${sort}`,
      );
      expect(occurrenceIds).toEqual(
        (
          await db.query(
            `SELECT task_id AS id FROM task_occurrences WHERE recurrence_id=$1 ORDER BY occurs_on ${direction}`,
            [f.routine],
          )
        ).rows.map((r) => r.id),
      );
    }
    const history = await read<HistoryPage>(request, `${historyBase}?limit=37`);
    expect(history.total).toBe(1250);
    const literal = await read<HistoryPage>(
      request,
      `${historyBase}?q=${encodeURIComponent("100%_\\")}`,
    );
    expect(literal.total).toBe(1);
    expect(
      (await read<HistoryPage>(request, `${historyBase}?mine=1`)).total,
    ).toBe(938);
    await db.query(
      "INSERT INTO planning_history(space_id,entity_id,kind,actor_id,summary) VALUES($1,$2,'goal',$3,'Newly recorded change')",
      [f.space, f.goal, f.owner],
    );
    const next = await read<HistoryPage>(
      request,
      `${historyBase}?limit=37&cursor=${history.nextCursor}`,
    );
    expect(next.total).toBe(1250);
    expect((await read<HistoryPage>(request, historyBase)).total).toBe(1251);
    for (const endpoint of [
      `${f.base}/goals?filter=all&limit=37&q=changed&cursor=${goals.nextCursor}`,
      `${historyBase}?limit=37&mine=1&cursor=${history.nextCursor}`,
      `${f.base}/planning-history/${f.routine}?limit=37&cursor=${history.nextCursor}`,
    ])
      expect((await request.get(`/api/v1/${endpoint}`)).status()).toBe(400);
    const occurrences = await read<OccurrencePage>(
      request,
      `${occurrenceBase}?limit=37`,
    );
    expect(occurrences.total).toBe(215);
    expect(occurrences.items[0]).not.toHaveProperty("body");
    expect(
      (await read<OccurrencePage>(request, `${occurrenceBase}?state=deleted`))
        .total,
    ).toBe(43);
    expect(
      (await read<OccurrencePage>(request, `${occurrenceBase}?state=active`))
        .total,
    ).toBe(172);
    expect(
      (
        await read<OccurrencePage>(
          request,
          `${occurrenceBase}?from=2025-01-02&to=2025-01-02`,
        )
      ).total,
    ).toBe(1);
    expect(
      (await read<OccurrencePage>(request, `${occurrenceBase}?status=done`))
        .total,
    ).toBe(71);
    expect(
      (
        await request.get(
          `/api/v1/${occurrenceBase}?from=2025-01-03&to=2025-01-02`,
        )
      ).status(),
    ).toBe(400);
    expect(
      (await request.get(`/api/v1/${occurrenceBase}?limit=101`)).status(),
    ).toBe(400);
    const staleVersion = detail.item.version;
    await write(
      request,
      `${f.base}/goals/${f.goal}`,
      { version: staleVersion, title: "Peer-reviewed outcome" },
      "PATCH",
    );
    expect(
      (
        await write(
          request,
          `${f.base}/goals/${f.goal}`,
          { version: staleVersion, body: "Overwrite attempt" },
          "PATCH",
          false,
        )
      ).status(),
    ).toBe(409);
    expect(
      (await read<{ item: GoalDetail }>(request, `${f.base}/goals/${f.goal}`))
        .item.body,
    ).toBe(detail.item.body);
    const fullBodies = (
      await db.query("SELECT body FROM planning_goals WHERE space_id=$1", [
        f.space,
      ])
    ).rows;
    const summaries = await read<GoalPage>(
      request,
      `${f.base}/goals?filter=all&limit=100`,
    );
    const summaryBytes = Buffer.byteLength(JSON.stringify(summaries)),
      comparisonBytes = Buffer.byteLength(
        JSON.stringify({
          ...summaries,
          items: summaries.items.map((g) => ({
            ...g,
            body: fullBodies[1].body,
          })),
        }),
      );
    expect(summaryBytes).toBeLessThan(comparisonBytes / 3);
    await info.attach("goal-summary-payload", {
      body: JSON.stringify({
        summaryBytes,
        comparisonBytes,
        scope:
          "100 synthetic goal summaries vs same summaries with fixture Markdown bodies",
      }),
      contentType: "application/json",
    });
    const invitation = await (
      await write(request, "invitations", {
        groupId: f.group,
        email: `archive-reader-${randomUUID()}@axiom.test`,
      })
    ).json();
    const viewer = await browser.newContext({ baseURL: origin });
    try {
      const registered = await (
        await write(viewer.request, "register", {
          token: new URL(invitation.link).searchParams.get("invite"),
          name: "Archive reader",
          password: "FixtureResearch2026!",
        })
      ).json();
      await db.query(
        "UPDATE members SET content_role='viewer' WHERE group_id=$1 AND user_id=$2",
        [f.group, registered.user.id],
      );
      const page = await read<GoalPage>(
        viewer.request,
        `${f.base}/goals?filter=all&limit=37`,
      );
      expect(
        (
          await write(
            viewer.request,
            `${f.base}/goals`,
            { title: "Forbidden", kind: "metric" },
            "POST",
            false,
          )
        ).status(),
      ).toBe(403);
      expect(
        (
          await request.get(
            `/api/v1/${f.base}/goals?filter=all&limit=37&cursor=${page.nextCursor}`,
          )
        ).status(),
      ).toBe(400);
      await db.query("DELETE FROM members WHERE group_id=$1 AND user_id=$2", [
        f.group,
        registered.user.id,
      ]);
      for (const path of [
        `${f.base}/goals?filter=all&limit=37&cursor=${page.nextCursor}`,
        `${f.base}/goals/${f.goal}`,
        historyBase,
        occurrenceBase,
      ])
        expect([403, 404]).toContain(
          (await viewer.request.get(`/api/v1/${path}`)).status(),
        );
    } finally {
      await viewer.close();
    }
  } finally {
    await db.end();
  }
});
async function dialogLayout(dialog: Locator) {
  await expect(dialog.locator(".dialog-footer")).toBeVisible();
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  expect(
    await dialog
      .locator(".dialog-footer")
      .evaluate((el) => !el.closest(".dialog-body")),
  ).toBe(true);
  const b = await dialog.boundingBox(),
    f = await dialog.locator(".dialog-footer").boundingBox();
  expect(f!.y + f!.height).toBeLessThanOrEqual(b!.y + b!.height + 1);
}
async function appearance(
  request: APIRequestContext,
  mode: "light" | "dark",
  interfaceStyle: InterfaceStyleId,
) {
  const current = await read(request, "me/preferences");
  const response = await request.patch("/api/v1/me/preferences", {
    headers: { origin },
    data: {
      version: current.version,
      mutationId: randomUUID(),
      preferences: {
        ...current.preferences,
        mode,
        interfaceStyle,
        uiSize: 22,
        radius: 0,
        shadows: "none",
        motion: "reduced",
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}
async function goalsLayout(page: Page) {
  const panel = page.getByRole("region", { name: "Workspace goals" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(
    await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  expect(
    await panel
      .locator(".planning-goal-results")
      .evaluate((el) => el.clientHeight),
  ).toBeGreaterThan(80);
  for (const control of [
    panel.getByRole("searchbox", { name: "Search goals", exact: true }),
    panel.getByLabel("Goal filter", { exact: true }),
    panel.getByRole("button", { name: "Next", exact: true }),
  ]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThan(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height + 1,
    );
  }
}
test("goal details are lazy; drafts stay version-fenced; history and occurrences retain fixed navigation", async ({
  page,
  context,
}, info) => {
  const f = await fixture(context.request),
    errors: string[] = [],
    details: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/\/goals\/[a-f0-9-]+(?:\?|$)/.test(r.url())) details.push(r.url());
  });
  await appearance(context.request, "light", "axiom");
  await page.goto(f.route);
  const panel = page.getByRole("region", { name: "Workspace goals" });
  await expect(panel).toContainText("175 matching goals · 200 / 200");
  await expect(
    panel.getByRole("button", { name: "New goal", exact: true }),
  ).toBeDisabled();
  await panel.getByLabel("Goals per page").selectOption("15");
  await expect(panel.locator(".planning-outcome-grid > article")).toHaveCount(
    15,
  );
  await panel.getByRole("button", { name: "Next", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    panel.getByRole("navigation", { name: "Goals pages" }),
  ).toContainText("Page 2");
  expect(details).toEqual([]);
  await panel
    .getByRole("searchbox", { name: "Search goals", exact: true })
    .fill("Source-only sentinel");
  await expect(panel.locator(".planning-outcome-grid > article")).toHaveCount(
    1,
  );
  await expect(
    panel.getByRole("navigation", { name: "Goals pages" }),
  ).toContainText("Page 1");
  await panel
    .getByRole("button", { name: "Lab outcome 0001", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Goal details",
    exact: true,
  });
  await expect(editor.getByLabel("Outcome", { exact: true })).toHaveValue(
    "Lab outcome 0001",
  );
  await expect(editor).toContainText("Source-only sentinel");
  expect(details).toHaveLength(1);
  await dialogLayout(editor);
  await editor
    .getByLabel("Outcome", { exact: true })
    .fill("My retained outcome draft");
  const detail = await read<{ item: GoalDetail }>(
    context.request,
    `${f.base}/goals/${f.goal}`,
  );
  await write(
    context.request,
    `${f.base}/goals/${f.goal}`,
    { version: detail.item.version, title: "Peer outcome title" },
    "PATCH",
  );
  await editor.getByRole("button", { name: "Save goal", exact: true }).click();
  await expect(editor).toContainText("changed");
  await expect(editor.getByLabel("Outcome", { exact: true })).toHaveValue(
    "My retained outcome draft",
  );
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "Unsaved goal", exact: true });
  await expect(guard).toBeVisible();
  await guard
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await panel.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("dialog", {
    name: "Goal history",
    exact: true,
  });
  await expect(history).toContainText("1251 matching changes");
  await dialogLayout(history);
  // Loaded navigation must not disable during a peer refresh between down/up.
  let release!: () => void,
    refreshing = false;
  const held = new Promise<void>((done) => {
    release = done;
  });
  const historyPattern = `**/spaces/${f.space}/planning-history/${f.goal}?**`;
  await page.route(historyPattern, async (route) => {
    if (!new URL(route.request().url()).searchParams.has("cursor")) {
      refreshing = true;
      await held;
    }
    await route.continue().catch(() => {
      /* The new page aborts the held read. */
    });
  });
  try {
    const next = history.getByRole("button", { name: "Next", exact: true });
    const box = (await next.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.evaluate(() =>
      window.dispatchEvent(new Event("axiom:workspace-refresh")),
    );
    await expect.poll(() => refreshing).toBe(true);
    await expect(history.locator(".planning-archive-results")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(next).toBeEnabled();
    await page.mouse.up();
    await expect(history.getByRole("navigation")).toContainText("Page 2");
  } finally {
    release();
    await page.mouse.up();
    await page.unroute(historyPattern);
  }
  await expect(history.getByRole("navigation")).toContainText("Page 2");
  await history
    .getByRole("searchbox", { name: "Search changes", exact: true })
    .fill("100%_\\");
  await expect(history.locator(".planning-history-list > li")).toHaveCount(1);
  await expect(history.getByRole("navigation")).toContainText("Page 1");
  await page.screenshot({
    path: info.outputPath("goal-history-literal-search.png"),
  });
  // A native search input may consume Escape to clear its own value first.
  await history
    .getByRole("button", { name: "Close dialog", exact: true })
    .focus();
  await page.keyboard.press("Escape");
  await expect(history).toHaveCount(0);
  await page.goto(`/workbench/workspaces/${f.space}/planning`);
  await page
    .getByRole("button", { name: "Recurring tasks", exact: true })
    .click();
  const routines = page.getByRole("dialog", {
    name: "Recurring tasks",
    exact: true,
  });
  await routines.getByRole("button", { name: "History", exact: true }).click();
  const archive = page.getByRole("dialog", {
    name: "Routine history",
    exact: true,
  });
  await expect(archive).toContainText("135 matching changes");
  await archive
    .getByRole("button", { name: "Generated tasks", exact: true })
    .click();
  await expect(archive).toContainText("215 matching generated tasks");
  await archive.getByRole("button", { name: "Next", exact: true }).click();
  await expect(archive.getByRole("navigation")).toContainText("Page 2");
  await archive.getByRole("button", { name: /^Filters/ }).click();
  const taskFilters = page.getByRole("dialog", {
    name: "Filter generated tasks",
    exact: true,
  });
  await taskFilters
    .getByLabel("Availability", { exact: true })
    .selectOption("deleted");
  await taskFilters
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(archive).toContainText("43 matching generated tasks");
  await expect(
    archive.locator(".planning-occurrence-list > li").first(),
  ).toContainText("Deleted task");
  await expect(
    archive.locator(".planning-occurrence-list a").first(),
  ).toHaveAttribute("href", /deleted=1/);
  await archive.getByRole("button", { name: /^Filters/ }).click();
  await taskFilters.getByLabel("Occurrence from").fill("2025-01-05");
  await taskFilters.getByLabel("Occurrence until").fill("2025-01-05");
  await dialogLayout(taskFilters);
  await taskFilters
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(archive).toContainText("1 matching generated tasks");
  await dialogLayout(archive);
  expect(
    await archive
      .locator(".planning-archive-results")
      .evaluate((el) => el.clientHeight),
  ).toBeGreaterThan(80);
  await expect(
    archive.getByRole("link", { name: "Generated check 0005", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("routine-generated-task-archive.png"),
  });
  await page.keyboard.press("Escape");
  await expect(archive).toHaveCount(0);
  await routines
    .getByRole("button", { name: /Historical laboratory checks/ })
    .click();
  const routineEditor = page.getByRole("dialog", {
    name: "Edit future occurrences",
    exact: true,
  });
  await dialogLayout(routineEditor);
  await routineEditor
    .getByLabel("Task title", { exact: true })
    .fill("Revised future laboratory checks");
  await routineEditor
    .getByRole("button", { name: "Save routine", exact: true })
    .click();
  await expect(routineEditor).toHaveCount(0);
  expect(
    (
      await read<OccurrencePage>(
        context.request,
        `${f.base}/recurrences/${f.routine}/occurrences`,
      )
    ).total,
  ).toBe(215);
  await routines.getByRole("button", { name: "History", exact: true }).click();
  await archive
    .getByRole("button", { name: "Generated tasks", exact: true })
    .click();
  await archive
    .getByRole("searchbox", { name: "Search generated tasks", exact: true })
    .fill("Generated check 0005");
  const generatedTask = archive.getByRole("link", {
    name: "Generated check 0005",
    exact: true,
  });
  await expect(generatedTask).toBeVisible();
  await generatedTask.click();
  await expect(archive).toHaveCount(0);
  await expect(routines).toHaveCount(0);
  await expect(page).toHaveURL(/deleted=1/);
  const inspector = page.getByRole("complementary", {
    name: "Task details",
    exact: true,
  });
  await expect(inspector.getByLabel("Title", { exact: true })).toHaveValue(
    "Generated check 0005",
  );
  await expect(
    inspector.getByRole("button", { name: "Restore task", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("planning archives use all presentations, large text, short desktop, keyboard and accessibility preferences", async ({
  page,
  context,
  browserName,
}, info) => {
  test.setTimeout(240000);
  const f = await fixture(context.request),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const mode of ["light", "dark"] as const)
    for (const style of interfaceStyleIds) {
      await appearance(context.request, mode, style);
      await page.goto(f.route);
      await expect(page.locator("html")).toHaveAttribute(
        "data-interface-style",
        style,
      );
      const panel = page.getByRole("region", { name: "Workspace goals" });
      await expect(panel).toContainText("175 matching goals");
      await goalsLayout(page);
      await page.screenshot({
        path: info.outputPath(`goals-${mode}-${style}.png`),
      });
    }
  await page.setViewportSize({ width: 1280, height: 720 });
  await goalsLayout(page);
  const panel = page.getByRole("region", { name: "Workspace goals" });
  await panel
    .getByRole("searchbox", { name: "Search goals", exact: true })
    .fill("Source-only sentinel");
  await expect(panel.locator(".planning-outcome-grid > article")).toHaveCount(
    1,
  );
  await panel.getByRole("button", { name: "History", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Goal history",
    exact: true,
  });
  await expect(dialog).toContainText("1250 matching changes");
  await dialogLayout(dialog);
  expect(
    await dialog
      .locator(".planning-archive-results")
      .evaluate((el) => el.clientHeight),
  ).toBeGreaterThan(50);
  await page.screenshot({
    path: info.outputPath("history-short-desktop-large.png"),
  });
  await page.emulateMedia({
    reducedMotion: "reduce",
    ...(browserName === "chromium" ? { forcedColors: "active" as const } : {}),
  });
  await dialog
    .getByRole("searchbox", { name: "Search changes", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Search changes order")).toBeFocused();
  await dialogLayout(dialog);
  await page.screenshot({ path: info.outputPath("history-accessibility.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
