import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Settings navigation requires isolated staging on 3004.");
});

async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post(`/api/v1/${path}`, {
    headers: { origin },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test("My groups and storage management stay in Settings without sidebar footer shortcuts", async ({
  browser,
}, info) => {
  const f = await fixture(browser, "Unchanged research.\n");
  const page = await f.member.newPage();
  page.on("pageerror", (error) => f.errors.push(error.message));
  try {
    await page.goto("/workbench/settings/profile");
    const nav = page.getByRole("navigation", { name: "Settings categories" });
    await page
      .getByLabel("Full name", { exact: true })
      .fill("Retained profile draft");
    await nav.getByRole("link", { name: "My groups", exact: true }).click();
    await expect(page).toHaveURL(/\/workbench\/settings\/groups$/);
    await expect(
      nav.getByRole("link", { name: "My groups", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator(".groups-hub")).toContainText(f.group.name);
    await expect(
      page.getByRole("button", { name: "Join with invitation" }),
    ).toBeVisible();
    await expect(page.locator(".ws-sidebar-footer")).toHaveCount(0);
    await expect(
      page.getByRole("tab", { name: "Settings", exact: true }),
    ).toHaveCount(1);
    await page.screenshot({ path: info.outputPath("settings-my-groups.png") });

    await nav.getByRole("link", { name: "Storage", exact: true }).click();
    const storage = nav.locator("section").filter({
      has: page.getByRole("heading", { name: "Storage", exact: true }),
    });
    await storage
      .getByRole("link", { name: "Management", exact: true })
      .click();
    await expect(page).toHaveURL(/\/workbench\/settings\/storage$/);
    await expect(
      page.getByRole("heading", { name: "Storage & file versions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Space", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ws-storage-overview")).toBeVisible();
    await page.screenshot({
      path: info.outputPath("settings-storage-management.png"),
    });
    await nav.getByRole("link", { name: "Account", exact: true }).click();
    await nav.getByRole("link", { name: "Profile", exact: true }).click();
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
      "Retained profile draft",
    );
    await page
      .getByRole("button", { name: "Cancel changes", exact: true })
      .click();

    // Bookmarks/reloads must not be rewritten to the standalone Groups page.
    await nav.getByRole("link", { name: "My groups", exact: true }).click();
    await page.reload();
    await expect(nav).toBeVisible();
    await expect(page).toHaveURL(/\/workbench\/settings\/groups$/);
    await expect(page.locator(".groups-hub")).toContainText(f.group.name);
    await page.goto("/workbench/explorer");
    await expect(page.locator(".ws-sidebar")).toBeVisible();
    await expect(page.locator(".ws-sidebar-footer")).toHaveCount(0);
    expect(await f.source()).toBe("Unchanged research.\n");
  } finally {
    await f.close();
  }
});

test("embedded groups create, accept invitations and leave without navigating away", async ({
  browser,
}, info) => {
  const f = await fixture(browser, "Unchanged research.\n");
  const page = await f.member.newPage();
  page.on("pageerror", (error) => f.errors.push(error.message));
  try {
    await page.goto("/workbench/settings/groups");
    await page
      .getByRole("button", { name: "Create group", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Create a research group",
    });
    const name = `Settings research ${randomUUID().slice(0, 8)}`;
    await dialog.getByLabel("Group name", { exact: true }).fill(name);
    await dialog
      .getByRole("button", { name: "Create group", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    const createdCard = page
      .locator(".group-membership-card")
      .filter({ hasText: name });
    await expect(createdCard).toContainText("owner");
    await expect(
      createdCard.getByRole("link", { name: "Manage group" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/workbench\/settings\/groups$/);

    const me = await (await f.member.request.get("/api/v1/me")).json();
    const invitedGroup = await post(f.owner.request, "groups", {
      name: `Invitation research ${randomUUID().slice(0, 8)}`,
      mutationId: randomUUID(),
    });
    const invitation = await post(
      f.owner.request,
      `group-admin/${invitedGroup.id}/invitations`,
      {
        emails: [me.user.email],
        contentRole: "editor",
        mutationId: randomUUID(),
      },
    );
    expect(invitation.results[0].ok).toBe(true);
    await page.getByRole("button", { name: "Join with invitation" }).click();
    const join = page.getByRole("dialog", { name: "Join a research group" });
    await join
      .getByLabel("Invitation link or token")
      .fill(invitation.results[0].link);
    await join.getByRole("button", { name: "Preview invitation" }).click();
    await expect(join.locator(".group-invitation-preview")).toContainText(
      invitedGroup.name,
    );
    await join
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(join).toBeHidden();
    const joinedCard = page
      .locator(".group-membership-card")
      .filter({ hasText: invitedGroup.name });
    await expect(joinedCard).toBeVisible();
    await expect(page).toHaveURL(/\/workbench\/settings\/groups$/);
    await page.screenshot({
      path: info.outputPath("settings-group-memberships.png"),
    });
    await joinedCard
      .getByRole("button", { name: "Leave…", exact: true })
      .click();
    const leave = page.getByRole("dialog", {
      name: `Leave ${invitedGroup.name}?`,
    });
    await leave.getByLabel("Confirm group departure").fill(invitedGroup.name);
    await leave
      .getByRole("button", { name: "Leave group", exact: true })
      .click();
    await expect(leave).toBeHidden();
    await expect(joinedCard).toHaveCount(0);
    await expect(page).toHaveURL(/\/workbench\/settings\/groups$/);

    // Accepting directly from the invitation list also keeps Settings open.
    const reinvited = await post(
      f.owner.request,
      `group-admin/${invitedGroup.id}/invitations`,
      {
        emails: [me.user.email],
        contentRole: "viewer",
        mutationId: randomUUID(),
      },
    );
    expect(reinvited.results[0].ok).toBe(true);
    const nav = page.getByRole("navigation", { name: "Settings categories" });
    await nav.getByRole("link", { name: "Profile", exact: true }).click();
    await nav.getByRole("link", { name: "My groups", exact: true }).click();
    const pending = page
      .locator(".group-invitation-row")
      .filter({ hasText: invitedGroup.name });
    await pending
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect(joinedCard).toBeVisible();
    await expect(page).toHaveURL(/\/workbench\/settings\/groups$/);

    // The standalone entry point still uses the same complete screen.
    await page.goto("/workbench/groups");
    await expect(
      page.getByRole("heading", { name: "Your groups", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.locator(".groups-hub")).toContainText(name);
    expect(await f.source()).toBe("Unchanged research.\n");
  } finally {
    await f.close();
  }
});
