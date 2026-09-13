import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
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
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
test.beforeAll(() => {
  if (!["http://localhost:3002", "http://localhost:3004"].includes(origin))
    throw new Error(
      "Destructive productivity tests require isolated staging on port 3002 or 3004.",
    );
});
test("Trash execution rechecks manager authority after preview", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Access-change evidence\n"),
    request = f.owner.request;
  try {
    const base = `group-admin/${f.group.id}`;
    let member = (await api(request, `${base}/members`)).items.find(
      (m: any) => m.name === "Native Researcher",
    );
    await api(
      request,
      `${base}/members`,
      {
        mutationId: randomUUID(),
        items: [{ id: member.id, version: member.version }],
        role: "admin",
      },
      "PATCH",
    );
    const space = (await api(request, "spaces")).find(
      (s: any) => s.group_id === f.group.id && s.kind === "team",
    );
    const folder = await api(request, "resources", {
      kind: "folder",
      name: "Retained after access change",
      spaceId: space.id,
    });
    await api(request, `resources/${folder.id}/trash`, {
      version: folder.version,
    });
    const preview = await api(f.member.request, "trash/preview", {
      action: "purge",
      spaceIds: [space.id],
      ids: [folder.id],
      mutationId: randomUUID(),
    });
    expect(preview.operation.pending).toBe(1);
    member = (await api(request, `${base}/members`)).items.find(
      (m: any) => m.id === member.id,
    );
    await api(
      request,
      `${base}/members`,
      {
        mutationId: randomUUID(),
        items: [{ id: member.id, version: member.version }],
        role: "member",
      },
      "PATCH",
    );
    await api(f.member.request, `trash/${preview.operation.id}/confirm`, {
      mutationId: randomUUID(),
      confirmation: "DELETE FOREVER",
    });
    await expect
      .poll(
        async () =>
          (await api(f.member.request, `trash/${preview.operation.id}`))
            .operation.status,
      )
      .toBe("completed");
    expect(
      (await api(f.member.request, `trash/${preview.operation.id}`)).operation,
    ).toMatchObject({ done: 0, blocked: 1 });
    expect(
      (await api(request, `resources/${folder.id}`)).deleted_at,
    ).toBeTruthy();
  } finally {
    await f.close();
  }
});
test("group administration handles deduplicated invitations, rotated links, roles and stale membership revisions", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Membership evidence\n");
  const newcomer = await browser.newContext({ baseURL: origin });
  try {
    const base = `group-admin/${f.group.id}`,
      email = randomUUID() + "@axiom.test",
      second = randomUUID() + "@axiom.test";
    const invited = await api(f.owner.request, `${base}/invitations`, {
      emails: [email, email.toUpperCase(), second],
      contentRole: "viewer",
      mutationId: randomUUID(),
    });
    expect(invited.results).toHaveLength(2);
    expect(
      invited.results.every(
        (r: any) => r.ok && r.link && r.delivery === "copy-link",
      ),
    ).toBe(true);
    const pending = await api(
        f.owner.request,
        `${base}/invitations?filter=pending`,
      ),
      target = pending.items.find((i: any) => i.email === email);
    const reissued = await api(f.owner.request, `${base}/invitations/reissue`, {
      items: [{ id: target.id, version: target.version }],
      mutationId: randomUUID(),
    });
    expect(
      (
        await f.owner.request.get(
          `/api/v1/invitation?token=${new URL(invited.results[0].link).searchParams.get("invite")}`,
        )
      ).status(),
    ).toBe(410);
    await api(newcomer.request, "register", {
      token: new URL(reissued.results[0].link).searchParams.get("invite"),
      name: "New reader",
      password: "ProductivityVerification2026!",
    });
    const members = await api(f.owner.request, `${base}/members`),
      reader = members.items.find((m: any) => m.email === email),
      original = members.items.find((m: any) => m.name === "Native Researcher"),
      owner = members.items.find((m: any) => m.role === "owner");
    expect(reader.content_role).toBe("viewer");
    expect((await api(newcomer.request, `notes/${f.note.id}`)).role).toBe(
      "viewer",
    );
    const page = await api(f.owner.request, `${base}/members?limit=1`);
    expect(page.items).toHaveLength(1);
    expect(page.nextOffset).toBe(1);
    const changes = {
      items: [{ id: original.id, version: original.version }],
      contentRole: "commenter",
      mutationId: randomUUID(),
    };
    expect(
      (await api(f.owner.request, `${base}/members`, changes, "PATCH"))
        .results[0].ok,
    ).toBe(true);
    expect(
      (
        await api(
          f.owner.request,
          `${base}/members`,
          { ...changes, mutationId: randomUUID(), contentRole: "viewer" },
          "PATCH",
        )
      ).results[0],
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("changed elsewhere"),
    });
    expect(
      (
        await api(
          f.owner.request,
          `${base}/members`,
          {
            items: [{ id: owner.id, version: owner.version }],
            remove: true,
            mutationId: randomUUID(),
          },
          "PATCH",
        )
      ).results[0].ok,
    ).toBe(false);
    const current = (await api(f.owner.request, `${base}/members`)).items.find(
      (m: any) => m.id === original.id,
    );
    await api(
      f.owner.request,
      `${base}/members`,
      {
        items: [{ id: current.id, version: current.version }],
        role: "admin",
        mutationId: randomUUID(),
      },
      "PATCH",
    );
    expect(
      (
        await api(f.member.request, `${base}/invitations`, {
          emails: [randomUUID() + "@axiom.test"],
          role: "admin",
          mutationId: randomUUID(),
        })
      ).results[0].ok,
    ).toBe(false);
    const other = (
      await api(f.owner.request, `${base}/invitations?filter=pending`)
    ).items.find((i: any) => i.email === second);
    await api(f.owner.request, `${base}/invitations/revoke`, {
      items: [{ id: other.id, version: other.version }],
      mutationId: randomUUID(),
    });
    expect(
      (
        await api(f.owner.request, `${base}/invitations?filter=revoked`)
      ).items.some((i: any) => i.id === other.id),
    ).toBe(true);
    expect(
      (await api(f.owner.request, `${base}/activity?filter=invitation&limit=1`))
        .total,
    ).toBeGreaterThanOrEqual(5);
    expect(
      (await newcomer.request.get(`/api/v1/${base}/members`)).status(),
    ).toBe(403);
    const ownerPage = await f.owner.newPage();
    await ownerPage.goto(`/workbench/admin/${f.group.id}/members`);
    await expect(
      ownerPage.getByRole("navigation", {
        name: "Workspace sections",
      }),
    ).toBeVisible();
    await expect(
      ownerPage.getByText("New reader", { exact: true }),
    ).toBeVisible();
    await ownerPage
      .getByRole("link", { name: "General", exact: true })
      .last()
      .click();
    await expect(ownerPage.getByLabel("Group description")).toBeVisible();
    await ownerPage.close();
  } finally {
    await newcomer.close();
    await f.close();
  }
});
test("Trash freezes all pages, deduplicates descendants and retains external references and changed items", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = await fixture(browser, "# Retained note\n"),
    request = f.owner.request;
  try {
    const space = (await api(request, "spaces")).find(
      (s: any) => s.group_id === f.group.id && s.kind === "team",
    );
    const trash = async (id: string) => {
      const item = await api(request, `resources/${id}`);
      await api(request, `resources/${id}/trash`, { version: item.version });
    };
    const folders = [];
    for (let n = 0; n < 55; n++) {
      const r = await api(request, "resources", {
        kind: "folder",
        spaceId: space.id,
        name: `Disposable ${String(n).padStart(2, "0")}`,
      });
      await trash(r.id);
      folders.push(r);
    }
    const upload = async (name: string) => {
      const id = randomUUID(),
        data = Buffer.from("isolated evidence " + name);
      await api(request, "uploads", {
        id,
        spaceId: space.id,
        name,
        bytes: data.length,
      });
      expect(
        (
          await request.put(`/api/v1/uploads/${id}/chunks/1`, {
            headers: { origin, "content-type": "application/octet-stream" },
            data,
          })
        ).ok(),
      ).toBe(true);
      await api(request, `uploads/${id}/complete`, {});
      let result: any;
      await expect
        .poll(
          async () => {
            result = await api(request, `uploads/${id}`);
            return result.status;
          },
          { timeout: 30000 },
        )
        .toBe("complete");
      return api(request, `resources/${result.resourceId}`);
    };
    const internal = await upload("internal.txt"),
      external = await upload("protected.txt");
    const folder = await api(request, "resources", {
      kind: "folder",
      spaceId: space.id,
      name: "Nested research",
    });
    const note = await api(request, "resources", {
      kind: "note",
      parentId: folder.id,
      spaceId: space.id,
      name: "Selected reference",
      body: `[Evidence](/api/v1/attachments/${internal.current_version_id})`,
    });
    await api(request, "resources", {
      kind: "note",
      spaceId: space.id,
      name: "Retained reference",
      body: `[Retained evidence](/api/v1/attachments/${external.current_version_id})`,
    });
    for (const item of [folder, internal, external]) await trash(item.id);
    const preview = await api(request, "trash/preview", {
      mutationId: randomUUID(),
      action: "purge",
      spaceIds: [space.id],
      allMatching: true,
    });
    expect(preview.operation.total).toBe(59);
    expect(preview.operation.blocked).toBe(1);
    expect(preview.operation.pending).toBe(58);
    expect(preview.nextOffset).toBe(50);
    const unauthorized = await api(f.member.request, "trash/preview", {
      mutationId: randomUUID(),
      action: "purge",
      spaceIds: [space.id],
      ids: [folders[0].id],
    });
    expect(unauthorized.operation.pending).toBe(0);
    const changed = await api(request, `resources/${folders[0].id}`);
    await api(request, `resources/${changed.id}/restore`, {
      version: changed.version,
    });
    const newer = await api(request, "resources", {
      kind: "folder",
      spaceId: space.id,
      name: "Trashed after preview",
    });
    await trash(newer.id);
    const ownerPage = await f.owner.newPage();
    await ownerPage.goto(`/workbench/explorer?view=trash&space=${space.id}`);
    await ownerPage.getByLabel("Select this page of Trash").check();
    await expect(
      ownerPage.getByRole("region", { name: "Trash selection actions" }),
    ).toContainText("50 selected across pages");
    await ownerPage.getByRole("button", { name: "Next", exact: true }).click();
    await ownerPage.getByLabel("Select this page of Trash").check();
    await expect(
      ownerPage.getByRole("region", { name: "Trash selection actions" }),
    ).toContainText("58 selected across pages"); // Child stays nested; its selected folder includes it once.
    const confirm = {
      mutationId: randomUUID(),
      confirmation: "DELETE FOREVER",
    };
    await api(request, `trash/${preview.operation.id}/confirm`, confirm);
    let result: any;
    await expect
      .poll(
        async () => {
          result = await api(request, `trash/${preview.operation.id}`);
          return result.operation.status;
        },
        { timeout: 45000 },
      )
      .toBe("completed");
    expect(result.operation).toMatchObject({
      total: 59,
      done: 57,
      skipped: 1,
      blocked: 1,
    });
    expect((await request.get(`/api/v1/resources/${note.id}`)).status()).toBe(
      404,
    );
    expect(
      (await request.get(`/api/v1/resources/${internal.id}`)).status(),
    ).toBe(404);
    expect(
      (await api(request, `resources/${external.id}`)).deleted_at,
    ).toBeTruthy();
    expect(
      (await api(request, `resources/${newer.id}`)).deleted_at,
    ).toBeTruthy();
    expect(
      (await api(request, `resources/${changed.id}`)).deleted_at,
    ).toBeNull();
    expect(
      (await api(request, `trash/${preview.operation.id}/confirm`, confirm))
        .operation.done,
    ).toBe(57);
    await expect(
      ownerPage.getByText("Trashed after preview", { exact: true }),
    ).toBeVisible();
    await ownerPage.close();
  } finally {
    await f.close();
  }
});
test("cancelled Trash work resumes without adding new targets and restore handles nested items", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Safe cancellation\n"),
    request = f.owner.request;
  try {
    const space = (await api(request, "spaces")).find(
      (s: any) => s.group_id === f.group.id && s.kind === "team",
    );
    const folder = await api(request, "resources", {
      kind: "folder",
      spaceId: space.id,
      name: "Restore tree",
    });
    const child = await api(request, "resources", {
      kind: "note",
      spaceId: space.id,
      parentId: folder.id,
      name: "Restorable note",
      body: "Preserved text",
    });
    await api(request, `resources/${folder.id}/trash`, {
      version: folder.version,
    });
    const preview = await api(request, "trash/preview", {
      action: "restore",
      spaceIds: [space.id],
      ids: [folder.id, child.id],
      mutationId: randomUUID(),
    });
    expect(preview.operation.total).toBe(2);
    await api(request, `trash/${preview.operation.id}/cancel`, {
      mutationId: randomUUID(),
    });
    expect(
      (await api(request, `trash/${preview.operation.id}`)).operation,
    ).toMatchObject({ status: "cancelled", cancelled: 2, done: 0 });
    await api(request, `trash/${preview.operation.id}/retry`, {
      mutationId: randomUUID(),
    });
    await expect
      .poll(
        async () =>
          (await api(request, `trash/${preview.operation.id}`)).operation
            .status,
      )
      .toBe("completed");
    expect(await api(request, `resources/${child.id}`)).toMatchObject({
      parent_id: folder.id,
      deleted_at: null,
    });
    expect((await api(request, `notes/${child.id}`)).body).toBe(
      "Preserved text",
    );
  } finally {
    await f.close();
  }
});
