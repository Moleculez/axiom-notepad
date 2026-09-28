import { test, expect, type APIRequestContext } from "@playwright/test";
import { fixture, origin } from "./native-editor-helpers";
import type { Space } from "@axiom/shared/workspace";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Sidebar acceptance requires isolated staging on 3004.");
});
async function create(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post("/api/v1/" + path, {
    headers: { origin },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function team(f: Awaited<ReturnType<typeof fixture>>) {
  const spaces: Space[] = await (
    await f.member.request.get("/api/v1/spaces")
  ).json();
  return spaces.find((s) => s.group_id === f.group.id && s.kind === "team")!;
}

test("directory navigation replaces levels, supports breadcrumbs and keeps file menus", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Unchanged research\n\nOriginal source.");
  try {
    const space = await team(f),
      page = f.page;
    const folder = await create(f.member.request, "resources", {
      spaceId: space.id,
      kind: "folder",
      name: "Experiments",
    });
    const nested = await create(f.member.request, "resources", {
      spaceId: space.id,
      parentId: folder.id,
      kind: "folder",
      name: "Run one",
    });
    const note = await create(f.member.request, "resources", {
      spaceId: space.id,
      parentId: nested.id,
      kind: "note",
      name: "Observations",
    });
    await page.goto("/workbench/workspaces");
    const sidebar = page.locator(".ws-sidebar"),
      list = sidebar.locator(".sidebar-directory-list");
    await expect(
      sidebar.getByRole("navigation", { name: "Administration" }),
    ).toHaveCount(0);
    await expect(
      sidebar
        .getByRole("navigation", { name: "Quick access" })
        .getByRole("link", { name: "Trash", exact: true }),
    ).toBeVisible();
    await expect(
      sidebar
        .getByRole("navigation", { name: "Quick access" })
        .getByRole("link", { name: "Audit", exact: true }),
    ).toBeVisible();
    const workspaceLink = list.locator(
      `a[href="/workbench/workspaces/${space.id}/files"]`,
    );
    await expect(workspaceLink).toBeVisible();
    await workspaceLink.click();
    await expect(
      list.getByRole("link", { name: "Experiments", exact: true }),
    ).toBeVisible();
    await expect(workspaceLink).toHaveCount(0);
    await list.getByRole("link", { name: "Experiments", exact: true }).click();
    await expect(
      list.getByRole("link", { name: "Experiments", exact: true }),
    ).toHaveCount(0);
    await list.getByRole("link", { name: "Run one", exact: true }).click();
    const row = list.locator(`[data-directory-resource="${note.id}"]`);
    await expect(row).toBeVisible();
    await expect(list.locator("ul")).toHaveCount(0);
    await row.focus();
    await page.keyboard.press("Shift+F10");
    await expect(
      page.getByRole("menuitem", { name: "Open", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/notes/${note.id}$`));
    await expect(row).toHaveClass(/active/);
    await expect(page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    const path = sidebar.getByRole("navigation", {
      name: "Sidebar directory path",
    });
    await expect(path).toContainText("Run one");
    await sidebar.getByRole("button", { name: "Up one level" }).click();
    await expect(page).toHaveURL(new RegExp(`folder=${folder.id}$`));
    await expect(
      list.getByRole("link", { name: "Run one", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(row).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("sidebar-directory-light.png"),
      animations: "disabled",
    });
    await path
      .getByRole("link", { name: "All workspaces", exact: true })
      .click();
    await expect(workspaceLink).toBeVisible();
    expect(await f.source()).toBe("# Unchanged research\n\nOriginal source.");
  } finally {
    await f.close();
  }
});

test("background recovery stays quiet and retains rows until authoritative access denial", async ({
  browser,
}) => {
  const f = await fixture(browser, "Refresh fixture.");
  let release = () => {};
  try {
    const space = await team(f),
      page = f.page;
    const folder = await create(f.member.request, "resources", {
      spaceId: space.id,
      kind: "folder",
      name: "Retained experiments",
    });
    const child = await create(f.member.request, "resources", {
      spaceId: space.id,
      parentId: folder.id,
      kind: "note",
      name: "Retained observation",
    });
    await page.goto(
      `/workbench/workspaces/${space.id}/files?folder=${folder.id}`,
    );
    const sidebar = page.locator(".ws-sidebar"),
      row = sidebar.locator(`[data-directory-resource="${child.id}"]`);
    await expect(row).toBeVisible();
    await row.focus();
    const original = await row.elementHandle();
    const endpoint = `/api/v1/resources?spaceId=${space.id}&limit=40&parentId=${folder.id}`;
    const listing = await (await f.member.request.get(endpoint)).json();
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let status = 200;
    await page.route("**" + endpoint, async (route) => {
      await held;
      await route.fulfill({
        status,
        json: status === 200 ? listing : { error: "Listing unavailable" },
      });
    });
    const bar = page.getByRole("progressbar", { name: "Workspace loading" });
    await expect(bar).toBeHidden();
    const request = page.waitForRequest((r) => r.url().endsWith(endpoint));
    await page.evaluate(() =>
      window.dispatchEvent(new Event("axiom:workspace-refresh")),
    );
    await request;
    await page.waitForTimeout(600);
    await expect(bar).toBeHidden();
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(row).toBeFocused();
    status = 503;
    release();
    const retry = sidebar.getByRole("button", {
      name: "Could not refresh items. Retry",
      exact: true,
    });
    await expect(retry).toBeVisible();
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    status = 200;
    await retry.click();
    await expect(retry).toHaveCount(0);
    status = 404;
    await page.evaluate(() =>
      window.dispatchEvent(new Event("axiom:workspace-refresh")),
    );
    await expect(
      sidebar.getByRole("button", {
        name: "Could not load items. Retry",
        exact: true,
      }),
    ).toBeVisible();
    await expect(row).toHaveCount(0);
  } finally {
    release();
    await f.close();
  }
});

test("directory filter is literal and folder-scoped, pagination and attached files remain reachable", async ({
  browser,
}) => {
  const f = await fixture(browser, "Directory filter fixture.");
  try {
    const space = await team(f),
      page = f.page;
    const folder = await create(f.member.request, "resources", {
      spaceId: space.id,
      kind: "folder",
      name: "Experiments",
    });
    await create(f.member.request, "resources", {
      spaceId: space.id,
      parentId: folder.id,
      kind: "note",
      name: "Needle nested",
    });
    const matched = await create(f.member.request, "resources", {
      spaceId: space.id,
      kind: "note",
      name: "Needle 100%",
    });
    // Pagination is checked with a second authorized result page, not a generated tree.
    for (let i = 0; i < 40; i++)
      await create(f.member.request, "resources", {
        spaceId: space.id,
        kind: "folder",
        name: `Run ${String(i).padStart(2, "0")}`,
      });
    await page.goto(`/workbench/workspaces/${space.id}/files`);
    const sidebar = page.locator(".ws-sidebar");
    await sidebar.getByRole("button", { name: "Next files" }).click();
    await expect(sidebar.getByText("Page 2", { exact: true })).toBeVisible();
    const filter = sidebar.getByRole("textbox", {
      name: "Filter files in this folder",
    });
    await filter.fill("Needle");
    await expect(sidebar.locator(".sidebar-directory-row")).toHaveCount(1);
    await expect(
      sidebar.locator(`[data-directory-resource="${matched.id}"]`),
    ).toBeVisible();
    await filter.fill("%");
    await expect(sidebar.locator(".sidebar-directory-row")).toHaveCount(1);
    await filter.press("Escape");
    await expect(
      sidebar.getByRole("link", { name: "Experiments", exact: true }),
    ).toBeVisible();
    await filter.press("ArrowDown");
    await expect(
      sidebar.locator(".sidebar-directory-row").first(),
    ).toBeFocused();
    const uploaded = await f.member.request.post(
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
    expect(uploaded.ok()).toBeTruthy();
    await page.evaluate(() =>
      window.dispatchEvent(new Event("axiom:workspace-refresh")),
    );
    await sidebar
      .getByRole("link", {
        name: "Browse contents of Native editor study",
        exact: true,
      })
      .click();
    await expect(
      sidebar.getByRole("button", { name: "measurements.txt", exact: true }),
    ).toBeVisible();
    await sidebar
      .getByRole("button", { name: "measurements.txt", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "measurements.txt", exact: true }),
    ).toBeVisible();
    expect(await f.source()).toBe("Directory filter fixture.");
  } finally {
    await f.close();
  }
});

test("appearance leaves panel sizing to the saved edge resizers", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "# Panel preferences\n\nUnchanged research.",
  );
  try {
    await f.page.goto("/workbench/settings/layout");
    await expect(
      f.page.getByText("Resize the sidebar and document panel", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      f.page.getByLabel("Reading width", { exact: true }),
    ).toBeVisible();
    for (const label of ["Sidebar width", "Research panel width"]) {
      await expect(f.page.getByText(label, { exact: true })).toHaveCount(0);
    }
    await f.page.screenshot({
      path: test.info().outputPath("appearance-panel-resizing-current.png"),
      animations: "disabled",
    });
    await f.page.goto("/workbench/settings/device");
    await expect(
      f.page.getByText("Only on this device", { exact: true }),
    ).toBeVisible();
    await expect(
      f.page.getByRole("checkbox", { name: "Override uiScale on this device" }),
    ).toBeVisible();
    await expect(
      f.page.getByRole("checkbox", { name: "Override density on this device" }),
    ).toBeVisible();
    for (const label of ["Sidebar width", "Research panel width"]) {
      await expect(f.page.getByText(label, { exact: true })).toHaveCount(0);
    }
    expect(await f.source()).toBe("# Panel preferences\n\nUnchanged research.");
  } finally {
    await f.close();
  }
});

test("both panel widths support drag, keyboard, cancel, reset and reload without altering the note", async ({
  browser,
}) => {
  const source =
    "# Resizable research\n\n## Evidence\n\n" +
    "Reading material.\n\n".repeat(45);
  const f = await fixture(browser, source);
  try {
    const page = f.page;
    const sidebar = page.locator(".ws-sidebar"),
      context = page.locator(".ws-document-context");
    const left = page.getByRole("separator", {
        name: "Resize workspace navigation",
      }),
      right = page.getByRole("separator", { name: "Resize document context" });
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();
    const original = (await sidebar.boundingBox())!.width;
    let box = (await left.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + 100, {
      steps: 8,
    });
    await page.mouse.up();
    await expect
      .poll(async () => (await sidebar.boundingBox())!.width)
      .toBe(original + 70);
    const initialContext = (await context.boundingBox())!.width;
    await right.focus();
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => (await context.boundingBox())!.width)
      .toBe(initialContext + 10);
    box = (await right.boundingBox())!;
    await page.mouse.move(box.x + 3, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x - 45, box.y + 100);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect
      .poll(async () => (await context.boundingBox())!.width)
      .toBe(initialContext + 10);
    await expect(page.locator("html")).not.toHaveClass(
      /resizing-workspace-panel/,
    );
    await page.reload();
    await expect
      .poll(async () => (await sidebar.boundingBox())?.width)
      .toBe(original + 70);
    await expect
      .poll(async () => (await context.boundingBox())?.width)
      .toBe(initialContext + 10);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await page.screenshot({
      path: test.info().outputPath("sidebar-resizers-dark.png"),
      animations: "disabled",
    });
    await left.dblclick();
    await right.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await sidebar.boundingBox())!.width)
      .toBe(248);
    await expect
      .poll(async () => (await context.boundingBox())!.width)
      .toBe(270);
    expect(await f.source()).toBe(source);
  } finally {
    await f.close();
  }
});

test("directory rows preserve workspace actions, blank-space creation and file drops", async ({
  browser,
}) => {
  const f = await fixture(browser, "Drag fixture remains unchanged.");
  try {
    const page = f.page,
      space = await team(f);
    const folder = await create(f.member.request, "resources", {
      spaceId: space.id,
      kind: "folder",
      name: "Drop destination",
    });
    const note = await create(f.member.request, "resources", {
      spaceId: space.id,
      kind: "note",
      name: "Move this observation",
    });
    await page.goto("/workbench/workspaces");
    const sidebar = page.locator(".ws-sidebar");
    await sidebar
      .getByRole("button", {
        name: `Workspace actions for ${space.name}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Manage workspace", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await sidebar
      .locator(
        `.sidebar-directory-open[href="/workbench/workspaces/${space.id}/files"]`,
      )
      .click();
    const directory = sidebar.locator(".sidebar-directory");
    await directory
      .locator(".sidebar-directory-heading .ws-section-label")
      .click({ button: "right" });
    await expect(
      page.getByRole("menu", { name: "Explorer actions", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /New note/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const source = sidebar.locator(`[data-directory-resource="${note.id}"]`),
      target = sidebar.locator(`[data-directory-resource="${folder.id}"]`);
    await source.dragTo(target);
    const move = page.getByRole("dialog", { name: "Move 1 item", exact: true });
    await expect(move).toContainText("Drop destination");
    await move.getByRole("button", { name: "Move here", exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await (
              await f.member.request.get(`/api/v1/resources/${note.id}`)
            ).json()
          ).parent_id,
      )
      .toBe(folder.id);
    await expect(source).toHaveCount(0);
    await target
      .getByRole("link", { name: "Drop destination", exact: true })
      .click();
    await expect(source).toBeVisible();
    expect(await f.source()).toBe("Drag fixture remains unchanged.");
  } finally {
    await f.close();
  }
});
