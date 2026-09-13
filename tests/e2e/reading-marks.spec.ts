import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { caret, fixture, origin, replaceSource } from "./native-editor-helpers";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Use isolated staging for reading-mark acceptance.");
});
const sample =
  "# Research\n\nA stable observation.\n\n- Parent\n  - Child\n  - Sibling\n\n```py\nx=1\ny=2\n```\n\nFinal thought.";
async function blockMenu(page: Page) {
  await page
    .locator(".editor-mount .axiom-prose p, .read-mount:not(.print-only) p")
    .filter({ hasText: "A stable observation." })
    .filter({ visible: true })
    .hover();
  await page
    .getByRole("button", { name: "Paragraph reading actions", exact: true })
    .click();
}
test("bookmarks support right-margin creation, editing, deletion, undo and reading navigation", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    await blockMenu(f.page);
    await f.page
      .getByRole("menuitem", { name: "Bookmark block", exact: true })
      .click();
    await expect(f.page.locator(".reading-margin-marker")).toHaveCount(1);
    await f.page
      .getByRole("button", { name: "bookmarks panel", exact: true })
      .click();
    await expect(
      f.page.getByRole("heading", { name: "Reading marks", exact: true }),
    ).toBeVisible();
    await f.page
      .getByRole("button", {
        name: "Actions for bookmark A stable observation.",
        exact: true,
      })
      .click();
    await f.page
      .getByRole("menuitem", { name: "Edit bookmark", exact: true })
      .click();
    await f.page
      .getByRole("textbox", { name: "Bookmark label", exact: true })
      .fill("Check the evidence");
    await f.page
      .getByRole("textbox", { name: "Bookmark tags", exact: true })
      .fill("physics, review");
    await f.page
      .getByRole("button", { name: "blue bookmark", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Save bookmark", exact: true })
      .click();
    await expect(f.page.locator(".reading-bookmark-open")).toContainText(
      "Check the evidence",
    );
    await f.page
      .getByRole("button", {
        name: "Actions for bookmark Check the evidence",
        exact: true,
      })
      .click();
    await f.page
      .getByRole("menuitem", { name: "Delete bookmark", exact: true })
      .click();
    await expect(f.page.locator(".reading-margin-marker")).toHaveCount(0);
    await f.page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(f.page.locator(".reading-margin-marker")).toHaveCount(1);
    await f.page.getByRole("button", { name: "Read", exact: true }).click();
    await expect(f.page.locator(".reading-margin-marker")).toHaveCount(1);
    await f.page.screenshot({ path: info.outputPath("reading-bookmark.png") });
    expect(await f.source()).toBe(sample);
  } finally {
    await f.close();
  }
});
test("annotation drafts survive reload, remain private, then share a real discussion thread", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    await blockMenu(f.page);
    await f.page
      .getByRole("menuitem", { name: "Add annotation", exact: true })
      .click();
    await f.page
      .getByRole("textbox", { name: "Annotation title", exact: true })
      .fill("Check dimensional consistency");
    const editor = f.page.getByTestId("annotation-editor");
    await expect(editor).toBeVisible();
    await editor.click();
    await f.page.keyboard.insertText(
      "Verify the units before reproducing this result.",
    );
    await expect(
      f.page
        .getByRole("status")
        .filter({ hasText: "Draft saved on this device" }),
    ).toBeVisible();
    await f.page
      .getByRole("button", { name: "Close annotation card", exact: true })
      .click();
    await f.page.reload();
    await f.page
      .getByRole("button", { name: "bookmarks panel", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Annotations", exact: true })
      .click();
    await f.page.locator(".annotation-list-card.is-draft").click();
    await expect(f.page.getByTestId("annotation-editor")).toContainText(
      "Verify the units",
    );
    await f.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      f.page.getByRole("button", { name: "Share annotation", exact: true }),
    ).toBeEnabled();
    const owned = await (
      await f.member.request.get(`/api/v1/notes/${f.note.id}/comments`)
    ).json();
    const card = owned.find((c: any) => c.kind === "annotation");
    expect(card.visibility).toBe("private");
    expect(
      await (
        await f.owner.request.get(`/api/v1/notes/${f.note.id}/comments`)
      ).json(),
    ).toEqual([]);
    const denied = await f.owner.request.patch(`/api/v1/comments/${card.id}`, {
      headers: { origin },
      data: { body: "leak", version: card.version },
    });
    expect(denied.status()).toBe(404);
    await f.page.screenshot({
      path: info.outputPath("private-annotation-card.png"),
    });
    await f.page
      .getByRole("button", { name: "Share annotation", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Share with readers", exact: true })
      .click();
    await expect(f.page.locator(".annotation-byline")).toContainText(
      "Shared with readers",
    );
    const shared = await (
      await f.owner.request.get(`/api/v1/notes/${f.note.id}/comments`)
    ).json();
    expect(shared[0].visibility).toBe("shared");
    const response = await f.owner.request.post(
      `/api/v1/notes/${f.note.id}/comments`,
      {
        headers: { origin },
        data: { body: "I can reproduce the calculation.", parentId: card.id },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    await expect(f.page.locator(".annotation-reply")).toContainText(
      "I can reproduce",
      { timeout: 15000 },
    );
    const unshare = await f.member.request.patch(
      `/api/v1/comments/${card.id}`,
      {
        headers: { origin },
        data: {
          visibility: "private",
          version: shared[0].version,
          mutationId: randomUUID(),
        },
      },
    );
    expect(unshare.status()).toBe(409);
    await f.page.screenshot({
      path: info.outputPath("shared-annotation-thread.png"),
    });
    expect(await f.source()).toBe(sample);
  } finally {
    await f.close();
  }
});
test("thread revisions, reply ownership, tombstones and route variants enforce privacy", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  try {
    const input = {
      id: randomUUID(),
      body: "Personal hypothesis",
      kind: "annotation",
      bodyFormat: "markdown",
      mutationId: randomUUID(),
    };
    const create = await f.member.request.post(
      `/api/v1/notes/${f.note.id}/comments`,
      { headers: { origin }, data: input },
    );
    expect(create.ok(), await create.text()).toBe(true);
    const card = await create.json();
    const retry = await f.member.request.post(
      `/api/v1/notes/${f.note.id}/comments`,
      { headers: { origin }, data: input },
    );
    expect((await retry.json()).id).toBe(card.id);
    const bypass = await f.owner.request.get(
      `/api/v1/notes/${f.note.id}/comments/extra`,
    );
    expect(bypass.status()).toBe(404);
    const publish = await f.member.request.patch(
      `/api/v1/comments/${card.id}`,
      {
        headers: { origin },
        data: { visibility: "shared", version: card.version },
      },
    );
    expect(publish.ok(), await publish.text()).toBe(true);
    const shared = await publish.json();
    const stale = await f.member.request.patch(`/api/v1/comments/${card.id}`, {
      headers: { origin },
      data: { body: "stale", version: card.version },
    });
    expect(stale.status()).toBe(409);
    const editOther = await f.owner.request.patch(
      `/api/v1/comments/${card.id}`,
      {
        headers: { origin },
        data: { body: "overwrite", version: shared.version },
      },
    );
    expect(editOther.status()).toBe(403);
    const reply = await f.owner.request.post(
      `/api/v1/notes/${f.note.id}/comments`,
      {
        headers: { origin },
        data: { body: "Retained contribution", parentId: card.id },
      },
    );
    expect(reply.ok(), await reply.text()).toBe(true);
    const removal = await f.member.request.delete(
      `/api/v1/comments/${card.id}`,
      { headers: { origin }, data: { version: shared.version } },
    );
    expect(removal.ok(), await removal.text()).toBe(true);
    const remaining = await (
      await f.owner.request.get(`/api/v1/notes/${f.note.id}/comments`)
    ).json();
    expect(remaining.find((c: any) => c.id === card.id)).toMatchObject({
      deleted: true,
      body: "",
      anchor: null,
    });
    expect(remaining.some((c: any) => c.body === "Retained contribution")).toBe(
      true,
    );
  } finally {
    await f.close();
  }
});

async function newAnnotation(page: Page, body: string, title: string) {
  await blockMenu(page);
  await page
    .getByRole("menuitem", { name: "Add annotation", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Annotation title", exact: true })
    .fill(title);
  const editor = page.getByTestId("annotation-editor");
  await editor.click();
  if (body) await page.keyboard.insertText(body);
}

test("offline cards can be edited and removed before their first acknowledgement", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  try {
    const writes: string[] = [];
    f.page.on("request", (r) => {
      if (
        /\/comments(?:\/|$)/.test(new URL(r.url()).pathname) &&
        ["POST", "PATCH"].includes(r.method())
      )
        writes.push(r.url());
    });
    await f.member.setOffline(true);
    await newAnnotation(f.page, "First offline draft.", "Offline hypothesis");
    await f.page.getByRole("button", { name: "Save", exact: true }).click();
    await f.page
      .getByRole("button", { name: "Edit annotation", exact: true })
      .click();
    await f.page
      .locator(".annotation-editor")
      .getByRole("button", { name: "Source", exact: true })
      .click();
    await f.page.getByTestId("annotation-editor").click();
    await f.page.keyboard.press("ControlOrMeta+a");
    await f.page.keyboard.insertText("Revised offline draft with $x^2$.");
    await f.page.getByRole("button", { name: "Save", exact: true }).click();
    await f.member.setOffline(false);
    await expect(
      f.page.getByRole("button", { name: "Share annotation", exact: true }),
    ).toBeEnabled();
    let records = await (
      await f.member.request.get(`/api/v1/notes/${f.note.id}/comments`)
    ).json();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      body: "Revised offline draft with $x^2$.",
      visibility: "private",
    });
    expect(writes.length).toBeLessThanOrEqual(3);
    await f.page
      .getByRole("button", { name: "Close annotation card", exact: true })
      .click();
    await f.member.setOffline(true);
    await newAnnotation(
      f.page,
      "Delete before first sync.",
      "Temporary thought",
    );
    await f.page.getByRole("button", { name: "Save", exact: true }).click();
    await f.page
      .getByRole("button", { name: "More annotation actions", exact: true })
      .click();
    await f.page
      .getByRole("menuitem", { name: "Delete annotation", exact: true })
      .click();
    await f.page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(f.page.locator("[data-annotation-card]")).toHaveCount(0);
    await f.member.setOffline(false);
    await expect
      .poll(async () =>
        (
          await (
            await f.member.request.get(`/api/v1/notes/${f.note.id}/comments`)
          ).json()
        ).some((c: any) => c.deleted),
      )
      .toBe(true);
    records = await (
      await f.member.request.get(`/api/v1/notes/${f.note.id}/comments`)
    ).json();
    expect(records.filter((c: any) => !c.deleted)).toHaveLength(1);
    expect(await f.source()).toBe(sample);
  } finally {
    await f.member.setOffline(false);
    await f.close();
  }
});

test("private edits never auto-publish when another device shares the card", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  try {
    await newAnnotation(f.page, "Original private thought.", "A hypothesis");
    await f.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      f.page.getByRole("button", { name: "Share annotation", exact: true }),
    ).toBeEnabled();
    const [original] = await (
      await f.member.request.get(`/api/v1/notes/${f.note.id}/comments`)
    ).json();
    await f.member.setOffline(true);
    await f.page
      .getByRole("button", { name: "Edit annotation", exact: true })
      .click();
    await f.page
      .getByRole("textbox", { name: "Annotation title", exact: true })
      .fill("Do not publish this private revision");
    await f.page.getByRole("button", { name: "Save", exact: true }).click();
    // APIRequestContext is independent of the browser's offline network, like
    // a second signed-in device while the first writer is disconnected.
    const shared = await f.member.request.patch(
      `/api/v1/comments/${original.id}`,
      {
        headers: { origin },
        data: { visibility: "shared", version: original.version },
      },
    );
    expect(shared.ok(), await shared.text()).toBe(true);
    await f.page
      .getByRole("button", { name: "Close annotation card", exact: true })
      .click();
    await f.member.setOffline(false);
    // Font metrics may leave enough room for a floating card. Its close action
    // deliberately preserves the previous panel instead of switching it.
    const marksPanel = f.page.getByRole("button", {
      name: "bookmarks panel",
      exact: true,
    });
    if ((await marksPanel.getAttribute("aria-pressed")) !== "true")
      await marksPanel.click();
    await f.page
      .getByRole("button", { name: "Annotations", exact: true })
      .click();
    await expect(
      f.page.getByRole("button", { name: "Recover private copy", exact: true }),
    ).toBeVisible();
    await f.page
      .getByRole("button", { name: "Recover private copy", exact: true })
      .click();
    await expect(
      f.page.locator(".annotation-list-card.is-draft"),
    ).toContainText("Do not publish");
    const [visible] = await (
      await f.owner.request.get(`/api/v1/notes/${f.note.id}/comments`)
    ).json();
    expect(visible.title).toBe("A hypothesis");
    await f.page.reload();
    await f.page
      .getByRole("button", { name: "bookmarks panel", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Annotations", exact: true })
      .click();
    await expect(
      f.page.locator(".annotation-list-card.is-draft"),
    ).toContainText("Do not publish");
  } finally {
    await f.member.setOffline(false);
    await f.close();
  }
});

test("read-only members retain private notes but cannot publish discussion", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  try {
    const me = await (await f.member.request.get("/api/v1/me")).json();
    const members = await (
      await f.owner.request.get(`/api/v1/group-admin/${f.group.id}/members`)
    ).json();
    const member = members.items.find((m: any) => m.id === me.user.id);
    const update = await f.owner.request.patch(
      `/api/v1/group-admin/${f.group.id}/members`,
      {
        headers: { origin },
        data: {
          mutationId: randomUUID(),
          items: [{ id: member.id, version: member.version }],
          contentRole: "viewer",
        },
      },
    );
    expect((await update.json()).results.every((r: any) => r.ok)).toBe(true);
    await f.page.reload();
    await newAnnotation(
      f.page,
      "Personal review while read-only.",
      "Private review",
    );
    await f.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      f.page.getByRole("button", { name: "Share annotation", exact: true }),
    ).toBeDisabled();
    await expect
      .poll(
        async () =>
          (
            await (
              await f.member.request.get(`/api/v1/notes/${f.note.id}/comments`)
            ).json()
          ).length,
      )
      .toBe(1);
    const [entry] = await (
      await f.member.request.get(`/api/v1/notes/${f.note.id}/comments`)
    ).json();
    const forbidden = await f.member.request.patch(
      `/api/v1/comments/${entry.id}`,
      {
        headers: { origin },
        data: { visibility: "shared", version: entry.version },
      },
    );
    expect(forbidden.status()).toBe(403);
    expect(
      await (
        await f.owner.request.get(`/api/v1/notes/${f.note.id}/comments`)
      ).json(),
    ).toEqual([]);
  } finally {
    await f.close();
  }
});

