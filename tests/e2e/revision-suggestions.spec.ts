import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Suggestion acceptance uses isolated staging.");
});

test("one proposal can be edited in only one tab without overwriting local recovery", async ({
  browser,
}) => {
  const f = await fixture(browser, "Accepted finding.\n");
  try {
    await f.page
      .getByRole("button", { name: "Review suggestions", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Suggest edits", exact: true })
      .click();
    const first = f.page.getByRole("region", {
      name: "Suggesting edits",
      exact: true,
    });
    await first.getByRole("button", { name: "Source", exact: true }).click();
    const editor = first.getByTestId("note-editor");
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await f.page.keyboard.insertText("Proposed finding.\n");
    await first
      .getByRole("button", { name: "Publish proposal", exact: true })
      .click();
    await expect(first.getByRole("status")).toContainText("published");
    const other = await f.member.newPage();
    await other.goto("/workbench/notes/" + f.note.id);
    await expect(other.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await other
      .getByRole("button", { name: "Review suggestions", exact: true })
      .click();
    await other.getByRole("button", { name: "Revise", exact: true }).click();
    const second = other.getByRole("region", {
      name: "Suggesting edits",
      exact: true,
    });
    await expect(second).toContainText("already being edited in another tab");
    await second
      .getByRole("button", { name: "Return to accepted document", exact: true })
      .click();
    await first
      .getByRole("button", { name: "Return to accepted document", exact: true })
      .click();
    await other.getByRole("button", { name: "Revise", exact: true }).click();
    await second.getByRole("button", { name: "Source", exact: true }).click();
    await expect(second.getByTestId("note-editor")).toContainText(
      "Proposed finding",
    );
    expect(await f.source()).toBe("Accepted finding.\n");
    await other.close();
  } finally {
    await f.close();
  }
});

test("native suggestion edits stay private until acceptance; decisions can be undone", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Research\n\nAlpha finding.\n");
  try {
    await f.page
      .getByRole("button", { name: "Review suggestions", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Suggest edits", exact: true })
      .click();
    const composer = f.page.getByRole("region", {
      name: "Suggesting edits",
      exact: true,
    });
    await composer.getByRole("button", { name: "Source", exact: true }).click();
    const editor = composer.getByTestId("note-editor");
    await expect(editor).toBeVisible();
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await f.page.keyboard.insertText("# Research\n\nBeta finding.\n");
    await composer
      .getByRole("textbox", { name: "Note to reviewers" })
      .fill("Updated after replication");
    await composer
      .getByRole("button", { name: "Publish proposal", exact: true })
      .click();
    await expect(composer.getByRole("status")).toContainText("published");
    expect(await f.source()).toBe("# Research\n\nAlpha finding.\n");
    await composer
      .getByRole("button", { name: "Return to accepted document", exact: true })
      .click();
    const review = f.page.getByRole("region", {
      name: "Review suggestions",
      exact: true,
    });
    await review.getByRole("button", { name: "Refresh suggestions" }).click();
    await expect(review.locator(".suggestion-card")).toHaveCount(1);
    await expect(review.locator(".suggestion-explanation")).toContainText(
      "replication",
    );
    await review.getByRole("button", { name: "Accept", exact: true }).click();
    await expect.poll(f.source).toBe("# Research\n\nBeta finding.\n");
    await review.getByRole("button", { name: "Undo last decision" }).click();
    await expect.poll(f.source).toBe("# Research\n\nAlpha finding.\n");
    await review.getByRole("button", { name: "Accept", exact: true }).click();
    await expect.poll(f.source).toBe("# Research\n\nBeta finding.\n");
    await review
      .getByRole("checkbox", { name: "Show decided proposals" })
      .check();
    await f.page.screenshot({
      path: test.info().outputPath("suggestion-reviewed.png"),
    });
  } finally {
    await f.close();
  }
});

test("proposal table and note insertion remain isolated and clearing a proposal removes pending changes", async ({
  browser,
}) => {
  const f = await fixture(browser, "Accepted paragraph.\n");
  try {
    const linked = await f.member.request.post("/api/v1/notes", {
      headers: { origin },
      data: {
        groupId: f.group.id,
        title: "Linked evidence",
        body: "Immutable research context.\n",
      },
    });
    expect(linked.ok(), await linked.text()).toBe(true);
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
    await editor.press("ControlOrMeta+End");
    await composer
      .getByRole("button", { name: "Insert proposal table", exact: true })
      .click();
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "Insert table", exact: true })
      .click();
    await expect(editor).toContainText("|");
    await composer
      .getByRole("button", { name: "Link a note in proposal", exact: true })
      .click();
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: /Linked evidence/ })
      .click();
    await expect(editor).toContainText("Linked evidence");
    await composer
      .getByRole("button", { name: "Publish proposal", exact: true })
      .click();
    await expect(composer.getByRole("status")).toContainText("published");
    expect(await f.source()).toBe("Accepted paragraph.\n");
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await f.page.keyboard.insertText("Accepted paragraph.\n");
    await composer
      .getByRole("button", { name: "Publish proposal", exact: true })
      .click();
    await expect(composer.getByRole("status")).toContainText("cleared");
    const proposals = await (
      await f.member.request.get(
        "/api/v1/resources/" + f.note.id + "/suggestions",
      )
    ).json();
    expect(proposals[0].status).toBe("withdrawn");
    expect(proposals[0].hunks).toEqual([]);
  } finally {
    await f.close();
  }
});

