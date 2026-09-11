import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";

test.beforeAll(() => {
  if (origin !== "http://localhost:3002")
    throw new Error(
      "Productivity tests require the isolated staging app on port 3002.",
    );
});
test("color controls are visible, validate partial values and retain the draft across categories", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "# Unchanged research\n\nKeep this note intact.",
  );
  try {
    await f.page.goto("/workbench/settings/theme");
    await f.page.getByText("Visual theme editor", { exact: true }).click();
    const picker = f.page.getByLabel("Accent & links color picker"),
      value = f.page.getByLabel("Accent & links color value");
    const box = await picker.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(30);
    expect(box!.width).toBeLessThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(30);
    const original = await picker.inputValue();
    await value.fill("#f");
    await value.press("Tab");
    await expect(value).toHaveAttribute("aria-invalid", "true");
    await expect(picker).toHaveValue(original);
    await expect(
      f.page.getByRole("button", { name: "Apply", exact: true }),
    ).toBeDisabled();
    await value.fill("rgb(25, 100, 200)");
    await value.press("Enter");
    await expect(value).toHaveValue("#1964c8");
    await expect(picker).toHaveValue("#1964c8");
    await f.page.getByRole("link", { name: "Typography", exact: true }).click();
    const size = f.page.getByLabel("Reading size value");
    // Find the actual numeric reading setting without relying on a static font size.
    const numeric = (await size.count())
      ? size
      : f.page.locator('.preference-number input[type="number"]').first();
    const max = await numeric.getAttribute("max");
    await numeric.fill("");
    await expect(numeric).toHaveValue("");
    await numeric.fill(max!);
    await numeric.press("Enter");
    await expect(numeric).toHaveValue(max!);
    await f.page.getByRole("link", { name: "Theme", exact: true }).click();
    await f.page.getByText("Visual theme editor", { exact: true }).click();
    await expect(f.page.getByLabel("Accent & links color picker")).toHaveValue(
      "#1964c8",
    );
    await f.page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(f.page.locator(".settings-draft-status")).not.toContainText(
      "Unsaved changes",
    );
    await f.page.reload();
    await f.page.getByText("Visual theme editor", { exact: true }).click();
    await expect(f.page.getByLabel("Accent & links color picker")).toHaveValue(
      "#1964c8",
    );
    expect(await f.source()).toBe(
      "# Unchanged research\n\nKeep this note intact.",
    );
  } finally {
    await f.close();
  }
});
test("writing previews use an isolated editable engine with table menus and source switching", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "# Persistent note\n\nNot the settings scratchpad.",
  );
  try {
    const engineWarnings: string[] = [];
    f.page.on("console", (message) => {
      if (message.text().includes("Yjs was already imported"))
        engineWarnings.push(message.text());
    });
    await f.page.goto("/workbench/settings/tables");
    const editor = f.page.getByTestId("settings-scratchpad");
    await expect(editor).toBeVisible();
    const writes: string[] = [];
    f.page.on("request", (r) => {
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(r.method()) &&
        /\/api\/v1\/(notes|resources|uploads)/.test(r.url())
      )
        writes.push(r.url());
    });
    await editor.locator("td").first().click({ button: "right" });
    await expect(
      process.env.NEXT_PUBLIC_AXIOM_EDITOR_ENGINE === "milkdown"
        ? f.page.getByRole("dialog", { name: "Table actions", exact: true })
        : f.page.getByRole("menu"),
    ).toBeVisible();
    await f.page.keyboard.press("Escape");
    await f.page
      .locator(".settings-scratchpad")
      .getByRole("button", { name: "Source", exact: true })
      .click();
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await f.page.keyboard.insertText("Scratch only\n\n- [ ] Try a task\n");
    await f.page
      .locator(".settings-scratchpad")
      .getByRole("button", { name: "Write", exact: true })
      .click();
    await expect(editor).toContainText("Scratch only");
    await f.page
      .getByRole("button", { name: "Reset sample", exact: true })
      .click();
    await expect(editor).toContainText("Energy");
    expect(writes).toEqual([]);
    expect(await f.source()).toBe(
      "# Persistent note\n\nNot the settings scratchpad.",
    );
    for (const category of ["code", "math", "writing"]) {
      await f.page.goto(`/workbench/settings/${category}`);
      await expect(f.page.getByTestId("settings-scratchpad")).toBeVisible();
    }
    expect(engineWarnings).toEqual([]);
  } finally {
    await f.close();
  }
});
test("overscroll and malformed queued reading data never interrupt continued Markdown input", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Progress\n\nKeep typing.");
  try {
    const badId = randomUUID(),
      goodId = randomUUID();
    const groupId = f.group.id;
    await f.page.evaluate(
      async ({ badId, goodId, groupId, noteId }) => {
        const userId = JSON.parse(localStorage.getItem("axiom:session")!).user
          .id;
        const db = await new Promise<IDBDatabase>((done, fail) => {
          const req = indexedDB.open(`axiom:${userId}:research-v1`, 1);
          req.onsuccess = () => done(req.result);
          req.onerror = () => fail(req.error);
        });
        await new Promise<void>((done, fail) => {
          const tx = db.transaction("items", "readwrite");
          for (const id of [badId, goodId])
            tx.objectStore("items").put({
              key: `reading:${id}`,
              kind: "reading",
              groupId,
              pending: true,
              value: {
                id,
                group_id: groupId,
                kind: "bookmark",
                target_type: "note",
                target_id: noteId,
                version: 0,
                mutation_id: crypto.randomUUID(),
                deleted: false,
                data: {
                  label: id === badId ? 123 : "Recovered bookmark",
                  fraction: 2.5,
                },
              },
            });
          tx.oncomplete = () => done();
          tx.onerror = () => fail(tx.error);
        });
        db.close();
        window.dispatchEvent(new Event("focus"));
      },
      { badId, goodId, groupId, noteId: f.note.id },
    );
    await expect
      .poll(async () => {
        const response = await f.member.request.get(
          `/api/v1/me/reading?groupId=${groupId}`,
        );
        return (await response.json()).find((i: any) => i.id === goodId)?.data
          .fraction;
      })
      .toBe(1);
    await f.page.locator(".ws-document-scroll").evaluate((el) => {
      el.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      Object.defineProperties(el, {
        scrollTop: { configurable: true, writable: true, value: 500 },
        scrollHeight: { configurable: true, value: 200 },
        clientHeight: { configurable: true, value: 100 },
      });
      el.dispatchEvent(new Event("scroll"));
    });
    await f.page.getByRole("button", { name: "Source", exact: true }).click();
    const editor = f.page.getByTestId("note-editor");
    await editor.click();
    await editor.press("ControlOrMeta+End");
    await f.page.keyboard.insertText(
      "\n\n- [ ] Continued without interruption\n",
    );
    await expect.poll(f.source).toContain("Continued without interruption");
    await expect(f.page.locator(".ws-document")).not.toContainText('"too_big"');
    await expect(f.page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
  } finally {
    await f.close();
  }
});