test("nested targets, keyboard menus, hover previews and settings preserve document source", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    await caret(
      f.page
        .locator(".editor-mount .axiom-prose p")
        .filter({ hasText: "A stable observation." }),
      4,
    );
    await f.page.keyboard.press("Alt+Shift+r");
    await f.page
      .getByRole("menuitem", { name: "Bookmark block", exact: true })
      .click();
    await f.page.locator(".reading-margin-marker").hover();
    await expect(f.page.getByRole("tooltip")).toContainText(
      "A stable observation.",
    );
    await f.page.mouse.move(300, 180);
    await expect(f.page.getByRole("tooltip")).toHaveCount(0);
    await f.page
      .locator(".editor-mount .axiom-prose li")
      .filter({ hasText: /^Child$/ })
      .hover();
    await f.page
      .getByRole("button", { name: "Paragraph reading actions", exact: true })
      .click();
    await f.page
      .getByRole("menuitem", { name: "Parent block", exact: true })
      .hover();
    await expect(
      f.page.getByRole("menuitem", { name: "List item", exact: true }),
    ).not.toHaveCount(0);
    await f.page.keyboard.press("Escape");
    await f.page.keyboard.press("Escape");
    await f.page.goto("/workbench/settings/appearance-general");
    const margin = f.page.getByRole("checkbox", {
      name: "Show reading marks in the margin",
      exact: true,
    });
    await expect(margin).toBeVisible();
    await margin.click();
    await f.page.getByRole("button", { name: "Apply", exact: true }).click();
    await f.page.goto(`/workbench/notes/${f.note.id}`);
    await expect(f.page.locator(".reading-margin-marker")).toHaveCount(0);
    await expect(f.page.locator(".reading-mark-overview button")).toHaveCount(
      1,
    );
    await f.page.screenshot({
      path: info.outputPath("reading-overview-only.png"),
    });
    expect(await f.source()).toBe(sample);
  } finally {
    await f.close();
  }
});

