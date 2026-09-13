import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Review acceptance uses isolated staging.");
});
test("a milestone review appears in the inbox and approvals never edit accepted content", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "# Review evidence\n\nUnchanged research.\n",
  );
  try {
    const response = await f.member.request.post(
      "/api/v1/resources/" + f.note.id + "/history",
      {
        headers: { origin },
        data: { label: "Evidence checkpoint", mutationId: randomUUID() },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    await f.page.getByRole("button", { name: "Document history" }).click();
    await f.page
      .getByRole("button", { name: "Request review", exact: true })
      .click();
    const dialog = f.page.getByRole("dialog", {
      name: "Request a revision review",
    });
    await dialog
      .getByRole("combobox", { name: "Reviewer" })
      .selectOption({ label: "Native Researcher" });
    await dialog
      .getByRole("textbox", { name: "What should they check?" })
      .fill("Verify the proof and assumptions.");
    await dialog
      .getByRole("button", { name: "Request review", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await f.page
      .getByRole("link", { name: "Review inbox", exact: true })
      .click();
    await expect(f.page.locator(".review-inbox")).toBeVisible();
    await f.page.getByRole("button", { name: "Compare milestone" }).click();
    await expect(
      f.page.getByRole("region", { name: "Version history" }),
    ).toBeVisible();
    await expect(
      f.page.getByRole("combobox", { name: "Before revision" }),
    ).toContainText("Evidence checkpoint");
    await f.page
      .getByRole("button", { name: "Back to document", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Approve review", exact: true })
      .click();
    await f.page
      .getByRole("textbox", { name: "Review notes" })
      .fill("Proof checked; approved.");
    await f.page.getByRole("button", { name: "Submit response" }).click();
    await f.page
      .getByRole("checkbox", { name: "Include completed reviews" })
      .check();
    await expect(f.page.locator(".suggestion-card").first()).toContainText(
      "approved",
    );
    expect(await f.source()).toBe("# Review evidence\n\nUnchanged research.\n");
    await f.page.screenshot({
      path: test.info().outputPath("review-inbox-approved.png"),
    });
  } finally {
    await f.close();
  }
});
test("commenters propose but only editors decide, with atomic overlap rejection and idempotent retries", async ({
  browser,
}) => {
  const f = await fixture(browser, "Alpha result.\n");
  try {
    const me = await (await f.member.request.get("/api/v1/me")).json();
    const members = await (
      await f.owner.request.get(
        "/api/v1/group-admin/" + f.group.id + "/members",
      )
    ).json();
    const member = members.items.find((m: any) => m.id === me.user.id);
    const changed = await f.owner.request.patch(
      "/api/v1/group-admin/" + f.group.id + "/members",
      {
        headers: { origin },
        data: {
          mutationId: randomUUID(),
          items: [{ id: member.id, version: member.version }],
          contentRole: "commenter",
        },
      },
    );
    expect(changed.ok(), await changed.text()).toBe(true);
    await f.page.reload();
    await f.page
      .getByRole("button", { name: "Review suggestions", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Suggest edits", exact: true })
      .click();
    const composer = f.page.getByRole("region", { name: "Suggesting edits" });
    await composer.getByRole("button", { name: "Source", exact: true }).click();
    const editor = composer.getByTestId("note-editor");
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await f.page.keyboard.insertText("Beta result.\n");
    await composer
      .getByRole("button", { name: "Publish proposal", exact: true })
      .click();
    await expect(composer.getByRole("status")).toContainText("published");
    const base = "/api/v1/resources/" + f.note.id + "/suggestions";
    const [proposal] = await (await f.member.request.get(base)).json();
    const duplicate = await f.member.request.post(base, {
      headers: { origin },
      data: {
        id: randomUUID(),
        mutationId: randomUUID(),
        version: 0,
        generation: 1,
        hunks: proposal.hunks.map((h: any) => ({ ...h, insert: "Gamma" })),
        message: "Alternative interpretation",
      },
    });
    expect(duplicate.ok(), await duplicate.text()).toBe(true);
    const all = await (await f.member.request.get(base)).json();
    const bulk = {
      mutationId: randomUUID(),
      generation: 1,
      action: "accept",
      items: all.map((p: any) => ({ id: p.id, version: p.version })),
    };
    const denied = await f.member.request.post(base + "/decision", {
      headers: { origin },
      data: bulk,
    });
    expect(denied.status()).toBe(403);
    const overlap = await f.owner.request.post(base + "/decision", {
      headers: { origin },
      data: { ...bulk, mutationId: randomUUID() },
    });
    expect(overlap.status(), await overlap.text()).toBe(409);
    expect(await f.source()).toBe("Alpha result.\n");
    const accepted = {
      ...bulk,
      mutationId: randomUUID(),
      items: [{ id: proposal.id, version: proposal.version }],
    };
    const first = await f.owner.request.post(base + "/decision", {
      headers: { origin },
      data: accepted,
    });
    expect(first.ok(), await first.text()).toBe(true);
    const retry = await f.owner.request.post(base + "/decision", {
      headers: { origin },
      data: accepted,
    });
    expect(retry.ok(), await retry.text()).toBe(true);
    expect(await retry.json()).toEqual(await first.json());
    expect(await f.source()).toBe("Beta result.\n");
  } finally {
    await f.close();
  }
});
