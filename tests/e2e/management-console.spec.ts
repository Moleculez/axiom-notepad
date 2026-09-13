import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInOwner } from "./auth";
import {
  appearanceVariables,
  defaults,
} from "../../packages/shared/src/appearance";

const origin = process.env.TEST_APP_URL;
test.beforeAll(() => {
  if (
    !["http://localhost:3002", "http://localhost:3004"].includes(origin ?? "")
  )
    throw new Error(
      "Management acceptance uses isolated staging on port 3002 or 3004 only.",
    );
});
let ownerState: Awaited<ReturnType<BrowserContext["storageState"]>>;
async function api(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const response = await request.fetch(`/api/v1/${path}`, {
    method,
    data,
    headers: { origin: origin! },
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
async function setup(browser: Browser) {
  const owner = await browser.newContext({
    baseURL: origin,
    storageState: ownerState,
    serviceWorkers: "block",
  });
  if (!ownerState) {
    expect((await signInOwner(owner.request, origin!)).ok()).toBeTruthy();
    ownerState = await owner.storageState();
  }
  const name = `Console verification ${randomUUID().slice(0, 8)}`;
  const group = await api(owner.request, "groups", {
    name,
    description: "Reproducible research and shared evidence.",
  });
  const team = (await api(owner.request, "spaces")).find(
    (s: any) => s.group_id === group.id && s.kind === "team",
  );
  return { owner, request: owner.request, name, group, team };
}
async function finish(request: APIRequestContext, id: string) {
  await api(request, `trash/${id}/confirm`, {
    mutationId: randomUUID(),
    confirmation: "DELETE FOREVER",
  });
  await expect
    .poll(async () => (await api(request, `trash/${id}`)).operation.status)
    .toBe("completed");
  return api(request, `trash/${id}`);
}

test("audit records legacy and current metadata, idempotent retries, named versions and revoked access", async ({
  browser,
}) => {
  const f = await setup(browser);
  const member = await browser.newContext({
    baseURL: origin,
    serviceWorkers: "block",
  });
  try {
    const invite = await api(f.request, "invitations", {
      groupId: f.group.id,
      email: `audit-${randomUUID()}@axiom.test`,
    });
    await api(member.request, "register", {
      token: new URL(invite.link).searchParams.get("invite"),
      name: "Audit collaborator",
      password: "AuditVerification2026!",
    });
    const folder = await api(f.request, "resources", {
      spaceId: f.team.id,
      kind: "folder",
      name: "Evidence",
    });
    const change = {
      mutationId: randomUUID(),
      version: folder.version,
      name: "Verified evidence",
      description: "Reviewed measurements",
    };
    await api(f.request, `resources/${folder.id}`, change, "PATCH");
    await api(f.request, `resources/${folder.id}`, change, "PATCH");
    const changes = await api(
      f.request,
      `audit?space=${f.team.id}&q=Verified&action=rename`,
    );
    expect(changes.items).toHaveLength(1);
    expect(changes.items[0].before_values.name).toBe("Evidence");
    expect(changes.items[0].after_values.name).toBe("Verified evidence");
    expect(changes.items[0].actor_id).toBeTruthy();
    const note = await api(f.request, "notes", {
      groupId: f.group.id,
      title: "Audit source",
      body: "# A retained proof\n\nA = B.\n",
    });
    await api(
      f.request,
      `notes/${note.id}`,
      { title: "Legacy renamed proof", version: note.version },
      "PATCH",
    );
    await api(f.request, `notes/${note.id}/history`, {
      label: "Reviewed proof",
    });
    const history = await api(
      f.request,
      `audit?space=${f.team.id}&entity=document-version`,
    );
    expect(history.items[0].after_values.label).toBe("Reviewed proof");
    expect(
      (await api(f.request, `audit/${history.items[0].id}/version`)).body,
    ).toContain("A = B");
    const visible = await api(member.request, `audit?space=${f.team.id}`);
    expect(
      visible.items.some((e: any) => e.entity_id === folder.id),
    ).toBeTruthy();
    expect(
      visible.items.some((e: any) => e.entity_type === "invitation"),
    ).toBeFalsy();
    const members = (await api(f.request, `group-admin/${f.group.id}/members`))
      .items;
    const collaborator = members.find(
      (m: any) => m.name === "Audit collaborator",
    );
    await api(
      f.request,
      `group-admin/${f.group.id}/members`,
      {
        mutationId: randomUUID(),
        items: [{ id: collaborator.id, version: collaborator.version }],
        remove: true,
      },
      "PATCH",
    );
    expect(
      (await api(member.request, `audit/export?space=${f.team.id}`)).items,
    ).toEqual([]);
    expect(
      (
        await member.request.get(`/api/v1/audit/${history.items[0].id}/version`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await member.request.get(`/api/v1/audit/${changes.items[0].id}`)
      ).status(),
    ).toBe(404);
  } finally {
    await member.close();
    await f.owner.close();
  }
});

test("file Trash restores hierarchy, handles duplicate names and freezes destinations", async ({
  browser,
}) => {
  const f = await setup(browser);
  try {
    const folder = await api(f.request, "resources", {
      spaceId: f.team.id,
      kind: "folder",
      name: "Experiment",
    });
    const child = await api(f.request, "resources", {
      spaceId: f.team.id,
      parentId: folder.id,
      kind: "folder",
      name: "Measurements",
    });
    await api(f.request, `resources/${folder.id}/trash`, {
      mutationId: randomUUID(),
      version: folder.version,
    });
    const top = await api(f.request, `trash/items?spaces=${f.team.id}&tree=1`);
    expect(top.items.map((r: any) => r.id)).toEqual([folder.id]);
    const nested = await api(
      f.request,
      `trash/items?spaces=${f.team.id}&tree=1&parent=${folder.id}`,
    );
    expect(nested.items.map((r: any) => r.id)).toEqual([child.id]);
    await api(f.request, "resources", {
      spaceId: f.team.id,
      kind: "folder",
      name: "Experiment",
    });
    const preview = await api(f.request, "trash/preview", {
      mutationId: randomUUID(),
      action: "restore",
      spaceIds: [f.team.id],
      ids: [folder.id, child.id],
      restorePolicy: "retain",
      conflictPolicy: "keep-both",
    });
    expect(preview.operation.total).toBe(2);
    const done = await finish(f.request, preview.operation.id);
    expect(done.operation.done).toBe(2);
    const restored = await api(f.request, `resources/${folder.id}`);
    expect(restored.resource?.name ?? restored.name).toBe("Experiment (2)");
    const c = await api(f.request, `resources/${child.id}`);
    expect(c.resource?.parent_id ?? c.parent_id).toBe(folder.id);
    const doomed = await api(f.request, "resources", {
      spaceId: f.team.id,
      kind: "folder",
      name: "Do not overwrite",
    });
    await api(f.request, `resources/${doomed.id}/trash`, {
      version: doomed.version,
    });
    await api(f.request, "resources", {
      spaceId: f.team.id,
      kind: "folder",
      name: "Do not overwrite",
    });
    const skip = await api(f.request, "trash/preview", {
      mutationId: randomUUID(),
      action: "restore",
      spaceIds: [f.team.id],
      ids: [doomed.id],
      conflictPolicy: "skip",
    });
    expect((await finish(f.request, skip.operation.id)).operation.skipped).toBe(
      1,
    );
    const destination = await api(f.request, "resources", {
      spaceId: f.team.id,
      kind: "folder",
      name: "Restore here",
    });
    const move = await api(f.request, "trash/preview", {
      mutationId: randomUUID(),
      action: "restore",
      spaceIds: [f.team.id],
      ids: [doomed.id],
      destinationId: destination.id,
    });
    await api(f.request, `resources/${destination.id}/trash`, {
      version: destination.version,
    });
    const blocked = await finish(f.request, move.operation.id);
    expect(blocked.operation.blocked).toBe(1);
    expect(blocked.operation.done).toBe(0);
    const parent = await api(f.request, "resources", {
      spaceId: f.team.id,
      kind: "folder",
      name: "Original location",
    });
    const evidence = await api(f.request, "resources", {
      spaceId: f.team.id,
      parentId: parent.id,
      kind: "folder",
      name: "Frozen location evidence",
    });
    await api(f.request, `resources/${evidence.id}/trash`, {
      version: evidence.version,
    });
    await api(
      f.request,
      `resources/${parent.id}`,
      { version: parent.version, name: "Renamed after deletion" },
      "PATCH",
    );
    const frozen = (
      await api(f.request, `trash/items?spaces=${f.team.id}&q=Frozen`)
    ).items[0];
    expect(frozen.original_path).toBe("Original location");
    expect(frozen.deleted_path).toBe("Original location");
    expect(frozen.deleted_by_name).toBeTruthy();
  } finally {
    await f.owner.close();
  }
});

test("workspace Trash collapses groups, preserves archived projects and supports cancelling owner purge", async ({
  browser,
}) => {
  const f = await setup(browser);
  try {
    const project = await api(f.request, "projects", {
      groupId: f.group.id,
      name: "Archived study",
    });
    const projectSpace = (await api(f.request, "spaces?manage=1")).find(
      (s: any) => s.project_id === project.id,
    );
    await api(f.request, `spaces/${projectSpace.id}/archive`, {
      version: projectSpace.version,
    });
    await api(f.request, `spaces/${f.team.id}/trash`, {
      version: f.team.version,
      confirmation: f.name,
    });
    const trash = await api(f.request, "trash/workspaces");
    expect(
      trash.some(
        (s: any) =>
          s.id === projectSpace.id && s.effective_status === "trashed",
      ),
    ).toBeTruthy();
    const preview = await api(f.request, "trash/preview", {
      mutationId: randomUUID(),
      target: "workspaces",
      action: "restore",
      spaceIds: [f.team.id, projectSpace.id],
      ids: [f.team.id, projectSpace.id],
    });
    expect(preview.operation.target_kind).toBe("workspaces");
    expect(preview.operation.total).toBe(1);
    expect((await finish(f.request, preview.operation.id)).operation.done).toBe(
      1,
    );
    expect(
      (await api(f.request, `spaces/${projectSpace.id}`)).space.status,
    ).toBe("archived");
    const team = (await api(f.request, `spaces/${f.team.id}`)).space;
    await api(f.request, `spaces/${team.id}/trash`, {
      version: team.version,
      confirmation: team.name,
    });
    const purge = await api(f.request, "trash/preview", {
      mutationId: randomUUID(),
      target: "workspaces",
      action: "purge",
      spaceIds: [team.id],
      ids: [team.id],
    });
    expect((await finish(f.request, purge.operation.id)).operation.done).toBe(
      1,
    );
    const purging = (await api(f.request, `spaces/${team.id}`)).space;
    expect(purging.status).toBe("purging");
    await api(f.request, `spaces/${team.id}/restore`, {
      version: purging.version,
    });
    expect((await api(f.request, `spaces/${team.id}`)).space.status).toBe(
      "active",
    );
    expect(
      (await api(f.request, `audit?space=${team.id}`)).items.some(
        (e: any) => e.action === "purging",
      ),
    ).toBeTruthy();
  } finally {
    await f.owner.close();
  }
});

test("unified console redirects, guards drafts, renders Audit and Trash with fresh desktop screenshots", async ({
  browser,
}) => {
  const f = await setup(browser),
    page = await f.owner.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`/workbench/admin/${f.group.id}/settings`);
    await expect(page).toHaveURL(
      new RegExp(`/workspaces/${f.team.id}/general`),
    );
    await expect(
      page.getByRole("button", { name: "File operations", exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel("Group description")
      .fill("A preserved unsaved draft.");
    await page
      .getByRole("navigation", { name: "Workspace sections" })
      .getByRole("link", { name: "People & access" })
      .click();
    const guard = page.getByRole("dialog", { name: "Unsaved group settings" });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Keep editing" }).click();
    await page
      .getByRole("button", { name: "Save group settings", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await api(f.request, `spaces/${f.team.id}`)).space.description,
      )
      .toBe("A preserved unsaved draft.");
    await page.screenshot({
      path: test.info().outputPath("workspace-general.png"),
      fullPage: true,
    });
    await page
      .getByRole("navigation", { name: "Administration" })
      .getByRole("link", { name: "Workspaces", exact: true })
      .click();
    await page.getByLabel("Find a workspace").fill(f.name);
    await expect(page.locator(".console-workspace-card")).toHaveCount(1);
    await page.screenshot({
      path: test.info().outputPath("workspace-directory.png"),
      fullPage: true,
    });
    await page.goto(`/workbench/audit?space=${f.team.id}`);
    await page.getByLabel("Action", { exact: true }).selectOption("create");
    await page.getByLabel("Search history").fill(f.name);
    await page.reload();
    await expect(page.getByLabel("Search history")).toHaveValue(f.name);
    await expect(page.getByLabel("Action", { exact: true })).toHaveValue(
      "create",
    );
    await page.getByLabel("Action", { exact: true }).selectOption("");
    await page.getByLabel("Search history").fill("");
    await expect(page.locator(".console-record").first()).toBeVisible();
    await page.locator(".console-record").first().click();
    await expect(
      page.getByRole("complementary", { name: "Change details" }),
    ).toBeVisible();
    await expect(page.getByLabel("Workspace", { exact: true })).toHaveValue(
      f.team.id,
    );
    const searchBox = await page.getByLabel("Search history").boundingBox();
    const workspaceBox = await page
      .getByLabel("Workspace", { exact: true })
      .boundingBox();
    expect(Math.abs(searchBox!.height - workspaceBox!.height)).toBeLessThan(4);
    expect(
      Math.abs(
        searchBox!.y +
          searchBox!.height -
          workspaceBox!.y -
          workspaceBox!.height,
      ),
    ).toBeLessThan(4);
    // Use the real semantic theme resolver, without saving account preferences.
    await page.evaluate(
      (palette) => {
        document.documentElement.dataset.theme = "light";
        document.documentElement.style.colorScheme = "light";
        for (const [key, value] of Object.entries(palette))
          document.documentElement.style.setProperty(key, value);
      },
      appearanceVariables(defaults, false),
    );
    await page.screenshot({
      path: test.info().outputPath("audit-light.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.evaluate(
      (palette) => {
        document.documentElement.dataset.theme = "dark";
        document.documentElement.style.colorScheme = "dark";
        for (const [key, value] of Object.entries(palette))
          document.documentElement.style.setProperty(key, value);
      },
      appearanceVariables({ ...defaults, uiSize: 20 }, true),
    );
    await page.screenshot({
      path: test.info().outputPath("audit-dark-large-type.png"),
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
    const folder = await api(f.request, "resources", {
      spaceId: f.team.id,
      kind: "folder",
      name: "Disposable recovery folder",
    });
    await api(f.request, `resources/${folder.id}/trash`, {
      version: folder.version,
    });
    await page
      .getByRole("navigation", { name: "Administration" })
      .getByRole("link", { name: "Trash", exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "Trash workspace", exact: true })
      .selectOption(f.team.id);
    await expect(
      page.getByRole("region", { name: "Trash selection actions" }),
    ).toHaveCount(0);
    await page
      .getByLabel("Select Disposable recovery folder", { exact: true })
      .check();
    await expect(
      page.getByRole("region", { name: "Trash selection actions" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Options", exact: true }).click();
    await page.screenshot({
      path: test.info().outputPath("trash-files.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Restore selected", exact: true })
      .click();
    const preview = page.getByRole("dialog", {
      name: "Review Trash operation",
    });
    await expect(preview).toBeVisible();
    const box = await preview.boundingBox();
    expect(
      Math.abs(box!.x + box!.width / 2 - page.viewportSize()!.width / 2),
    ).toBeLessThan(4);
    await preview.getByRole("button", { name: "Close", exact: true }).click();
    await api(f.request, "projects", {
      groupId: f.group.id,
      name: "Included research project",
    });
    const current = (await api(f.request, `spaces/${f.team.id}`)).space;
    await api(f.request, `spaces/${f.team.id}/trash`, {
      version: current.version,
      confirmation: f.name,
    });
    await page
      .getByRole("navigation", { name: "Trash views" })
      .getByRole("link", { name: "Workspaces", exact: true })
      .click();
    await page.getByLabel("Search workspaces").fill(f.name);
    await expect(page.locator(".productivity-table tbody tr")).toHaveCount(1);
    await page.getByLabel("Show included projects").check();
    await expect(page.locator(".productivity-table tbody tr")).toHaveCount(2);
    await page.getByLabel("Select matching workspaces").check();
    await page.screenshot({
      path: test.info().outputPath("trash-workspaces.png"),
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Restore selected", exact: true })
      .click();
    const workspacePreview = page.getByRole("dialog", {
      name: "Review Trash operation",
    });
    await expect(
      workspacePreview.getByRole("button", {
        name: "Restore 1 workspace",
        exact: true,
      }),
    ).toBeEnabled();
    await page.screenshot({
      path: test.info().outputPath("workspace-restore-preview.png"),
      animations: "disabled",
    });
    await workspacePreview
      .getByRole("button", { name: "Restore 1 workspace", exact: true })
      .click();
    await expect
      .poll(
        async () => (await api(f.request, `spaces/${f.team.id}`)).space.status,
      )
      .toBe("active");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Operation progress", exact: true })
      .click();
    await expect(page.locator(".console-record").first()).toContainText(
      "restore",
    );
    await page.locator(".console-record").first().click();
    await expect(page.locator(".console-operation")).toContainText(f.name);
    await page.screenshot({
      path: test.info().outputPath("audit-operation.png"),
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await f.owner.close();
  }
});

test("administrators without project content access cannot read or purge private file history", async ({
  browser,
}) => {
  const f = await setup(browser),
    admin = await browser.newContext({
      baseURL: origin,
      serviceWorkers: "block",
    });
  try {
    const invite = await api(f.request, "invitations", {
      groupId: f.group.id,
      email: `manager-${randomUUID()}@axiom.test`,
      role: "admin",
    });
    await api(admin.request, "register", {
      token: new URL(invite.link).searchParams.get("invite"),
      name: "Management-only administrator",
      password: "ManagementVerification2026!",
    });
    const who = (await api(admin.request, "me")).user;
    const project = await api(f.request, "projects", {
      groupId: f.group.id,
      name: "Private project",
      audience: "restricted",
    });
    const projectSpace = (await api(f.request, "spaces?manage=1")).find(
      (s: any) => s.project_id === project.id,
    );
    await api(f.request, `projects/${project.id}/members`, {
      userId: who.id,
      role: "editor",
      canManage: false,
    });
    const item = await api(f.request, "resources", {
      spaceId: projectSpace.id,
      kind: "folder",
      name: "Private evidence",
    });
    const operation = await api(admin.request, "file-operations", {
      id: randomUUID(),
      command: "rename",
      items: [
        {
          id: item.id,
          version: item.version,
          name: "Private renamed evidence",
        },
      ],
    });
    await api(admin.request, `file-operations/${operation.id}/run`, {});
    await expect
      .poll(
        async () =>
          (await api(admin.request, `file-operations/${operation.id}`)).status,
      )
      .toBe("completed");
    const renamed = await api(f.request, `resources/${item.id}`);
    await api(f.request, `resources/${item.id}/trash`, {
      version: renamed.version,
    });
    const preview = await api(admin.request, "trash/preview", {
      mutationId: randomUUID(),
      action: "purge",
      spaceIds: [projectSpace.id],
      ids: [item.id],
    });
    expect(preview.operation.pending).toBe(1);
    await api(f.request, `projects/${project.id}/members`, {
      userId: who.id,
      remove: true,
    });
    const details = await api(admin.request, `spaces/${projectSpace.id}`);
    expect(details.capabilities.managePeople).toBe(true);
    expect(details.capabilities.readContent).toBe(false);
    expect(
      (await api(admin.request, `storage/${projectSpace.id}`)).files,
    ).toEqual([]);
    expect(
      Array.isArray(await api(admin.request, `projects/${project.id}/members`)),
    ).toBe(true);
    expect(
      (
        await api(
          admin.request,
          `audit?space=${projectSpace.id}&q=Private%20renamed`,
        )
      ).items,
    ).toEqual([]);
    const hidden = await api(admin.request, `file-operations/${operation.id}`);
    expect(hidden.input.items[0].original.name).toBe("Unavailable item");
    expect(hidden.results[0].resource).toBeUndefined();
    const done = await finish(admin.request, preview.operation.id);
    expect(done.operation.done).toBe(0);
    expect(done.operation.blocked).toBe(1);
    expect(done.items[0].name).toBe("Unavailable item");
    expect(
      (
        await api(f.request, `trash/items?spaces=${projectSpace.id}`)
      ).items.some((r: any) => r.id === item.id),
    ).toBe(true);
  } finally {
    await admin.close();
    await f.owner.close();
  }
});
