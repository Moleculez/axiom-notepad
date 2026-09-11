import { test, expect, type APIRequestContext } from "@playwright/test";
import { fixture, origin } from "./native-editor-helpers";
import type { Space } from "@axiom/shared/workspace";

async function create(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post("/api/v1/" + path, {
    headers: { origin },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test("clicking the selected workspace name reopens its tree and shows notes", async ({
  browser,
}) => {
  const f = await fixture(browser, "Sidebar source stays unchanged.");
  try {
    const spaces: Space[] = await (
      await f.member.request.get("/api/v1/spaces")
    ).json();
    const space = spaces.find(
      (s) => s.kind === "team" && s.group_id === f.group.id,
    )!;
    await f.page.goto(`/workbench/explorer?space=${space.id}`);
    const tree = f.page.locator(".ws-tree");
    await tree
      .getByRole("button", { name: `Collapse ${space.name}`, exact: true })
      .click();
    await tree.getByRole("link", { name: space.name, exact: true }).click();
    await expect(
      tree.getByRole("button", { name: `Collapse ${space.name}`, exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await tree
      .getByRole("button", { name: "Native editor study", exact: true })
      .click();
    await expect(f.page).toHaveURL(new RegExp(`/notes/${f.note.id}$`));
    await expect(f.page.getByTestId("note-editor")).toContainText(
      "Sidebar source stays unchanged.",
    );
    await expect(
      tree.getByRole("button", { name: "Native editor study", exact: true }),
    ).toBeVisible();
    expect(await f.source()).toBe("Sidebar source stays unchanged.");
  } finally {
    await f.close();
  }
});

test("nested folder label clicks expand children while chevrons and keyboard navigation remain independent", async ({
  browser,
}) => {
  const f = await fixture(browser, "Unchanged root note.");
  try {
    const spaces: Space[] = await (
      await f.member.request.get("/api/v1/spaces")
    ).json();
    const space = spaces.find(
      (s) => s.kind === "team" && s.group_id === f.group.id,
    )!;
    const parent = await create(f.member.request, "resources", {
      spaceId: space.id,
      kind: "folder",
      name: "Experiments",
    });
    const child = await create(f.member.request, "resources", {
      spaceId: space.id,
      parentId: parent.id,
      kind: "folder",
      name: "Run one",
    });
    const note = await create(f.member.request, "resources", {
      spaceId: space.id,
      parentId: child.id,
      kind: "note",
      name: "Observations",
    });
    await f.page.goto(`/workbench/explorer?space=${space.id}`);
    const tree = f.page.locator(".ws-tree");
    await tree.getByRole("link", { name: "Experiments", exact: true }).click();
    await expect(f.page).toHaveURL(new RegExp(`folder=${parent.id}$`));
    await expect(
      tree.getByRole("link", { name: "Run one", exact: true }),
    ).toBeVisible();
    await tree.getByRole("link", { name: "Run one", exact: true }).click();
    await expect(
      tree.getByRole("button", { name: "Observations", exact: true }),
    ).toBeVisible();
    await tree
      .getByRole("button", { name: "Collapse Run one", exact: true })
      .click();
    await expect(
      tree.getByRole("button", { name: "Observations", exact: true }),
    ).toHaveCount(0);
    await expect(f.page).toHaveURL(new RegExp(`folder=${child.id}$`));
    // Reopening the already-selected location must not rely on a URL change.
    await tree.getByRole("link", { name: "Run one", exact: true }).click();
    const row = tree.locator(".ws-tree-row").filter({
      has: f.page.getByRole("link", { name: "Run one", exact: true }),
    });
    await row.focus();
    await f.page.keyboard.press("ArrowLeft");
    await expect(
      tree.getByRole("button", { name: "Observations", exact: true }),
    ).toHaveCount(0);
    await f.page.keyboard.press("ArrowRight");
    await expect(
      tree.getByRole("button", { name: "Observations", exact: true }),
    ).toBeVisible();
    await f.page.keyboard.press("ArrowRight");
    const noteRow = tree.locator(".ws-tree-row").filter({
      has: f.page.getByRole("button", { name: "Observations", exact: true }),
    });
    await expect(noteRow).toBeFocused();
    await f.page.keyboard.press("Shift+F10");
    await expect(
      f.page.getByRole("menuitem", { name: "Open", exact: true }),
    ).toBeVisible();
    await f.page.keyboard.press("Escape");
    await expect(noteRow).toBeFocused();
    await f.page.keyboard.press("Enter");
    await expect(f.page).toHaveURL(new RegExp(`/notes/${note.note_id}$`));
    await expect(f.page.getByLabel("Note title", { exact: true })).toHaveValue(
      "Observations",
    );
    expect(await f.source()).toBe("Unchanged root note.");
  } finally {
    await f.close();
  }
});

test("workspace branches show uploaded files, empty projects and retryable load errors", async ({
  browser,
}) => {
  const f = await fixture(browser, "Files are listed without rewriting notes.");
  try {
    const spaces: Space[] = await (
      await f.member.request.get("/api/v1/spaces")
    ).json();
    const space = spaces.find(
      (s) => s.kind === "team" && s.group_id === f.group.id,
    )!;
    const response = await f.member.request.post(
      `/api/v1/notes/${f.note.id}/attachments`,
      {
        headers: { origin },
        multipart: {
          file: {
            name: "measurements.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("x,y\n1,2\n"),
          },
        },
      },
    );
    expect(response.ok(), await response.text()).toBeTruthy();
    const version = await response.json();
    const listing = await (
      await f.member.request.get(
        `/api/v1/resources?spaceId=${space.id}&parentId=${f.note.id}`,
      )
    ).json();
    const file = listing.items.find(
      (item: any) => item.current_version_id === version.id,
    );
    expect(file).toBeTruthy();
    const project = await create(f.owner.request, "projects", {
      groupId: f.group.id,
      name: "Empty research project",
      audience: "group",
    });
    const updatedSpaces: Space[] = await (
      await f.member.request.get("/api/v1/spaces")
    ).json();
    const projectSpace = updatedSpaces.find(
      (s) => s.project_id === project.id,
    )!;
    await f.page.goto(`/workbench/explorer?space=${space.id}`);
    const tree = f.page.locator(".ws-tree");
    await tree
      .getByRole("button", { name: "Expand Native editor study", exact: true })
      .click();
    await expect(f.page).toHaveURL(new RegExp(`space=${space.id}$`));
    await tree
      .getByRole("button", { name: "measurements.txt", exact: true })
      .click();
    await expect(f.page).toHaveURL(new RegExp(`/files/${file.id}$`));
    await expect(
      f.page.getByRole("heading", { name: "measurements.txt", exact: true }),
    ).toBeVisible();
    await tree
      .getByRole("link", { name: projectSpace.name, exact: true })
      .click();
    const branch = tree
      .getByRole("link", { name: projectSpace.name, exact: true })
      .locator("..")
      .locator("..");
    await expect(
      branch.getByText("No items yet", { exact: true }),
    ).toBeVisible();
    await tree
      .getByRole("button", {
        name: `Collapse ${projectSpace.name}`,
        exact: true,
      })
      .click();
    await f.member.route(
      `**/api/v1/resources?spaceId=${projectSpace.id}&limit=40`,
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Temporary listing outage" }),
        }),
    );
    await tree
      .getByRole("link", { name: projectSpace.name, exact: true })
      .click();
    await expect(
      branch.getByRole("button", { name: "Could not load items. Retry" }),
    ).toBeVisible();
    await f.member.unroute(
      `**/api/v1/resources?spaceId=${projectSpace.id}&limit=40`,
    );
    await branch
      .getByRole("button", { name: "Could not load items. Retry" })
      .click();
    await expect(
      branch.getByText("No items yet", { exact: true }),
    ).toBeVisible();
    expect(await f.source()).toBe("Files are listed without rewriting notes.");
  } finally {
    await f.close();
  }
});
