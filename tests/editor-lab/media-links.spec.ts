import { test, expect, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (e) => errors.get(page)!.push(e.message));
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

for (const mode of ["write", "source"] as const) {
  for (const query of ["image", "attachment", "upload"]) {
    test(`${mode}: /${query} hands the entire query to the file picker without editing`, async ({
      page,
    }) => {
      await page.evaluate(async (mode) => {
        await window.editorLab.reset("Before\n\n> ");
        await window.editorLab.mode(0, mode);
        window.editorLab.focus(0, 10);
      }, mode);
      await page.keyboard.type("/" + query);
      const option = page.getByRole("option", { name: "Image or attachment" });
      await expect(option).toBeVisible();
      // A collaborator moves the query while the popup is open.
      await page.evaluate(() => window.editorLab.remote(1, 0, 0, "Peer\n\n"));
      const before = await page.evaluate(() => window.editorLab.snapshot());
      if (query === "attachment") await page.keyboard.press("Enter");
      else await option.click();
      expect(await page.evaluate(() => window.editorLab.hostEvents())).toEqual([
        { kind: "prepare", index: 0, from: 16, to: 17 + query.length },
        { kind: "command", index: 0, target: "attachment" },
      ]);
      await expect(page.getByRole("listbox")).toHaveCount(0);
      expect(await page.evaluate(() => window.editorLab.snapshot())).toEqual(
        before,
      );
    });
  }
}

for (const modifier of ["Meta", "Control"] as const) {
  test(`${modifier}-click opens rendered links once without revealing source or moving the caret`, async ({
    page,
  }) => {
    const source =
      "Caret here\n\nA [**research paper**](https://example.org/paper#results).\n\n[[Research note]]\n\n[Attachment](/api/v1/attachments/12345678-1234-1234-1234-123456789abc)";
    await page.evaluate(async (source) => {
      await window.editorLab.reset(source);
      window.editorLab.focus(0, 5);
    }, source);
    const pane = page.locator('[data-pane="0"]');
    const before = await page.evaluate(() => window.editorLab.snapshot());
    await pane
      .locator(".axiom-inline-link")
      .filter({ hasText: "research paper" })
      .click({ modifiers: [modifier] });
    await pane.locator("a[data-note-target]").click({ modifiers: [modifier] });
    await pane
      .locator(".axiom-inline-link")
      .filter({ hasText: "Attachment" })
      .click({ modifiers: [modifier] });
    expect(await page.evaluate(() => window.editorLab.hostEvents())).toEqual([
      { kind: "link", index: 0, target: "https://example.org/paper#results" },
      { kind: "link", index: 0, target: "Research note" },
      {
        kind: "link",
        index: 0,
        target: "/api/v1/attachments/12345678-1234-1234-1234-123456789abc",
      },
    ]);
    expect(await page.evaluate(() => window.editorLab.snapshot())).toEqual(
      before,
    );
    await expect(
      pane.locator(".axiom-inline-link").filter({ hasText: "research paper" }),
    ).toHaveText("research paper");
  });
}

for (const mode of ["write", "source"] as const) {
  test(`${mode}: modifier-click resolves literal Markdown links while plain typing stays editable`, async ({
    page,
  }) => {
    const source = "[paper](https://example.org) after";
    await page.evaluate(
      async ({ source, mode }) => {
        await window.editorLab.reset(source);
        await window.editorLab.mode(0, mode);
        window.editorLab.focus(0, 3);
      },
      { source, mode },
    );
    const editor = page
      .locator(
        `[data-pane="0"] ${mode === "write" ? ".axiom-source-prose" : ".cm-line"}`,
      )
      .first();
    // Click real glyph coordinates in the literal label, not a repaired caret.
    const point = await editor.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        const index = text.textContent!.indexOf("paper");
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(text, index + 1);
        range.setEnd(text, index + 2);
        const rect = range.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      throw new Error("Missing literal link label");
    });
    const before = await page.evaluate(() => window.editorLab.snapshot());
    await page.keyboard.down("Meta");
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up("Meta");
    expect(await page.evaluate(() => window.editorLab.hostEvents())).toEqual([
      { kind: "link", index: 0, target: "https://example.org" },
    ]);
    expect(await page.evaluate(() => window.editorLab.snapshot())).toEqual(
      before,
    );
    await page.keyboard.type("X");
    expect(
      await page.evaluate(() =>
        window.editorLab.snapshot().map((s) => s.source),
      ),
    ).toEqual([
      "[paXper](https://example.org) after",
      "[paXper](https://example.org) after",
    ]);
  });
}

