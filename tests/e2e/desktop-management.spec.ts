import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin, replaceSource } from "./native-editor-helpers";
import type { Space } from "@axiom/shared/workspace";

async function api(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const response = await request.fetch("/api/v1/" + path, {
    method,
    data,
    headers: { origin },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function space(request: APIRequestContext, id: string): Promise<Space> {
  return (await api(request, "spaces?manage=1")).find(
    (item: Space) => item.id === id,
  );
}
async function transition(
  request: APIRequestContext,
  id: string,
  action: string,
) {
  const current = await space(request, id);
  return api(request, `spaces/${id}/${action}`, {
    version: current.version,
    confirmation: current.name,
    mutationId: randomUUID(),
  });
}

test("archive is inherited read-only access, Trash is indefinite and personal space is protected", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Research\n\nPreserved text."),
    request = f.owner.request;
  try {
    const spaces: Space[] = await api(request, "spaces"),
      team = spaces.find(
        (s) => s.group_id === f.group.id && s.kind === "team",
      )!,
      personal = spaces.find((s) => s.kind === "personal")!;
    const project = await api(request, "projects", {
      groupId: f.group.id,
      name: "Independent project",
      audience: "group",
    });
    const projectSpace = (await api(request, "spaces")).find(
      (s: Space) => s.project_id === project.id,
    );
    await transition(request, projectSpace.id, "archive");
    const invite = await api(request, "invitations", {
      groupId: f.group.id,
      email: randomUUID() + "@axiom.test",
    });
    await transition(request, team.id, "archive");
    expect((await api(f.member.request, `notes/${f.note.id}`)).role).toBe(
      "viewer",
    );
    expect(
      (
        await api(f.member.request, `notes/${f.note.id}/sync-token`, {
          accessProtocol: 1,
        })
      ).readOnly,
    ).toBe(true);
    for (const [path, data] of [
      ["resources", { spaceId: team.id, kind: "note", name: "Blocked" }],
      ["projects", { groupId: f.group.id, name: "Blocked" }],
      [
        "invitations",
        { groupId: f.group.id, email: randomUUID() + "@axiom.test" },
      ],
      [
        "references",
        { groupId: f.group.id, citeKey: "blocked", title: "Blocked" },
      ],
      [
        "uploads",
        { id: randomUUID(), spaceId: team.id, name: "blocked.txt", bytes: 10 },
      ],
    ] as const) {
      const result = await request.post("/api/v1/" + path, {
        headers: { origin },
        data,
      });
      expect([403, 404, 409], path).toContain(result.status());
    }
    expect(
      (
        await request.get(
          `/api/v1/invitation?token=${new URL(invite.link).searchParams.get("invite")}`,
        )
      ).status(),
    ).toBe(410);
    expect(
      (await request.get(`/api/v1/export?groupId=${f.group.id}`)).ok(),
    ).toBeTruthy();
    const bypass = await request.patch(`/api/v1/projects/${project.id}`, {
      headers: { origin },
      data: {
        version: (await api(request, `projects/${project.id}`)).version,
        archived: false,
        name: "Blocked rename",
      },
    });
    expect([403, 409]).toContain(bypass.status());
    await transition(request, team.id, "trash");
    expect(
      (await f.member.request.get(`/api/v1/notes/${f.note.id}`)).status(),
    ).toBe(404);
    expect(
      (await api(request, "spaces")).some((s: Space) => s.id === team.id),
    ).toBe(false);
    expect(
      (await api(request, `spaces/${team.id}/lifecycle`)).policy,
    ).toContain("no expiry");
    await transition(request, team.id, "restore");
    expect((await space(request, team.id)).status).toBe("archived");
    await transition(request, team.id, "unarchive");
    const legacyToken = await f.member.request.post(
      `/api/v1/notes/${f.note.id}/sync-token`,
      { headers: { origin }, data: {} },
    );
    expect(legacyToken.status()).toBe(426);
    expect(await legacyToken.text()).toContain("Download any unsaved text");
    expect((await space(request, projectSpace.id)).status).toBe("archived");
    expect((await api(request, `notes/${f.note.id}`)).body).toBe(
      "# Research\n\nPreserved text.",
    );
    const protectedResult = await request.post(
      `/api/v1/spaces/${personal.id}/trash`,
      {
        headers: { origin },
        data: { version: personal.version, confirmation: personal.name },
      },
    );
    expect(protectedResult.status()).toBe(400);
  } finally {
    await f.close();
  }
});

test("an offline draft is quarantined across archive and restore instead of replayed", async ({
  browser,
}) => {
  const f = await fixture(browser, "Shared baseline"),
    request = f.owner.request;
  try {
    const team = (await api(request, "spaces")).find(
      (s: Space) => s.kind === "team" && s.group_id === f.group.id,
    );
    await f.member.setOffline(true);
    await replaceSource(f.page, "Shared baseline\nOFFLINE-RECOVERY-ONLY");
    await expect(f.page.locator(".ws-document-status")).toContainText(
      "Saved locally",
    );
    await transition(request, team.id, "archive");
    await transition(request, team.id, "unarchive");
    await f.member.setOffline(false);
    await expect(
      f.page.getByRole("button", { name: "Download recovered text" }),
    ).toBeVisible();
    await expect(f.page.getByTestId("note-editor")).not.toContainText(
      "OFFLINE-RECOVERY-ONLY",
    );
    await expect(f.page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    expect(await f.source()).toBe("Shared baseline");
    const text = await f.page.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith("axiom:editor-recovery:"))
        .map((key) => localStorage.getItem(key))
        .join("\n"),
    );
    expect(text).toContain("OFFLINE-RECOVERY-ONLY");
    await f.page.reload();
    await expect(f.page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await expect(
      f.page.getByRole("button", { name: "Download recovered text" }),
    ).toBeVisible();
    expect(await f.source()).toBe("Shared baseline");
  } finally {
    await f.member.setOffline(false);
    await f.close();
  }
});

test("workspace and Explorer context menus preserve selection, focus, keyboard actions and centered dialogs", async ({
  browser,
}) => {
  const f = await fixture(browser, "Menu fixture");
  try {
    const spaces: Space[] = await api(f.member.request, "spaces"),
      team = spaces.find(
        (s) => s.group_id === f.group.id && s.kind === "team",
      )!;
    const one = await api(f.member.request, "resources", {
      spaceId: team.id,
      kind: "folder",
      name: "Alpha folder",
    });
    await f.page.goto(`/workbench/explorer?space=${team.id}`);
    const row = f.page.locator(`[data-resource-id="${one.id}"]`);
    await row.click({ button: "right" });
    await expect(
      f.page.getByRole("menuitem", { name: "New note…", exact: true }),
    ).toBeVisible();
    await f.page.getByRole("menuitem", { name: /^Rename…/ }).click();
    const dialog = f.page.getByRole("dialog", { name: "Rename item" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!,
      size = f.page.viewportSize()!;
    expect(Math.abs(box.x + box.width / 2 - size.width / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - size.height / 2)).toBeLessThan(2);
    await dialog.getByLabel("Name", { exact: true }).fill("Beta folder");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row).toContainText("Beta folder");
    await row.focus();
    await f.page.keyboard.press("ControlOrMeta+c");
    await f.page.locator('[aria-label="Explorer items"]').focus();
    await f.page.keyboard.press("ControlOrMeta+v");
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "Copy here", exact: true })
      .click();
    await expect(
      f.page.locator("[data-resource-id]").filter({ hasText: "Beta folder" }),
    ).toHaveCount(2);
    await row.focus();
    await f.page.keyboard.press("Shift+F10");
    await expect(f.page.getByRole("menu")).toBeVisible();
    await f.page.keyboard.press("Escape");
    await expect(row).toBeFocused();
    await f.page
      .getByRole("button", { name: "Manage workspaces", exact: true })
      .click();
    await expect(
      f.page.getByRole("heading", { name: "Workspaces", exact: true }),
    ).toBeVisible();
    await f.page
      .getByRole("button", { name: `Actions for ${f.group.name}`, exact: true })
      .click();
    await expect(
      f.page.getByRole("menuitem", { name: "Leave workspace…", exact: true }),
    ).toBeVisible();
    await expect(
      f.page.getByRole("menuitem", { name: "Archive workspace…", exact: true }),
    ).toHaveCount(0);
    await f.page.keyboard.press("Escape");
  } finally {
    await f.close();
  }
});

test("owner permanent deletion can be cancelled and queued again with a fresh revision", async ({
  browser,
}) => {
  const f = await fixture(browser, "Queue policy");
  try {
    const project = await api(f.owner.request, "projects", {
      groupId: f.group.id,
      name: "Recoverable empty project",
    });
    const target = (await api(f.owner.request, "spaces")).find(
      (s: Space) => s.project_id === project.id,
    );
    await transition(f.owner.request, target.id, "trash");
    const first = await transition(f.owner.request, target.id, "purge");
    expect(first.jobId).toBeTruthy();
    await transition(f.owner.request, target.id, "restore");
    expect((await space(f.owner.request, target.id)).status).toBe("active");
    await transition(f.owner.request, target.id, "trash");
    const second = await transition(f.owner.request, target.id, "purge");
    expect(second.jobId).toBe(first.jobId);
    expect(
      (await api(f.owner.request, `spaces/${target.id}/lifecycle`)).job.status,
    ).toBe("queued");
    await transition(f.owner.request, target.id, "restore");
  } finally {
    await f.close();
  }
});

test("a temporary authorization outage keeps local input editable and retries without quarantining", async ({
  browser,
}) => {
  const f = await fixture(browser, "Service baseline");
  const tokenPath = `**/api/v1/notes/${f.note.id}/sync-token`;
  try {
    await f.member.setOffline(true);
    await replaceSource(f.page, "Draft while offline.");
    await f.member.route(tokenPath, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary verification outage" }),
      }),
    );
    await f.member.setOffline(false);
    await expect(
      f.page.getByText("Temporary verification outage", { exact: true }),
    ).toBeVisible();
    await expect(f.page.getByTestId("note-editor")).toHaveAttribute(
      "contenteditable",
      "true",
    );
    await f.page.getByTestId("note-editor").press("ControlOrMeta+End");
    await f.page.keyboard.insertText(" Still editable.");
    await f.member.unroute(tokenPath);
    await f.page.evaluate(() =>
      window.dispatchEvent(new Event("axiom:connection-restored")),
    );
    await expect(f.page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    expect(await f.source()).toBe("Draft while offline. Still editable.");
    await expect(
      f.page.getByRole("button", { name: "Download recovered text" }),
    ).toHaveCount(0);
  } finally {
    await f.member.unroute(tokenPath);
    await f.member.setOffline(false);
    await f.close();
  }
});
