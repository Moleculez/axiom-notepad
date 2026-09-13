import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
let f: Awaited<ReturnType<typeof fixture>>, spaceId: string, folderId: string;
const projects = new Map<string, { id: string; name: string }>();
async function call(request: APIRequestContext, path: string, data?: unknown) {
  const response = await request.fetch(`/api/v1/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { origin },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120000);
  if (origin !== "http://localhost:3004")
    throw new Error(
      "File-first acceptance uses only isolated staging on 3004.",
    );
  f = await fixture(
    browser,
    "# Stable research\n\nThis document must stay unchanged.\n",
  );
  const spaces = await call(f.member.request, "spaces");
  spaceId = spaces.find(
    (space: any) => space.group_id === f.group.id && space.kind === "team",
  ).id;
  folderId = (
    await call(f.member.request, "resources", {
      kind: "folder",
      name: "File-first experiments",
      spaceId,
      mutationId: randomUUID(),
    })
  ).id;
  for (const type of ["math", "canvas", "text", "image"]) {
    const name = `Research ${type}`;
    const project = await call(f.member.request, "files/new", {
      type,
      name,
      spaceId,
      parentId: folderId,
      mutationId: randomUUID(),
      ...(type === "math" ? { source: "x^2 + y^2" } : {}),
    });
    projects.set(type, { id: project.id, name });
  }
});
test.afterAll(async () => {
  await f?.close();
});

test("legacy studio links open typed file views with hierarchy, sharing, and no project-list fetch", async ({}, info) => {
  test.setTimeout(120000);
  const requests: string[] = [];
  f.page.on("request", (request) => {
    if (request.method() === "GET")
      requests.push(new URL(request.url()).pathname);
  });
  for (const type of ["math", "canvas", "text", "image"]) {
    const file = projects.get(type)!;
    await f.page.goto(`/workbench/tools/${type}/${file.id}`);
    await expect(f.page).toHaveURL(
      new RegExp(`/workbench/${type}/${file.id}$`),
    );
    await expect(f.page.locator(".file-studio-view")).toBeVisible();
    await expect(f.page.locator(".file-studio-view h1")).toContainText(
      file.name,
    );
    await expect(
      f.page.getByRole("button", { name: "Share", exact: true }),
    ).toBeVisible();
    const crumbs = f.page.getByRole("navigation", { name: "Location" });
    await expect(crumbs).toContainText("File-first experiments");
    await expect(
      f.page.locator(`[data-tree-resource="${file.id}"]`),
    ).toHaveClass(/active/);
  }
  expect(requests.filter((path) => path === "/api/v1/tools")).toEqual([]);
  await f.page.screenshot({ path: info.outputPath("image-file-view.png") });
  expect(await f.source()).toBe(
    "# Stable research\n\nThis document must stay unchanged.\n",
  );
});

test("creation menus offer peer file types and replace legacy creation pages with a dialog", async ({}, info) => {
  const page = f.page;
  await page.goto(`/workbench/explorer?space=${spaceId}&folder=${folderId}`);
  await page.getByRole("button", { name: "New", exact: true }).click();
  for (const name of [
    /New note/,
    /New canvas/,
    /New math project/,
    /New drawing/,
    /New plain text/,
  ])
    await expect(page.getByRole("menuitem", { name })).toBeVisible();
  await page.getByRole("menuitem", { name: /New canvas/ }).click();
  let dialog = page.getByRole("dialog", { name: "New canvas" });
  await expect(
    dialog.getByText("File-first experiments", { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Name", { exact: true }).fill("Created beside notes");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/workbench\/canvas\/[\da-f-]{36}$/);
  await expect(page.locator(".canvas-header h1")).toHaveText(
    "Created beside notes",
  );
  const createdId = new URL(page.url()).pathname.split("/").at(-1)!;
  expect(
    (await call(f.member.request, `resources/${createdId}`)).parent_id,
  ).toBe(folderId);
  await page.goto(
    `/workbench/tools/math/new?space=${spaceId}&folder=${folderId}`,
  );
  dialog = page.getByRole("dialog", { name: "New math project" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/workbench\/explorer\?/);
  await page.screenshot({ path: info.outputPath("create-file-dialog.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(
    await page.locator(".application-tab").allTextContents(),
  ).not.toContain("New math project");
});

test("one sidebar remains mounted across Settings and administration without losing drafts", async ({}, info) => {
  const page = f.page;
  await page.goto(`/workbench/explorer?space=${spaceId}&folder=${folderId}`);
  const sidebar = page.getByRole("complementary", {
    name: "Workspace navigation",
  });
  await expect(
    sidebar.getByRole("navigation", { name: "Administration" }),
  ).toBeVisible();
  await sidebar.evaluate((element) => {
    (element as HTMLElement).dataset.acceptanceIdentity = "retained";
  });
  await page.evaluate(() => document.dispatchEvent(new Event("noop")));
  await page.getByRole("button", { name: "Workspace pages" }).click();
  await page
    .getByRole("button", { name: /Settings Make the workspace yours/ })
    .click();
  await expect(sidebar).toHaveAttribute("data-acceptance-identity", "retained");
  const nav = page.getByRole("navigation", { name: "Settings categories" });
  await nav.getByRole("link", { name: "Account", exact: true }).click();
  await nav.getByRole("link", { name: "Profile", exact: true }).click();
  await page
    .getByLabel("Full name", { exact: true })
    .fill("Retained file-first draft");
  await sidebar.getByRole("link", { name: "Workspaces", exact: true }).click();
  await expect(sidebar).toHaveAttribute("data-acceptance-identity", "retained");
  await expect(sidebar.getByText("Your spaces", { exact: true })).toBeVisible();
  await expect(
    sidebar.getByText("Create workspace", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
    "Retained file-first draft",
  );
  await page
    .getByRole("button", { name: "Cancel changes", exact: true })
    .click();
  await nav.getByRole("link", { name: "Appearance", exact: true }).click();
  await expect(page.locator(".settings-scratchpad")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("settings-persistent-sidebar.png"),
  });
});

test("sharing has canonical selectable links, inherited roles, and keyboard focus restoration", async ({}, info) => {
  const file = projects.get("math")!;
  const page = f.page;
  await page.goto(`/workbench/math/${file.id}`);
  const trigger = page.getByRole("button", { name: "Share", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Sharing & collaboration" });
  await expect(dialog.getByLabel("Link to this file")).toHaveValue(
    `${origin}/workbench/math/${file.id}`,
  );
  await expect(
    dialog.getByRole("list", { name: "People with access" }),
  ).toContainText("Native Researcher");
  await expect(dialog.getByText("Restricted", { exact: true })).toBeVisible();
  await dialog.getByLabel("Find a collaborator").fill("no such researcher");
  await expect(dialog.getByText("No matching collaborators.")).toBeVisible();
  await dialog.getByLabel("Find a collaborator").fill("");
  await expect(
    dialog.getByRole("list", { name: "People with access" }),
  ).toContainText("Native Researcher");
  await page.screenshot({ path: info.outputPath("sharing-dialog.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("canvas dialogs keep actions visible and checkbox labels aligned", async ({}, info) => {
  const page = f.page;
  await page.goto(`/workbench/canvas/${projects.get("canvas")!.id}`);
  await page
    .getByRole("button", { name: "Export canvas", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Export canvas" });
  await dialog.getByLabel("Export format").selectOption("pdf");
  const alignment = await dialog
    .locator('label:has(input[type="checkbox"])')
    .evaluateAll((labels) =>
      labels.map((label) => {
        const box = label.getBoundingClientRect(),
          input = label.querySelector("input")!.getBoundingClientRect();
        return {
          width: input.width,
          distance: Math.abs(
            (box.top + box.bottom) / 2 - (input.top + input.bottom) / 2,
          ),
        };
      }),
    );
  for (const row of alignment) {
    expect(row.width).toBeLessThan(32);
    expect(row.distance).toBeLessThan(3);
  }
  const footer = dialog.locator(":scope > .dialog-footer");
  await expect(footer).toBeVisible();
  const top = (await footer.boundingBox())!.y;
  await dialog.locator(":scope > .dialog-body").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect((await footer.boundingBox())!.y).toBeCloseTo(top, 0);
  await page.screenshot({ path: info.outputPath("canvas-export-dialog.png") });
  await page.keyboard.press("Escape");
});
