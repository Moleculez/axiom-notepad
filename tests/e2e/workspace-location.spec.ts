import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
import type {
  Resource,
  ResourceLocation,
  Space,
} from "../../packages/shared/src/workspace";

let f: Awaited<ReturnType<typeof fixture>>, space: Space;
async function api(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const response = await request.fetch(`/api/v1/${path}`, {
    method,
    data,
    headers: { origin },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test.beforeAll(async ({ browser }) => {
  test.setTimeout(90000);
  if (origin !== "http://localhost:3002")
    throw new Error("Location tests must use isolated 3002 storage/database.");
  f = await fixture(browser, "# Location test fixture\n");
  space = (await api(f.member.request, "spaces")).find(
    (s: Space) => s.group_id === f.group.id && s.kind === "team",
  );
});
test.afterAll(async () => {
  await f?.close();
});
async function tree() {
  const folders: Resource[] = [];
  for (const name of [
    "Experiments & theory",
    "量子 optics",
    "Run " + randomUUID().slice(0, 6),
  ]) {
    folders.push(
      await api(f.member.request, "resources", {
        spaceId: space.id,
        parentId: folders.at(-1)?.id,
        kind: "folder",
        name,
        mutationId: randomUUID(),
      }),
    );
  }
  const note: Resource = await api(f.member.request, "resources", {
    spaceId: space.id,
    parentId: folders.at(-1)!.id,
    kind: "note",
    name: "Nested derivation",
    body: "# Boundary conditions\n\nSource must remain intact.\n",
    mutationId: randomUUID(),
  });
  return { folders, note };
}
async function upload(parentId: string) {
  const id = randomUUID(),
    content = Buffer.from("experiment,value\nalpha,42\nbeta,84\n");
  await api(f.member.request, "uploads", {
    id,
    spaceId: space.id,
    parentId,
    name: "Observations.txt",
    bytes: content.length,
  });
  const chunk = await f.member.request.put(`/api/v1/uploads/${id}/chunks/1`, {
    headers: { origin, "content-type": "application/octet-stream" },
    data: content,
  });
  expect(chunk.ok(), await chunk.text()).toBeTruthy();
  await api(f.member.request, `uploads/${id}/complete`, {});
  await expect
    .poll(async () => (await api(f.member.request, `uploads/${id}`)).status, {
      timeout: 30000,
    })
    .toBe("complete");
  const result = await api(f.member.request, `uploads/${id}`);
  return (await api(
    f.member.request,
    `resources/${result.resourceId}`,
  )) as Resource;
}

test("direct nested notes show the full path; ancestor, Up and Back links open real folders", async ({}, info) => {
  const { folders, note } = await tree(),
    page = f.page;
  const response: ResourceLocation = await api(
    f.member.request,
    `resources/${note.id}/location`,
  );
  expect(response.ancestors.map((r) => r.id)).toEqual(folders.map((r) => r.id));
  await page.goto(`/workbench/notes/${note.id}`);
  const nav = page.getByRole("navigation", {
    name: "Current location",
    exact: true,
  });
  await expect(nav.getByRole("link")).toHaveText([
    "Research notes",
    space.name,
    ...folders.map((folder) => folder.name),
  ]);
  await expect(nav.locator('[aria-current="page"]')).toHaveText(note.name);
  for (const folder of folders)
    await expect(
      nav.getByRole("link", { name: folder.name, exact: true }),
    ).toHaveAttribute(
      "href",
      `/workbench/explorer?space=${space.id}&folder=${folder.id}`,
    );
  await page.screenshot({
    path: info.outputPath("nested-note-breadcrumbs.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Up one level" }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${folders[2].id}`));
  await expect(nav.locator('[aria-current="page"]')).toHaveText(
    folders[2].name,
  );
  await page.getByRole("button", { name: "Up one level" }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${folders[1].id}`));
  await page.getByRole("button", { name: "Back in tab" }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${folders[2].id}`));
  // Opening a parent keeps the document in its own tab; Explorer history is separate.
  await page.getByRole("button", { name: "Forward in tab" }).click();
  await expect(page).toHaveURL(new RegExp(`folder=${folders[1].id}`));
  await page.getByRole("tab", { name: note.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/notes/${note.id}$`));
  await nav.getByRole("link", { name: "Research notes", exact: true }).click();
  await expect(page).toHaveURL(/\/explorer\?kind=note&view=all$/);
  await expect(
    page.locator(`.ws-resource-row[data-resource-id="${note.id}"]`),
  ).toBeVisible();
  await expect(page.locator(".ws-error")).toHaveCount(0);
  expect((await api(f.member.request, `notes/${note.id}`)).body).toContain(
    "Source must remain intact.",
  );
});

test("nested versioned files use borderless previews and refresh the trail after folder moves and renames", async ({}, info) => {
  test.setTimeout(90000);
  const { folders } = await tree(),
    file = await upload(folders[2].id),
    page = f.page;
  await page.goto(
    `/workbench/files/${file.id}?version=${file.current_version_id}`,
  );
  await expect(page.locator(".text-preview-lines")).toContainText("alpha,42");
  const nav = page.getByRole("navigation", {
    name: "Current location",
    exact: true,
  });
  await expect(nav.getByRole("link")).toHaveText([
    "Files",
    space.name,
    ...folders.map((folder) => folder.name),
  ]);
  await expect(nav.locator('[aria-current="page"]')).toHaveText(file.name);
  await expect(page.locator(".tool-preview")).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await expect(page.locator(".tool-preview")).toHaveCSS("border-radius", "0px");
  await page.screenshot({
    path: info.outputPath("borderless-file-preview.png"),
    animations: "disabled",
  });
  const destination: Resource = await api(f.member.request, "resources", {
    spaceId: space.id,
    kind: "folder",
    name: "Processed results",
    mutationId: randomUUID(),
  });
  await api(
    f.member.request,
    `resources/${folders[2].id}`,
    { version: folders[2].version, parentId: destination.id },
    "PATCH",
  );
  await expect(
    nav.getByRole("link", { name: destination.name, exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: folders[0].name, exact: true }),
  ).toHaveCount(0);
  await api(
    f.member.request,
    `resources/${destination.id}`,
    { version: destination.version, name: "Publication figures" },
    "PATCH",
  );
  await expect(
    nav.getByRole("link", { name: "Publication figures", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Up one level" }).click();
  await expect(nav.getByRole("link")).toHaveText([
    "Explorer",
    space.name,
    "Publication figures",
  ]);
  await nav
    .getByRole("link", { name: "Publication figures", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`folder=${destination.id}$`));
  await expect(page.locator(".ws-error")).toHaveCount(0);
});

test("legacy collection bookmarks no longer fetch missing documents, and studio projects retain their folder path", async () => {
  const page = f.page,
    failed: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/v1\/(notes|resources)\/undefined/.test(request.url()))
      failed.push(request.url());
  });
  for (const [path, kind] of [
    ["notes", "note"],
    ["files", "file"],
  ]) {
    await page.goto(`/workbench/${path}`);
    await expect(page).toHaveURL(
      new RegExp(`/explorer\\?kind=${kind}&view=all$`),
    );
    await expect(page.locator(".ws-error")).toHaveCount(0);
  }
  const { folders } = await tree();
  const project = await api(f.member.request, "tools", {
    kind: "math",
    name: "Nested equation",
    spaceId: space.id,
    source: "E = mc^2",
    mutationId: randomUUID(),
  });
  const resource = await api(f.member.request, `resources/${project.id}`);
  await api(
    f.member.request,
    `resources/${project.id}`,
    { version: resource.version, parentId: folders[2].id },
    "PATCH",
  );
  await page.goto(`/workbench/tools/math/${project.id}`);
  const nav = page.getByRole("navigation", {
    name: "Current location",
    exact: true,
  });
  await expect(nav.getByRole("link")).toHaveText([
    "Research tools",
    space.name,
    ...folders.map((r) => r.name),
  ]);
  await expect(nav.locator('[aria-current="page"]')).toHaveText(
    "Nested equation",
  );
  await nav.getByRole("link", { name: "Research tools", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tools", exact: true }),
  ).toBeVisible();
  expect(failed).toEqual([]);
});

test("location API does not disclose private ancestors or trashed resource paths", async () => {
  const personal: Space = (await api(f.owner.request, "spaces")).find(
    (s: Space) => s.kind === "personal",
  );
  const folder = await api(f.owner.request, "resources", {
    spaceId: personal.id,
    kind: "folder",
    name: "Private folder " + randomUUID(),
    mutationId: randomUUID(),
  });
  const note = await api(f.owner.request, "resources", {
    spaceId: personal.id,
    parentId: folder.id,
    kind: "note",
    name: "Private results",
    mutationId: randomUUID(),
  });
  const denied = await f.member.request.get(
    `/api/v1/resources/${note.id}/location`,
  );
  expect(denied.status()).toBe(404);
  expect(await denied.text()).not.toContain(folder.name);
  const { note: shared } = await tree();
  await api(f.member.request, `resources/${shared.id}/trash`, {
    version: shared.version,
    mutationId: randomUUID(),
  });
  expect(
    (
      await f.member.request.get(`/api/v1/resources/${shared.id}/location`)
    ).status(),
  ).toBe(404);
});

test("selection actions only appear for selected items without shifting list or grid files", async ({}, info) => {
  const { folders, note } = await tree(),
    page = f.page,
    folder = folders[2];
  const child: Resource = await api(f.member.request, "resources", {
    spaceId: space.id,
    parentId: folder.id,
    kind: "folder",
    name: "Attachments",
    mutationId: randomUUID(),
  });
  await page.goto(`/workbench/explorer?space=${space.id}&folder=${folder.id}`);
  const actions = page.getByRole("region", {
      name: "Selection actions",
      exact: true,
    }),
    search = page.getByRole("textbox", { name: "Search files and notes" }),
    items = page.getByLabel("Explorer items", { exact: true }),
    row = page.locator(`.ws-resource-row[data-resource-id="${note.id}"]`),
    checkbox = row.getByRole("checkbox"),
    selectAll = page.getByRole("checkbox", {
      name: "Select all items on this page",
    }),
    childRow = page.locator(`.ws-resource-row[data-resource-id="${child.id}"]`);
  // Workspace permissions/breadcrumbs load independently of the file query.
  await expect(
    page.getByRole("navigation", { name: "Folder breadcrumbs", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(row).toBeVisible();
  await expect(actions).toHaveCount(0);
  await expect(search).toBeVisible();
  const initialY = (await row.boundingBox())!.y;
  await page.screenshot({
    path: info.outputPath("explorer-no-selection.png"),
    animations: "disabled",
  });

  await row.locator(".ws-resource-name").click();
  await expect(actions).toContainText("1 selected");
  await expect(search).toBeHidden();
  await expect(
    page.locator(".explorer-toolbar-slot > .ws-list-toolbar"),
  ).toHaveAttribute("inert", "");
  expect((await row.boundingBox())!.y).toBeCloseTo(initialY, 1);
  await page.screenshot({
    path: info.outputPath("explorer-selection-actions.png"),
    animations: "disabled",
  });
  await actions.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(actions).toHaveCount(0);
  await expect(search).toBeVisible();
  await expect(items).toBeFocused();
  expect((await row.boundingBox())!.y).toBeCloseTo(initialY, 1);

  await checkbox.check();
  await expect(actions).toContainText("1 selected");
  await checkbox.uncheck();
  await expect(actions).toHaveCount(0);
  await selectAll.check();
  await expect(actions).toContainText("2 selected");
  await selectAll.uncheck();
  await expect(actions).toHaveCount(0);

  await items.press("ControlOrMeta+a");
  await expect(actions).toContainText("2 selected");
  await actions
    .getByRole("button", { name: "Copy", exact: true })
    .press("Escape");
  await expect(actions).toHaveCount(0);
  await expect(items).toBeFocused();
  await checkbox.check();
  await checkbox.press("Escape");
  await expect(actions).toHaveCount(0);

  // Grid selection uses the same stationary contextual toolbar.
  await page.getByRole("button", { name: "Grid view", exact: true }).click();
  await expect(page.locator(".ws-resource-grid")).toBeVisible();
  const gridY = (await row.boundingBox())!.y;
  await row.locator(".ws-resource-name").click();
  await expect(actions).toContainText("1 selected");
  expect((await row.boundingBox())!.y).toBeCloseTo(gridY, 1);
  await actions.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(actions).toHaveCount(0);
  await page.getByRole("button", { name: "List view", exact: true }).click();

  // The first click must not move the second click away from the folder.
  await childRow.locator(".ws-resource-name").dblclick();
  await expect(page).toHaveURL(new RegExp(`folder=${child.id}$`));
  await expect(actions).toHaveCount(0);
  await expect(search).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "A little room to think" }),
  ).toBeVisible();
});
