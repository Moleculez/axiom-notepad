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

test("canceling a leave prompt preserves editing and resumes document reads", async ({
  browser,
}) => {
  const f = await fixture(browser, "Retained draft.\n");
  try {
    await f.page.getByTestId("note-editor").click();
    await f.page.evaluate(() => {
      const warn = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = "";
      };
      (
        window as unknown as {
          cancellationWarn: (event: BeforeUnloadEvent) => void;
        }
      ).cancellationWarn = warn;
      window.addEventListener("beforeunload", warn);
    });
    const prompted = f.page.waitForEvent("dialog", { timeout: 10000 });
    // Engines differ in whether canceled navigation rejects or returns null.
    // The actual beforeunload dialog and retained document are the acceptance.
    const navigating = f.page
      .goto("about:blank", { waitUntil: "commit", timeout: 5000 })
      .catch(() => null);
    const dialog = await prompted;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    await navigating;
    await expect(f.page.getByTestId("note-editor")).toBeVisible();
    await f.page.getByTestId("note-editor").click();
    await f.page.getByRole("button", { name: "Source", exact: true }).click();
    const editor = f.page.getByTestId("note-editor");
    await editor.click();
    await editor.press("ControlOrMeta+End");
    await f.page.keyboard.insertText("Still writable.\n");
    await expect.poll(f.source).toBe("Retained draft.\nStill writable.\n");
    await expect(f.page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    const read = f.page.waitForResponse(
      (response) =>
        response.url().endsWith(`/resources/${f.note.id}/history`) &&
        response.request().method() === "GET",
    );
    await f.page.getByRole("button", { name: "Document history" }).click();
    expect((await read).ok()).toBe(true);
    await expect(
      f.page.getByRole("region", { name: "Version history", exact: true }),
    ).toBeVisible();
  } finally {
    await f.page.evaluate(() => {
      const handler = (
        window as unknown as {
          cancellationWarn?: (event: BeforeUnloadEvent) => void;
        }
      ).cancellationWarn;
      if (handler) window.removeEventListener("beforeunload", handler);
    });
    await f.close();
  }
});
