import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { config } from "dotenv";
import { signInOwner } from "./auth";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
import {
  interfaceStyleIds,
  type InterfaceStyleId,
} from "../../packages/shared/src/interface-styles";
config({ quiet: true });
const pg = createRequire(import.meta.url)("pg") as typeof import("pg");
const origin = "http://localhost:3004";
test.use({
  trace: "off",
  extraHTTPHeaders: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
});
async function write(
  request: APIRequestContext,
  path: string,
  input: Record<string, unknown>,
  method = "POST",
) {
  const response = await request.fetch(`/api/v1/${path}`, {
    method,
    headers: { origin },
    data: { mutationId: randomUUID(), ...input },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function read(request: APIRequestContext, path: string) {
  const response = await request.get(`/api/v1/${path}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function fixture(request: APIRequestContext) {
  if (process.env.TEST_APP_URL !== origin)
    throw new Error("Use isolated planning.config.ts.");
  const login = await signInOwner(request, origin);
  expect(login.ok(), await login.text()).toBeTruthy();
  const group = await write(request, "groups", {
    name: `Intake acceptance ${randomUUID().slice(0, 8)}`,
  });
  const workspace = await write(request, "spaces", {
    groupId: group.id,
    name: "Research requests · field studies",
    audience: "group",
  });
  const configured = new URL(process.env.DATABASE_URL ?? "");
  if (
    !["127.0.0.1", "localhost"].includes(configured.hostname) ||
    configured.pathname === "/axiom_plugins_test" ||
    process.env.NODE_ENV === "production"
  )
    throw new Error("Never seed the configured or production dataset.");
  configured.pathname = "/axiom_plugins_test";
  const db = new pg.Client({ connectionString: configured.href });
  await db.connect();
  try {
    const rows = (
      await db.query(
        'SELECT s.id,u.id AS owner FROM spaces s JOIN "user" u ON u.email=$2 WHERE s.id=$1 AND axiom_manage_space(u.id,s.id)',
        [workspace.space_id, "extensions@axiom.local"],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    const collaborator = `intake-fixture-${randomUUID()}`;
    await db.query(
      "INSERT INTO \"user\"(id,name,email) VALUES($1,'Fixture collaborator',$2)",
      [collaborator, `${collaborator}@axiom.test`],
    );
    await db.query(
      "INSERT INTO members(group_id,user_id,role,content_role) VALUES($1,$2,'member','editor')",
      [group.id, collaborator],
    );
    await db.query(
      `INSERT INTO planning_intake(space_id,created_by,kind,title,body,status,decision_note,reviewed_by,created_at)
      SELECT $1,CASE WHEN n%4=0 THEN $3 ELSE $2 END,(ARRAY['research','experiment','paper-review','data-request'])[1+n%4],
      'Research intake '||lpad(n::text,4,'0')||CASE WHEN n=222 THEN ' · Coupled multi-physics experiments, reproducible dataset provenance and uncertainty quantification for the next research cohort' ELSE '' END,
      CASE WHEN n=1 THEN '# Evidence\n\nSource-only sentinel.\n\nDisplay equation: $$E=mc^2$$' ELSE 'Private research evidence '||n END,
      CASE WHEN n<=215 THEN 'pending' WHEN n<=222 THEN 'needs-changes' ELSE 'accepted' END,
      CASE WHEN n>215 THEN 'Review control groups and data provenance before preparing the next phase of this research.' ELSE '' END,$2,
      now()-interval '1 hour'+n*interval '1 second' FROM generate_series(1,235) n`,
      [workspace.space_id, rows[0].owner, collaborator],
    );
  } finally {
    await db.end();
  }
  return {
    id: workspace.space_id,
    base: `spaces/${workspace.space_id}/intake`,
    route: `/workbench/workspaces/${workspace.space_id}/planning?section=intake`,
  };
}
async function appearance(
  request: APIRequestContext,
  mode: "light" | "dark",
  interfaceStyle: InterfaceStyleId,
  large = false,
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
        uiSize: large ? 22 : 15,
        radius: large ? 0 : 12,
        shadows: large ? "none" : "soft",
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}
async function layout(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const panel = page.getByRole("region", { name: "Research intake" });
  expect(
    await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  for (const control of [
    panel.getByRole("searchbox", { name: "Search requests", exact: true }),
    panel.getByLabel("Request filter"),
    panel.getByRole("button", { name: "Submit request", exact: true }),
    panel.getByRole("button", { name: "Next", exact: true }),
  ]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(25);
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
  }
  expect(
    await panel
      .locator(".planning-request-list")
      .evaluate((el) => el.clientHeight),
  ).toBeGreaterThan(60);
  await expect(panel.locator(".planning-request-title").first()).toHaveCSS(
    "text-align",
    "left",
  );
}
test("request archives beyond 200, server filters and retained stale draft", async ({
  page,
  context,
}) => {
  const f = await fixture(context.request),
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(f.route);
  const panel = page.getByRole("region", { name: "Research intake" });
  await expect(panel.getByRole("status")).toContainText(
    "222 matching requests",
  );
  await panel.getByRole("button", { name: /^Filters/ }).click();
  let filters = page.getByRole("dialog", {
    name: "Filter research requests",
    exact: true,
  });
  await filters.getByLabel("My requests only", { exact: true }).check();
  await filters
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "167 matching requests",
  );
  await panel.getByRole("button", { name: /^Filters/ }).click();
  filters = page.getByRole("dialog", {
    name: "Filter research requests",
    exact: true,
  });
  await filters.getByLabel("My requests only", { exact: true }).uncheck();
  await filters
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "222 matching requests",
  );
  await expect(panel.locator(".planning-request-list > article")).toHaveCount(
    30,
  );
  const response = await read(context.request, f.base + "?filter=open");
  expect(response.items[0]).not.toHaveProperty("body");
  await panel.getByLabel("Requests per page").selectOption("15");
  await expect(panel.locator(".planning-request-list > article")).toHaveCount(
    15,
  );
  await panel.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    panel.getByRole("navigation", { name: "Request pages" }),
  ).toContainText("Page 2");
  await expect(
    panel.getByRole("button", { name: "Previous", exact: true }),
  ).toBeEnabled();
  await panel.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(
    panel.getByRole("navigation", { name: "Request pages" }),
  ).toContainText("Page 1");
  await panel
    .getByRole("searchbox", { name: "Search requests", exact: true })
    .fill("Source-only sentinel");
  await expect(panel.getByRole("status")).toContainText("1 matching request");
  await panel
    .getByRole("button", { name: "Research intake 0001", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Request details",
    exact: true,
  });
  await expect(dialog).toContainText("Source-only sentinel");
  await expect(dialog.getByLabel("Request", { exact: true })).toHaveValue(
    "Research intake 0001",
  );
  await dialog
    .getByLabel("Request", { exact: true })
    .fill("My retained local draft");
  const found = await read(
    context.request,
    f.base + "?q=Source-only%20sentinel",
  );
  await write(
    context.request,
    `${f.base}/${found.items[0].id}`,
    {
      version: found.items[0].version,
      title: "Research intake 0001 · peer updated",
    },
    "PATCH",
  );
  await expect(dialog).toContainText(
    "This request changed while you were viewing it",
  );
  await expect(dialog.getByLabel("Request", { exact: true })).toHaveValue(
    "My retained local draft",
  );
  await expect(
    dialog.getByRole("button", { name: "Resubmit", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const guard = page.getByRole("dialog", {
    name: "Unsaved request",
    exact: true,
  });
  await expect(guard).toBeVisible();
  await guard
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Clear search", exact: true })
    .click();
  await panel.getByLabel("Request filter").selectOption("history");
  await expect(panel.getByRole("status")).toContainText("13 matching requests");
  await panel
    .locator(".planning-request-list > article")
    .first()
    .locator(".planning-request-title")
    .click();
  const archiveDetail = page.getByRole("dialog", {
    name: "Request details",
    exact: true,
  });
  await expect(
    archiveDetail.getByRole("button", { name: "Preview", exact: true }),
  ).toBeVisible();
  await archiveDetail
    .getByRole("button", { name: "Source", exact: true })
    .click();
  await expect(archiveDetail.getByTestId("task-description")).toContainText(
    "Private research evidence",
  );
  await expect(
    archiveDetail.getByLabel("Request", { exact: true }),
  ).toBeDisabled();
  await archiveDetail
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await panel.getByRole("button", { name: /^Filters/ }).click();
  await filters.getByLabel("Request type").selectOption("paper-review");
  await filters
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(panel.locator(".planning-request-list > article")).toHaveCount(
    3,
  );
  await panel
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "222 matching requests",
  );
  await panel.getByRole("button", { name: /^Filters/ }).click();
  await filters.getByLabel("Request order").selectOption("oldest");
  await filters
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    panel.locator(".planning-request-list > article").first(),
  ).toContainText("0001 · peer updated");
  await layout(page);
  expect(errors).toEqual([]);
});

test("intake and review dialogs remain tidy across all interface styles and accessibility modes", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180000);
  const f = await fixture(context.request),
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const mode of ["light", "dark"] as const)
    for (const style of interfaceStyleIds) {
      await appearance(context.request, mode, style, true);
      await page.goto(f.route);
      await expect(page.locator("html")).toHaveAttribute(
        "data-interface-style",
        style,
      );
      await expect(
        page
          .getByRole("region", { name: "Research intake" })
          .getByRole("status"),
      ).toContainText("222 matching requests");
      await layout(page);
      await page.screenshot({
        path: info.outputPath(`intake-${mode}-${style}.png`),
      });
    }
  const panel = page.getByRole("region", { name: "Research intake" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await layout(page);
  await page.screenshot({
    path: info.outputPath("intake-short-desktop-large.png"),
  });
  await panel
    .locator(".planning-request-list > article")
    .filter({ has: page.getByRole("button", { name: "Review", exact: true }) })
    .first()
    .getByRole("button", { name: "Review", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review research request",
    exact: true,
  });
  await expect(
    review.getByRole("button", { name: "Save decision", exact: true }),
  ).toBeEnabled();
  await review
    .getByLabel("Decision", { exact: true })
    .selectOption("needs-changes");
  await review.getByLabel("Review note").fill("Specify the control cohort.");
  const footer = review.locator(".dialog-footer");
  await expect(footer).toBeVisible();
  expect(await footer.evaluate((el) => !el.closest(".dialog-body"))).toBe(true);
  const bounds = await review.boundingBox(),
    action = await footer.boundingBox();
  expect(action!.y + action!.height).toBeLessThanOrEqual(
    bounds!.y + bounds!.height,
  );
  await page.screenshot({
    path: info.outputPath("intake-review-large-dark.png"),
  });
  await review
    .getByRole("button", { name: "Save decision", exact: true })
    .click();
  await expect(review).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  const creation = page.getByRole("dialog", {
    name: "New research request",
    exact: true,
  });
  await expect(creation.getByLabel("Request", { exact: true })).toBeFocused();
  await creation
    .getByLabel("Request", { exact: true })
    .fill("Keyboard-created research request");
  await creation
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  await expect(creation).toHaveCount(0);
  await expect(panel.getByRole("status")).toContainText(
    "223 matching requests",
  );
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await panel
    .getByRole("searchbox", { name: "Search requests", exact: true })
    .focus();
  await expect(
    panel.getByRole("searchbox", { name: "Search requests", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(panel.getByLabel("Request filter")).toBeFocused();
  await layout(page);
  await page.screenshot({ path: info.outputPath("intake-forced-colors.png") });
  expect(errors).toEqual([]);
});