test("replaced bookmark targets require explicit reattachment and folded marks reveal their content", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  try {
    await blockMenu(f.page);
    await f.page
      .getByRole("menuitem", { name: "Bookmark block", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "bookmarks panel", exact: true })
      .click();
    await replaceSource(
      f.page,
      "# Replacement\n\nNew destination.\n\n```py\nx=1\ny=2\n```",
    );
    await expect.poll(f.source).toContain("# Replacement");
    await expect(f.page.locator(".reading-bookmark-row")).toContainText(
      "Needs reattachment",
    );
    await f.page.getByRole("button", { name: "Write", exact: true }).click();
    await f.page
      .getByRole("button", {
        name: "Actions for bookmark A stable observation.",
        exact: true,
      })
      .click();
    await f.page
      .getByRole("menuitem", { name: "Reattach to a block", exact: true })
      .click();
    const code = f.page.locator('.axiom-embedded[data-kind="codeBlock"]');
    await code.hover();
    await f.page
      .getByRole("button", { name: "Code reading actions", exact: true })
      .click();
    await f.page
      .getByRole("menuitem", { name: "Attach here", exact: true })
      .click();
    await expect(f.page.locator(".reading-bookmark-row")).not.toContainText(
      "Needs reattachment",
    );
    await f.page
      .getByRole("group", { name: "Block folding" })
      .getByRole("button", { name: /^Collapse py code/ })
      .click();
    await expect(f.page.locator(".axiom-folded-block")).toHaveCount(1);
    await f.page.locator(".reading-margin-marker").click();
    await expect(f.page.locator(".axiom-folded-block")).toHaveCount(0);
  } finally {
    await f.close();
  }
});