test("sign-out stops proposal publishing while retaining account-scoped recovery", async ({
  browser,
}) => {
  const f = await fixture(browser, "Accepted confidential draft.\n");
  try {
    await f.page
      .getByRole("button", { name: "Review suggestions", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Suggest edits", exact: true })
      .click();
    const composer = f.page.getByRole("region", { name: "Suggesting edits" });
    await composer.getByRole("button", { name: "Source", exact: true }).click();
    const editor = composer.getByTestId("note-editor");
    await f.member.setOffline(true);
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await f.page.keyboard.insertText("Private proposal recovery.\n");
    await expect(composer.getByRole("status")).toContainText("offline");
    await f.page.evaluate(() =>
      window.dispatchEvent(new Event("axiom:close-documents")),
    );
    await f.member.setOffline(false);
    await composer
      .getByRole("button", { name: "Publish proposal", exact: true })
      .click();
    await expect(composer).toContainText("closed");
    expect(
      await (
        await f.member.request.get(
          "/api/v1/resources/" + f.note.id + "/suggestions",
        )
      ).json(),
    ).toHaveLength(0);
    const stored = await f.page.evaluate(async () => {
      const user = JSON.parse(localStorage.getItem("axiom:session")!).user.id;
      return new Promise<any[]>((resolve, reject) => {
        const r = indexedDB.open("axiom:proposals:" + user);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("drafts"),
            request = tx.objectStore("drafts").getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(request.result);
          };
          tx.onabort = () => reject(tx.error);
        };
      });
    });
    expect(
      stored.some((d) => d.source === "Private proposal recovery.\n"),
    ).toBe(true);
  } finally {
    await f.member.setOffline(false);
    await f.close();
  }
});

test("offline suggestion recovery survives reopening and publishes on reconnect", async ({
  browser,
}) => {
  const f = await fixture(browser, "Accepted result.\n");
  try {
    await f.page
      .getByRole("button", { name: "Review suggestions", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Suggest edits", exact: true })
      .click();
    const composer = f.page.getByRole("region", {
      name: "Suggesting edits",
      exact: true,
    });
    await composer.getByRole("button", { name: "Source", exact: true }).click();
    const editor = composer.getByTestId("note-editor");
    await expect(editor).toBeVisible();
    await f.member.setOffline(true);
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await f.page.keyboard.insertText("Offline proposed result.\n");
    await expect(composer.getByRole("status")).toContainText("offline");
    await composer
      .getByRole("button", { name: "Return to accepted document" })
      .click();
    await f.page
      .getByRole("button", { name: "Suggest edits", exact: true })
      .click();
    await composer.getByRole("button", { name: "Source", exact: true }).click();
    await expect(editor).toContainText("Offline proposed result");
    await f.member.setOffline(false);
    await composer.getByRole("button", { name: "Publish proposal" }).click();
    await expect(composer.getByRole("status")).toContainText("published");
    expect(await f.source()).toBe("Accepted result.\n");
    const proposals = await (
      await f.member.request.get(
        "/api/v1/resources/" + f.note.id + "/suggestions",
      )
    ).json();
    expect(proposals).toHaveLength(1);
    const response = await f.member.request.post(
      "/api/v1/resources/" + f.note.id + "/suggestions/decision",
      {
        headers: { origin },
        data: {
          mutationId: randomUUID(),
          generation: 1,
          action: "accept",
          items: [{ id: proposals[0].id, version: proposals[0].version }],
        },
      },
    );
    expect(response.ok(), await response.text()).toBeTruthy();
    await expect.poll(f.source).toBe("Offline proposed result.\n");
  } finally {
    await f.member.setOffline(false);
    await f.close();
  }
});
