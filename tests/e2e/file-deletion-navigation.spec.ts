import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
import type { Resource, Space } from "@axiom/shared/workspace";
import type { FileOperation } from "@axiom/shared/file-workflows";

let f: Awaited<ReturnType<typeof fixture>>, space: Space;
test.beforeAll(async ({ browser }) => {
  if (origin !== "http://localhost:3004")
    throw new Error("Deletion tests require isolated staging on 3004.");
  f = await fixture(browser, "# Retained research\n\nDo not delete this note.");
  space = (await api("spaces")).find(
    (s: Space) => s.group_id === f.group.id && s.kind === "team",
  );
});
test.afterEach(async () => {
  await f.page.unrouteAll({ behavior: "ignoreErrors" });
});
test.afterAll(async () => {
  await f?.close();
});

async function api(path: string, data?: unknown) {
  const response = await f.member.request.fetch(`/api/v1/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { origin },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function create(
  kind = "note",
  parentId?: string,
  name = `Delete test ${randomUUID().slice(0, 6)}`,
): Promise<Resource> {
  return api("resources", {
    spaceId: space.id,
    kind,
    parentId,
    name,
    body: "# Temporary note\n\nContent.",
    mutationId: randomUUID(),
  });
}
const row = (page: Page, id: string) =>
  page.locator(`.sidebar-directory-row[data-directory-resource="${id}"]`);
async function openTrash(page: Page, id: string) {
  await row(page, id).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Move to trash/ }).click();
  return page.getByRole("dialog", { name: /Move to trash/ });
}
async function trash(page: Page, id: string) {
  const dialog = await openTrash(page, id);
  await dialog
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await expect(dialog).toBeHidden();
}
const folderUrl = (id?: string) =>
  `/workbench/workspaces/${space.id}/files${id ? `?folder=${id}` : ""}`;

test("deleting an open nested note replaces its URL with its parent without reloading the shell", async ({}, info) => {
  const outer = await create("folder"),
    inner = await create("folder", outer.id),
    note = await create("note", inner.id);
  const page = f.page;
  await page.goto(folderUrl(inner.id));
  await row(page, note.id)
    .getByRole("button", { name: note.name, exact: true })
    .click();
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(page.locator(".ws-document-status")).toContainText(
    "Saved on server",
  );
  await page.locator(".ws-sidebar").evaluate((element) => {
    element.setAttribute("data-delete-shell", "retained");
  });
  const historyLength = await page.evaluate(() => history.length);
  await trash(page, note.id);
  await expect(page).toHaveURL(origin + folderUrl(inner.id));
  await expect(page.locator(".ws-sidebar")).toHaveAttribute(
    "data-delete-shell",
    "retained",
  );
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await expect(
    page.getByRole("navigation", { name: "Sidebar directory path" }),
  ).toContainText(inner.name);
  await expect(
    page.getByRole("navigation", { name: "Current location", exact: true }),
  ).toContainText(inner.name);
  await expect(row(page, note.id)).toHaveCount(0);
  await expect(page.locator(".ws-error")).toHaveCount(0);
  expect((await api(`resources/${note.id}`)).deleted_at).toBeTruthy();
  await page.screenshot({
    path: info.outputPath("deleted-note-parent-folder.png"),
    animations: "disabled",
  });
});

test("root files return to workspace Files; deleting from a listing stays there and clears selection", async () => {
  const page = f.page,
    note = await create();
  await page.goto(`/workbench/notes/${note.id}`);
  await trash(page, note.id);
  await expect(page).toHaveURL(origin + folderUrl());
  const listed = await create();
  await page.goto(`/workbench/explorer?space=${space.id}&view=all`);
  const listing = page.locator(
    `.ws-resource-row[data-resource-id="${listed.id}"]`,
  );
  await listing.getByRole("checkbox").check();
  await listing.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Move to trash/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await expect(listing).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Selection actions", exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(
    origin + `/workbench/explorer?space=${space.id}&view=all`,
  );
});

test("studio files and uploaded images share the same parent navigation", async () => {
  test.setTimeout(180000);
  const parent = await create("folder"),
    page = f.page;
  for (const type of ["canvas", "math", "text", "image"]) {
    const resource = await api("files/new", {
      type,
      name: `Disposable ${type}`,
      spaceId: space.id,
      parentId: parent.id,
      mutationId: randomUUID(),
    });
    await page.goto(`/workbench/${type}/${resource.id}`);
    await expect(page.locator(".file-studio-view")).toBeVisible();
    await trash(page, resource.id);
    await expect(page).toHaveURL(origin + folderUrl(parent.id));
  }
  const id = randomUUID(),
    bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY1sAAAAASUVORK5CYII=",
      "base64",
    );
  await api("uploads", {
    id,
    spaceId: space.id,
    parentId: parent.id,
    name: "Delete image.png",
    bytes: bytes.length,
  });
  const chunk = await f.member.request.put(`/api/v1/uploads/${id}/chunks/1`, {
    headers: { origin, "content-type": "application/octet-stream" },
    data: bytes,
  });
  expect(chunk.ok()).toBe(true);
  await api(`uploads/${id}/complete`, {});
  await expect
    .poll(async () => (await api(`uploads/${id}`)).status)
    .toBe("complete");
  const resourceId = (await api(`uploads/${id}`)).resourceId;
  await page.goto(`/workbench/image/${resourceId}`);
  await expect(page.locator(".tool-preview")).toBeVisible();
  await trash(page, resourceId);
  await expect(page).toHaveURL(origin + folderUrl(parent.id));
});

test("queued work does not redirect early or pull the user back after navigating away", async () => {
  const page = f.page,
    parent = await create("folder"),
    note = await create("note", parent.id);
  let hold = true,
    reads = 0;
  await page.route("**/api/v1/file-operations/*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch(),
      result = await response.json();
    reads++;
    await route.fulfill({
      response,
      json: hold ? { ...result, status: "queued", results: [] } : result,
    });
  });
  await page.goto(`/workbench/notes/${note.id}`);
  await trash(page, note.id);
  await expect.poll(() => reads).toBeGreaterThan(1);
  await expect(page).toHaveURL(origin + `/workbench/notes/${note.id}`);
  await page
    .locator(".ws-sidebar")
    .getByRole("link", { name: "Recent", exact: true })
    .click();
  const next = page.url();
  hold = false;
  const before = reads;
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(page).toHaveURL(next);
});

for (const status of ["completed", "cancelled"] as const) {
  test(`${status} operation without a successful deletion does not change the open view`, async () => {
    const page = f.page,
      note = await create();
    let operation: FileOperation;
    await page.route("**/api/v1/file-operations", async (route) => {
      const input = route.request().postDataJSON();
      operation = {
        id: input.id,
        command: "trash",
        input,
        results: [],
        status: "queued",
        updated_at: new Date().toISOString(),
      };
      await route.fulfill({ status: 202, json: operation });
    });
    let finished = false;
    await page.route("**/api/v1/file-operations/*", async (route) => {
      await route.fulfill({
        json: {
          ...operation,
          status,
          results:
            status === "completed"
              ? [{ id: note.id, ok: false, error: "Version changed" }]
              : [],
        },
      });
      finished = true;
    });
    await page.goto(`/workbench/notes/${note.id}`);
    await trash(page, note.id);
    await expect.poll(() => finished).toBe(true);
    await expect(page).toHaveURL(origin + `/workbench/notes/${note.id}`);
    await expect(page.getByTestId("note-editor")).toBeVisible();
    expect((await api(`resources/${note.id}`)).deleted_at).toBeNull();
  });
}

test("deleting only the secondary pane closes it and retains the primary note", async () => {
  const page = f.page,
    primary = await create(),
    secondary = await create();
  await page.goto(`/workbench/notes/${primary.id}`);
  await row(page, secondary.id).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open beside", exact: true })
    .click();
  await expect(page.getByTestId("note-editor")).toHaveCount(2);
  await trash(page, secondary.id);
  await expect(
    page.getByRole("button", { name: "Close split view", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByTestId("note-editor")).toHaveCount(1);
  await expect(page).toHaveURL(origin + `/workbench/notes/${primary.id}`);
  expect((await api(`resources/${primary.id}`)).deleted_at).toBeNull();
});

test("parent navigation respects an unsaved image draft in the other pane", async () => {
  const page = f.page,
    primary = await create();
  const image = await api("files/new", {
    type: "image",
    name: "Preserve my image draft",
    spaceId: space.id,
    mutationId: randomUUID(),
  });
  await page.goto(`/workbench/notes/${primary.id}`);
  await row(page, image.id).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open beside", exact: true })
    .click();
  const add = page.getByRole("button", { name: "Add layer", exact: true });
  await expect(add).toBeEnabled();
  // Keep this genuinely unsaved: a fast cloud draft otherwise legitimately
  // removes the need for a leave guard before the delete operation completes.
  await page.route(`**/api/v1/tools/${image.id}/draft`, (route) =>
    route.request().method() === "GET"
      ? route.continue()
      : route.fulfill({
          status: 503,
          json: { error: "Draft save paused for this test" },
        }),
  );
  await add.click();
  await trash(page, primary.id);
  const guard = page.getByRole("dialog", {
    name: "Keep your image draft before leaving",
    exact: true,
  });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Stay here", exact: true }).click();
  await expect(page).toHaveURL(origin + `/workbench/notes/${primary.id}`);
  await expect(add).toBeVisible();
  await page
    .locator(".ws-sidebar")
    .getByRole("link", { name: "Recent", exact: true })
    .click();
  await guard
    .getByRole("button", { name: "Keep draft & leave", exact: true })
    .click();
  await expect(page).toHaveURL(/\/explorer\?view=recent$/);
  expect((await api(`resources/${image.id}`)).deleted_at).toBeNull();
});

test("an accepted offline deletion returns to the downloaded parent and replays online", async () => {
  test.setTimeout(90000);
  const page = f.page,
    parent = await create("folder"),
    note = await create("note", parent.id);
  await page.goto(folderUrl());
  await row(page, parent.id).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Copy & export", exact: true })
    .hover();
  await page
    .getByRole("menuitem", { name: "Available offline", exact: true })
    .click();
  await expect(page.locator(".ws-notice")).toContainText(
    "Selected work is available offline",
    { timeout: 30000 },
  );
  await row(page, parent.id)
    .getByRole("link", { name: parent.name, exact: true })
    .click();
  await row(page, note.id)
    .getByRole("button", { name: note.name, exact: true })
    .click();
  await expect(page.locator(".ws-document-status")).toContainText(
    "Saved on server",
  );
  // Warm the operation UI before taking the already-open application offline.
  await (
    await openTrash(page, note.id)
  )
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await f.member.setOffline(true);
  try {
    await trash(page, note.id);
    await expect(page).toHaveURL(origin + folderUrl(parent.id));
    await expect(row(page, note.id)).toHaveCount(0);
  } finally {
    await f.member.setOffline(false);
  }
  await expect
    .poll(async () => (await api(`resources/${note.id}`)).deleted_at, {
      timeout: 30000,
    })
    .toBeTruthy();
});