test("floating rich cards respect dark appearance, square corners and no shadows", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    const bundle = await (
      await f.member.request.get("/api/v1/me/preferences-bundle", {
        headers: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
      })
    ).json();
    const saved = await f.member.request.patch(
      "/api/v1/me/preferences-bundle",
      {
        headers: { origin },
        data: {
          appearance: {
            version: bundle.appearance.version,
            preferences: {
              ...bundle.appearance.preferences,
              mode: "dark",
              radius: 0,
              shadows: "none",
            },
          },
          editor: bundle.editor,
          mutationId: randomUUID(),
        },
      },
    );
    expect(saved.ok(), await saved.text()).toBe(true);
    await f.page.setViewportSize({ width: 2200, height: 1100 });
    await f.page.reload();
    await newAnnotation(f.page, "", "Mathematical review");
    const editor = f.page.locator(".annotation-editor");
    await editor.getByRole("button", { name: "Source", exact: true }).click();
    await f.page.getByTestId("annotation-editor").click();
    await f.page.keyboard.insertText(
      "A useful identity.\n\n$$\nx^2+y^2=z^2\n$$\n\n```py\nenergy = m*c**2\n```\n\n- Verify dimensions",
    );
    await editor.getByRole("button", { name: "Write", exact: true }).click();
    await expect(
      editor.locator('[data-kind="mathBlock"] .axiom-block-preview svg'),
    ).toBeVisible();
    const card = f.page.locator("[data-annotation-card]");
    await expect(card).toHaveClass(/floating/);
    expect(
      await card.evaluate((el) => ({
        radius: getComputedStyle(el).borderRadius,
        shadow: getComputedStyle(el).boxShadow,
      })),
    ).toEqual({ radius: "0px", shadow: "none" });
    const box = await card.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(2200);
    expect(box!.y + box!.height).toBeLessThanOrEqual(1100);
    await f.page.screenshot({
      path: info.outputPath("dark-rich-annotation-card.png"),
    });
    await expect(
      f.page
        .getByRole("status")
        .filter({ hasText: "Draft saved on this device" }),
    ).toBeVisible();
    await f.page
      .getByRole("button", { name: "New application tab", exact: true })
      .click();
    await expect(f.page.locator("[data-annotation-card]")).toHaveCount(0);
    await f.page
      .getByRole("tab", { name: "Native editor study", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "bookmarks panel", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Annotations", exact: true })
      .click();
    await expect(
      f.page.locator(".annotation-list-card.is-draft"),
    ).toContainText("Mathematical review");
    expect(await f.source()).toBe(sample);
  } finally {
    await f.close();
  }
});