test("ordinary link clicks edit instead of navigating; unsafe links never activate", async ({
  page,
}) => {
  await page.evaluate(() =>
    window.editorLab.reset(
      "[paper](https://example.org/paper#results)\n\n[unsafe](javascript:alert%281%29)",
    ),
  );
  const pane = page.locator('[data-pane="0"]');
  await pane
    .locator(".axiom-inline-link")
    .filter({ hasText: "unsafe" })
    .click({ modifiers: ["Meta"] });
  expect(await page.evaluate(() => window.editorLab.hostEvents())).toEqual([]);
  await pane.locator(".axiom-inline-link").filter({ hasText: "paper" }).click();
  await expect(pane.locator(".axiom-source-prose").first()).toContainText(
    "[paper](https://example.org/paper#results)",
  );
  expect(await page.evaluate(() => window.editorLab.hostEvents())).toEqual([]);
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    ),
  ).toEqual([0, 0]);
});

test("dragging off a modifier-pressed link cancels navigation and right-click still opens editing actions", async ({
  page,
}) => {
  await page.evaluate(() =>
    window.editorLab.reset("[paper](https://example.org)\n\nElsewhere"),
  );
  const pane = page.locator('[data-pane="0"]');
  await pane.locator(".axiom-inline-link").hover();
  await page.keyboard.down("Meta");
  await page.mouse.down();
  await pane.locator("p").filter({ hasText: "Elsewhere" }).hover();
  await page.mouse.up();
  await page.keyboard.up("Meta");
  expect(await page.evaluate(() => window.editorLab.hostEvents())).toEqual([]);
  await pane.locator(".axiom-inline-link").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Edit link details" }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.editorLab.hostEvents())).toEqual([]);
});

test("viewer links navigate without mutations and permissions dismiss slash uploads", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.editorLab.reset("[paper](https://example.org)");
    window.editorLab.readOnly(0, true);
  });
  await page
    .locator('[data-pane="0"] .axiom-inline-link')
    .click({ modifiers: ["Meta"] });
  expect(await page.evaluate(() => window.editorLab.hostEvents())).toEqual([
    { kind: "link", index: 0, target: "https://example.org" },
  ]);
  expect(
    await page.evaluate(() =>
      window.editorLab.snapshot().map((s) => s.updates),
    ),
  ).toEqual([0, 0]);
  await page.evaluate(async () => {
    await window.editorLab.reset("");
    window.editorLab.focus(0, 0);
  });
  await page.keyboard.type("/image");
  await expect(
    page.getByRole("option", { name: "Image or attachment" }),
  ).toBeVisible();
  await page.evaluate(() => window.editorLab.readOnly(0, true));
  await expect(page.getByRole("listbox")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.editorLab.execute(0, "attachment")),
  ).toBe(false);
  expect(await page.evaluate(() => window.editorLab.hostEvents())).toEqual([]);
});

for (const modifier of ["Meta", "Control"] as const) {
  test(`legacy editor: ${modifier}-click uses the same safe link handoff`, async ({
    page,
  }) => {
    await page.evaluate(async () => {
      await window.editorLab.reset(
        "Caret\n\n[paper](https://example.org)\n\n[[Research note]]",
        true,
      );
      window.editorLab.focus(1, 2);
    });
    const before = await page.evaluate(() => window.editorLab.snapshot());
    const pane = page.locator('[data-pane="1"]');
    await pane
      .getByRole("link", { name: "paper", exact: true })
      .click({ modifiers: [modifier] });
    await pane
      .getByRole("link", { name: "Research note", exact: true })
      .click({ modifiers: [modifier] });
    expect(await page.evaluate(() => window.editorLab.hostEvents())).toEqual([
      { kind: "link", index: 1, target: "https://example.org" },
      { kind: "link", index: 1, target: "Research note" },
    ]);
    expect(await page.evaluate(() => window.editorLab.snapshot())).toEqual(
      before,
    );
  });
}
