import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fixture, origin } from "./native-editor-helpers";
import type { Resource } from "../../packages/shared/src/workspace";
const api = async (
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) => {
  const r = await request.fetch("/api/v1/" + path, {
    method,
    data,
    headers: { origin },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  if (r.status() === 202 && /^file-operations\/.+\/run$/.test(path)) {
    await expect
      .poll(async () => {
        const state = await request.get(
          "/api/v1/" + path.replace(/\/run$/, ""),
        );
        return (await state.json()).status;
      })
      .not.toMatch(/^(queued|running)$/);
  }
  return r.json();
};
test.beforeAll(() => {
  if (!["http://localhost:3002", "http://localhost:3004"].includes(origin))
    throw new Error(
      "Workspace v2 fixtures require the isolated database and blob store on 3002 or 3004.",
    );
});
test("group hub creates once, invites explicitly, declines and never rejoins through a consumed link", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Research remains intact\n");
  try {
    const owner = f.owner.request,
      member = f.member.request,
      me = await api(member, "me");
    const identity = {
      mutationId: randomUUID(),
      name: "Workspace v2 group " + randomUUID().slice(0, 6),
      description: "Isolated group creation verification",
    };
    const group = await api(owner, "groups", identity);
    expect((await api(owner, "groups", identity)).id).toBe(group.id);
    const page = await f.member.newPage();
    await page.goto("/workbench/groups");
    await expect(
      page.getByRole("button", { name: "Join with invitation" }),
    ).toBeVisible();
    const invite = await api(owner, `group-admin/${group.id}/invitations`, {
      emails: [me.user.email],
      contentRole: "editor",
      mutationId: randomUUID(),
    });
    const token = new URL(invite.results[0].link).searchParams.get("invite");
    await page.goto(`/workbench/home?invite=${token}`);
    const dialog = page.getByRole("dialog", { name: "Join a research group" });
    await expect(dialog).toBeVisible();
    expect(
      (await api(member, "me")).groups.some((g: any) => g.id === group.id),
    ).toBe(false);
    await expect(page).not.toHaveURL(/invite=/);
    expect(
      await page.evaluate(() =>
        JSON.stringify(
          Object.fromEntries(
            Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]),
          ),
        ),
      ),
    ).not.toContain(token);
    await dialog
      .getByRole("button", { name: "Accept invitation", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await api(member, "me")).groups.some((g: any) => g.id === group.id),
      )
      .toBe(true);
    await api(member, `group-admin/${group.id}/leave`, {});
    expect(
      (
        await member.post("/api/v1/invitation", {
          headers: { origin },
          data: { token },
        })
      ).status(),
    ).toBe(410);
    const second = await api(owner, `group-admin/${group.id}/invitations`, {
      emails: [me.user.email],
      contentRole: "viewer",
      mutationId: randomUUID(),
    });
    const inspect = await api(member, "group-invitations/inspect", {
      token: new URL(second.results[0].link).searchParams.get("invite"),
    });
    await api(member, `group-invitations/${inspect.id}/decline`, {});
    await api(member, `group-invitations/${inspect.id}/decline`, {});
    expect(
      (await api(member, "group-invitations")).some(
        (i: any) => i.id === inspect.id,
      ),
    ).toBe(false);
    await page.screenshot({
      path: test.info().outputPath("groups-invitations.png"),
    });
    await page.close();
  } finally {
    await f.close();
  }
});
test("durable multi-file operations normalize descendants, resume once, guard stale edits and preserve shortcut access", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Transfer fixture\n");
  try {
    const request = f.owner.request,
      spaces = await api(request, "spaces"),
      space = spaces.find(
        (s: any) => s.group_id === f.group.id && s.kind === "team",
      );
    const folder = await api(request, "resources", {
        kind: "folder",
        spaceId: space.id,
        name: "Source",
        mutationId: randomUUID(),
      }),
      child = await api(request, "resources", {
        kind: "folder",
        spaceId: space.id,
        parentId: folder.id,
        name: "Nested",
        mutationId: randomUUID(),
      }),
      dest = await api(request, "resources", {
        kind: "folder",
        spaceId: space.id,
        name: "Destination",
        mutationId: randomUUID(),
      });
    const input = {
      id: randomUUID(),
      command: "copy",
      items: [
        { id: folder.id, version: folder.version },
        { id: child.id, version: child.version },
      ],
      destination: { spaceId: space.id, parentId: dest.id },
    };
    const op = await api(request, "file-operations", input);
    expect(op.input.items).toHaveLength(1);
    await api(request, `file-operations/${op.id}/run`, {});
    await api(request, "file-operations", input);
    await api(request, `file-operations/${op.id}/run`, {});
    const result = await api(request, `file-operations/${op.id}`);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].ok).toBe(true);
    const copies = await api(
      request,
      `resources?spaceId=${space.id}&parentId=${dest.id}`,
    );
    expect(copies.items).toHaveLength(1);
    const shortcut = await api(request, "shortcuts", {
      mutationId: randomUUID(),
      targetId: child.id,
      parentId: dest.id,
    });
    expect((await api(request, `resources/${shortcut.id}/resolve`)).id).toBe(
      child.id,
    );
    expect(
      (
        await request.post("/api/v1/shortcuts", {
          headers: { origin },
          data: {
            mutationId: randomUUID(),
            targetId: shortcut.id,
            parentId: dest.id,
          },
        })
      ).status(),
    ).toBe(400);
    await api(request, `resources/${folder.id}/color`, { color: "teal" });
    expect((await api(request, `resources/${folder.id}`)).folder_color).toBe(
      "teal",
    );
    expect(
      (await api(f.member.request, `resources/${folder.id}`)).folder_color,
    ).toBeNull();
    const move = await api(request, "file-operations", {
      id: randomUUID(),
      command: "move",
      items: [{ id: child.id, version: child.version }],
      destination: { spaceId: space.id, parentId: dest.id },
    });
    await api(request, `file-operations/${move.id}/run`, {});
    expect((await api(request, `resources/${child.id}`)).parent_id).toBe(
      dest.id,
    );
    expect(
      (
        await request.post("/api/v1/file-operations", {
          headers: { origin },
          data: {
            id: randomUUID(),
            command: "rename",
            items: [{ id: child.id, version: child.version, name: "Stale" }],
          },
        })
      ).status(),
    ).toBe(409);
    const upload = {
      mutationId: randomUUID(),
      spaceId: space.id,
      parentId: dest.id,
      paths: [
        ["Data", "runs", "one.csv"],
        ["Data", "two.txt"],
      ],
      conflict: "keepBoth",
    };
    const plan = await api(request, "folder-upload-plan", upload);
    expect((await api(request, "folder-upload-plan", upload)).folders).toEqual(
      plan.folders,
    );
    expect(plan.folders["Data/runs"]).toBeTruthy();
    const same = await api(request, "folder-upload-plan", {
      ...upload,
      mutationId: randomUUID(),
      conflict: "merge",
    });
    expect(same.folders).toEqual(plan.folders);
    const trash = await api(request, "file-operations", {
      id: randomUUID(),
      command: "trash",
      items: [{ id: folder.id, version: folder.version }],
    });
    await api(request, `file-operations/${trash.id}/run`, {});
    const trashed = (await api(request, `file-operations/${trash.id}`))
      .results[0];
    expect(trashed.resource.version).toBe(folder.version + 1);
    const undo = await api(request, "file-operations", {
      id: randomUUID(),
      command: "restore",
      items: [{ id: folder.id, version: trashed.resource.version }],
    });
    await api(request, `file-operations/${undo.id}/run`, {});
    expect(
      (await api(request, `resources/${folder.id}`)).deleted_at,
    ).toBeNull();
  } finally {
    await f.close();
  }
});
test("Explorer selects ranges, opens with double click, drops files and retains whole-app tabs", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Editor kept\n");
  try {
    const request = f.owner.request,
      spaces = await api(request, "spaces"),
      space = spaces.find(
        (s: any) => s.group_id === f.group.id && s.kind === "team",
      );
    const items: Resource[] = [];
    for (const name of ["A folder", "B folder", "C folder"])
      items.push(
        await api(request, "resources", {
          kind: "folder",
          spaceId: space.id,
          name,
          mutationId: randomUUID(),
        }),
      );
    const page = f.page;
    await page.goto(`/workbench/explorer?space=${space.id}`);
    await expect(
      page.getByRole("button", { name: "Upload", exact: true }),
    ).toBeVisible();
    const a = page.locator(`[data-resource-id="${items[0].id}"]`),
      b = page.locator(`[data-resource-id="${items[1].id}"]`),
      c = page.locator(`[data-resource-id="${items[2].id}"]`);
    await a.locator(".ws-resource-name").click();
    await c.locator(".ws-resource-name").click({ modifiers: ["Shift"] });
    await expect(page.getByText("3 selected", { exact: true })).toBeVisible();
    await a.locator(".ws-resource-name").click();
    await page.evaluate(() => {
      (window as any).__fileDragEvents = [];
      for (const type of [
        "pointerdown",
        "pointermove",
        "mousedown",
        "dragstart",
        "dragover",
        "drop",
        "dragend",
        "pointercancel",
      ])
        document.addEventListener(
          type,
          (event) => {
            const e = event as DragEvent;
            (window as any).__fileDragEvents.push({
              type,
              target: (e.target as Element)
                .closest("[data-resource-id]")
                ?.getAttribute("data-resource-id"),
              prevented: e.defaultPrevented,
              types: Array.from(e.dataTransfer?.types ?? []),
            });
          },
          true,
        );
    });
    await expect(a).toHaveAttribute("draggable", "true");
    const from = (await a.locator(".ws-resource-name").boundingBox())!,
      to = (await b.boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y + 25, { steps: 4 });
    await page.mouse.move(to.x + 70, to.y + 20, { steps: 12 });
    await page.mouse.move(to.x + 72, to.y + 22);
    await page.mouse.up();
    await test.info().attach("file-drag-events", {
      body: JSON.stringify({
        events: await page.evaluate(() => (window as any).__fileDragEvents),
        blocked: await b.getAttribute("data-drop-blocked"),
      }),
      contentType: "application/json",
    });
    const move = page.getByRole("dialog", { name: "Move 1 item" });
    await expect(move).toBeVisible();
    await move.getByRole("button", { name: "Move here", exact: true }).click();
    await expect
      .poll(
        async () => (await api(request, `resources/${items[0].id}`)).parent_id,
      )
      .toBe(items[1].id);
    await expect(move).not.toBeVisible();
    await b.locator(".ws-resource-name").dblclick();
    await expect(page).toHaveURL(new RegExp("folder=" + items[1].id));
    await page
      .getByRole("button", { name: "Back in tab", exact: true })
      .click();
    await expect(page).not.toHaveURL(/folder=/);
    await page.getByRole("button", { name: "Choose file columns" }).click();
    await page
      .getByRole("menuitem", { name: "Hide size column", exact: true })
      .click();
    await expect(
      page
        .locator(".ws-resource-head")
        .getByRole("button", { name: "Size", exact: true }),
    ).toHaveCount(0);
    const explorerTab = page
      .getByRole("tablist", { name: "Application tabs" })
      .locator('[aria-selected="true"]');
    const explorerId = await explorerTab
      .locator("..")
      .getAttribute("data-tab-id");
    await explorerTab.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Pin tab", exact: true }).click();
    await expect(page.locator(`[data-tab-id="${explorerId}"]`)).toHaveClass(
      /pinned/,
    );
    await page.getByRole("button", { name: "New application tab" }).click();
    await page
      .getByRole("button", { name: /Settings Make the workspace yours/ })
      .click();
    await expect(
      page.getByRole("tab", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New application tab" }).click();
    await page.getByRole("button", { name: /Groups Create, join/ }).click();
    await expect(
      page.getByRole("tab", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ws-document-tabs")).toHaveCount(0);
    await expect(page.locator(".ws-app-nav")).toHaveCount(0);
    await page.locator(`[data-tab-id="${explorerId}"] [role="tab"]`).click();
    await expect(
      page
        .locator(".ws-resource-head")
        .getByRole("button", { name: "Size", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "Groups", exact: true }).click();
    await page
      .getByRole("button", { name: "Close Groups tab", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Groups", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Alt+Shift+t");
    await expect(
      page.getByRole("tab", { name: "Groups", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.screenshot({
      path: test.info().outputPath("whole-app-tabs.png"),
    });
  } finally {
    await f.close();
  }
});

test("group creation is reachable from the hub and grants administration immediately", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "# Group creation does not change research\n",
  );
  try {
    await f.page.goto("/workbench/groups");
    await f.page
      .getByRole("button", { name: "Create group", exact: true })
      .click();
    const dialog = f.page.getByRole("dialog"),
      name = "UI research group " + randomUUID().slice(0, 6);
    await dialog.getByLabel("Group name", { exact: true }).fill(name);
    await dialog.getByLabel(/Description/).fill("Private STEM collaboration");
    await dialog
      .getByRole("button", { name: "Create group", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(
        async () =>
          (await api(f.member.request, "me")).groups.find(
            (g: any) => g.name === name,
          )?.role,
      )
      .toBe("owner");
    await expect(f.page).toHaveURL(/\/admin\//);
    await expect(
      f.page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  } finally {
    await f.close();
  }
});

test("settings drafts survive app-tab switches, suspend previews and guard tab closing", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Retained note\n");
  try {
    const page = f.page;
    await page.goto("/workbench/settings/theme");
    await page.getByText("Visual theme editor", { exact: true }).click();
    await page.getByLabel("Accent & links color value").fill("#1964c8");
    await page.getByLabel("Accent & links color value").press("Enter");
    await page.getByRole("button", { name: "New application tab" }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--accent")
            .trim(),
        ),
      )
      .not.toBe("#1964c8");
    await expect(
      page.locator(".settings-preview-editor .ProseMirror"),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page.getByText("Visual theme editor", { exact: true }).click();
    await expect(page.getByLabel("Accent & links color picker")).toHaveValue(
      "#1964c8",
    );
    await page.getByRole("link", { name: "Account", exact: true }).click();
    await page.getByRole("link", { name: "Profile", exact: true }).click();
    await page
      .getByLabel("Institution or affiliation", { exact: true })
      .fill("Retained laboratory draft");
    await page.getByRole("button", { name: "New application tab" }).click();
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await expect(
      page.getByLabel("Institution or affiliation", { exact: true }),
    ).toHaveValue("Retained laboratory draft");
    await page
      .getByRole("button", { name: "Close Settings tab", exact: true })
      .click();
    const warning = page.getByRole("dialog", {
      name: "Keep your unsaved settings?",
    });
    await expect(warning).toBeVisible();
    await warning.getByRole("button", { name: "Stay in settings" }).click();
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save profile", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Close Settings tab", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Settings", exact: true }),
    ).toHaveCount(0);
    expect(await f.source()).toBe("# Retained note\n");
  } finally {
    await f.close();
  }
});

test("Trash honors the explicit missing-folder restore policy", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Retained recovery evidence\n");
  try {
    const request = f.owner.request;
    const space = (await api(request, "spaces")).find(
      (s: any) => s.group_id === f.group.id && s.kind === "team",
    );
    const folder = await api(request, "resources", {
      kind: "folder",
      spaceId: space.id,
      name: "Original folder",
    });
    const child = await api(request, "resources", {
      kind: "folder",
      spaceId: space.id,
      parentId: folder.id,
      name: "Recoverable child",
    });
    await api(request, `resources/${folder.id}/trash`, {
      version: folder.version,
    });
    const selection = {
      action: "restore",
      spaceIds: [space.id],
      ids: [child.id],
    };
    const retained = await api(request, "trash/preview", {
      ...selection,
      mutationId: randomUUID(),
      restorePolicy: "retain",
    });
    expect(retained.operation).toMatchObject({
      pending: 0,
      blocked: 1,
      restore_policy: "retain",
    });
    const root = await api(request, "trash/preview", {
      ...selection,
      mutationId: randomUUID(),
      restorePolicy: "root",
    });
    expect(root.operation.pending).toBe(1);
    await api(request, `trash/${root.operation.id}/confirm`, {
      mutationId: randomUUID(),
    });
    await expect
      .poll(
        async () =>
          (await api(request, `trash/${root.operation.id}`)).operation.status,
      )
      .toBe("completed");
    expect(await api(request, `resources/${child.id}`)).toMatchObject({
      parent_id: null,
      deleted_at: null,
    });
    expect(
      (await api(request, `resources/${folder.id}`)).deleted_at,
    ).toBeTruthy();
  } finally {
    await f.close();
  }
});

test("saved journals in unopened notes can be indexed without weakening Trash protection", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Open-note evidence\n");
  try {
    if (!process.env.DATABASE_URL?.includes("axiom_refinement_test_20260908"))
      throw new Error("Journal fixture requires the isolated database.");
    const { query } = await import("../../packages/shared/src/db"),
      { flushNote } = await import("../../packages/shared/src/documents"),
      Y = await import("yjs");
    const space = (await api(f.member.request, "spaces")).find(
      (s: any) => s.kind === "personal",
    );
    const note = await api(f.member.request, "resources", {
      kind: "note",
      spaceId: space.id,
      name: "Unopened journal fixture",
      body: "# Saved base\n",
    });
    const room = `${note.id}:1`,
      [saved] = await query("SELECT state FROM documents WHERE room=$1", [
        room,
      ]);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, saved.state);
    const vector = Y.encodeStateVector(doc);
    doc
      .getText("markdown")
      .insert(doc.getText("markdown").length, "\nRecovered journal content.\n");
    await query("INSERT INTO document_updates(room,data) VALUES($1,$2)", [
      room,
      Buffer.from(Y.encodeStateAsUpdate(doc, vector)),
    ]);
    doc.destroy();
    await flushNote({ id: note.id, generation: 1 });
    expect((await api(f.member.request, `notes/${note.id}`)).body).toContain(
      "Recovered journal content.",
    );
    expect(
      await query("SELECT id FROM document_updates WHERE room=$1", [room]),
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("native folder upload keeps its hierarchy and files can be previewed without navigation", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Uploads do not replace notes\n");
  try {
    const request = f.member.request,
      page = f.page;
    const space = (await api(request, "spaces")).find(
      (s: any) => s.kind === "personal",
    );
    await page.goto(`/workbench/explorer?space=${space.id}`);
    await expect(
      page.getByRole("button", { name: "Upload folder", exact: true }),
    ).toBeVisible();
    await page
      .locator("input[webkitdirectory]")
      .setInputFiles(resolve("tests/fixtures/workspace-folder-upload"));
    const upload = page.getByRole("dialog", {
      name: "Upload folder",
      exact: true,
    });
    await expect(upload).toBeVisible();
    await upload
      .getByRole("button", { name: "Upload folder", exact: true })
      .click();
    await expect(upload).not.toBeVisible();
    let folder: Resource;
    await expect
      .poll(async () => {
        folder = (
          await api(request, `resources?spaceId=${space.id}`)
        ).items.find((r: Resource) => r.name === "workspace-folder-upload");
        return !!folder;
      })
      .toBe(true);
    let readme: Resource;
    await expect
      .poll(async () => {
        readme = (
          await api(
            request,
            `resources?spaceId=${space.id}&parentId=${folder.id}`,
          )
        ).items.find((r: Resource) => r.name === "README.txt");
        return !!readme;
      })
      .toBe(true);
    const nested = (
      await api(request, `resources?spaceId=${space.id}&parentId=${folder!.id}`)
    ).items.find((r: Resource) => r.name === "Experiment");
    await expect
      .poll(async () =>
        (
          await api(
            request,
            `resources?spaceId=${space.id}&parentId=${nested.id}`,
          )
        ).items.some((r: Resource) => r.name === "data.csv"),
      )
      .toBe(true);
    await page.goto(
      `/workbench/explorer?space=${space.id}&folder=${folder!.id}`,
    );
    const row = page.locator(`[data-resource-id="${readme!.id}"]`);
    await row.focus();
    await row.press("Space");
    await expect(page.getByRole("dialog")).toContainText(
      "Isolated browser acceptance fixture",
    );
    await page.getByRole("dialog").press("Escape");
    await expect(page).toHaveURL(new RegExp(`folder=${folder!.id}`));
    await expect(row).toBeFocused();
  } finally {
    await f.close();
  }
});
