import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin, caret } from "./native-editor-helpers";

test.beforeAll(() => {
  if (
    !["http://localhost:3002", "http://localhost:3004"].includes(origin) ||
    process.env.NEXT_PUBLIC_AXIOM_EDITOR_ENGINE !== "milkdown"
  )
    throw new Error(
      "Use the isolated editor candidate; never run these writes on live notes.",
    );
});

test("edge buttons and anchored menus persist, rebase around a peer and retain author-local undo", async ({
  browser,
}) => {
  const body =
    "Before\r\n\r\n| Quantity | Model |\r\n| --- | --- |\r\n| Energy | mass |\r\n\r\nAfter";
  const f = await fixture(browser, body);
  try {
    const table = f.page.locator(".axiom-table-shell");
    await caret(table.locator("td").first());
    await table.getByRole("button", { name: "Add column at right" }).click();
    await f.page.keyboard.type("unit");
    await expect.poll(f.source).toContain("| Energy | mass | unit |\r\n");
    const columnAdded = await f.source();
    const peer = await f.owner.newPage();
    peer.on("pageerror", (error) => f.errors.push(error.message));
    await peer.goto("/workbench/notes/" + f.note.id);
    await expect(peer.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await peer.getByRole("button", { name: "Source", exact: true }).click();
    await table
      .getByRole("button", { name: "Table actions", exact: true })
      .click();
    await peer.getByTestId("note-editor").press("ControlOrMeta+Home");
    await peer.keyboard.insertText("Peer result.\n\n");
    await expect(f.page.getByTestId("note-editor")).toContainText(
      "Peer result.",
    );
    await expect.poll(f.source).toContain("Peer result.");
    const rebased = await f.source();
    expect(rebased).toContain(columnAdded);
    await f.page
      .getByRole("dialog", { name: "Table actions", exact: true })
      .getByRole("button", { name: "Insert row below", exact: true })
      .click();
    await f.page.keyboard.type("observation");
    await expect.poll(f.source).toContain("|  |  | observation |\r\n");
    await f.page.keyboard.press("ControlOrMeta+z");
    await f.page.keyboard.press("ControlOrMeta+z");
    await expect.poll(f.source).toBe(rebased);
    await f.page.reload();
    await expect(table.locator("th")).toHaveCount(3);
    expect(await f.source()).toBe(rebased);
    await peer.close();
  } finally {
    await f.close();
  }
});

test("LaTeX Article previews and persists independently of colors, matches Read, and exports offline fonts", async ({
  browser,
}, info) => {
  const body =
    "# A precise result\n\nA **strong** claim with *explicit assumptions*.\n\n| Quantity | Estimate |\n| :--- | ---: |\n| Energy | $E=mc^2$ |\n\n```python\nenergy = mass * c**2\n```\n\n$$\nE = mc^2\n$$\n";
  const f = await fixture(browser, body);
  try {
    await f.page.goto("/workbench/settings/typography");
    const ui = await f.page
      .locator(".settings-intro h1")
      .evaluate((el) => getComputedStyle(el).fontFamily);
    const style = f.page.getByRole("button", {
      name: "Use LaTeX Article document style",
      exact: true,
    });
    await style.click();
    await expect(
      f.page.getByLabel("Note font size value", { exact: true }),
    ).toHaveValue("19");
    await expect(f.page.locator(".settings-intro h1")).toHaveCSS(
      "font-family",
      ui,
    );
    await f.page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(style).toHaveAttribute("aria-pressed", "false");
    await style.click();
    await f.page.getByRole("link", { name: "Theme", exact: true }).click();
    await f.page
      .getByRole("button", { name: "Use Paper Ink theme", exact: true })
      .click();
    await f.page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(f.page.getByLabel("Appearance synchronization")).toContainText(
      "synced to your account",
    );
    await f.page.goto("/workbench/settings/typography");
    await expect(style).toHaveAttribute("aria-pressed", "true");
    await f.page.goto("/workbench/notes/" + f.note.id);
    const faces = await f.page.evaluate(async () => {
      return Promise.all(
        ["400", "700", "italic 400", "italic 700"].map(async (face) =>
          (await document.fonts.load(`${face} 19px "Axiom Latin Modern"`)).map(
            (font) => font.status,
          ),
        ),
      );
    });
    expect(faces).toEqual([["loaded"], ["loaded"], ["loaded"], ["loaded"]]);
    const measurements: unknown[] = [];
    for (const mode of ["Write", "Read"]) {
      await f.page.getByRole("button", { name: mode, exact: true }).click();
      const root =
        mode === "Write"
          ? f.page.locator(".axiom-prose")
          : f.page.locator(".read-mount:not(.print-only)");
      await expect(root.locator("h1")).toHaveCSS(
        "font-family",
        /Axiom Latin Modern/,
      );
      await expect(
        root.locator('[data-math-state="ready"] svg').first(),
      ).toBeVisible();
      await expect(
        root.locator('[data-math-request]:not([data-math-state="ready"])'),
      ).toHaveCount(0);
      const tableBox = (await root.locator("table").boundingBox())!;
      const rowBox = (await root.locator("tr").first().boundingBox())!;
      expect(Math.abs(tableBox.width - rowBox.width)).toBeLessThan(2);
      measurements.push(
        await root.locator("h1").evaluate((el) => {
          const css = getComputedStyle(el);
          return [css.fontSize, css.fontFamily, css.fontWeight, css.lineHeight];
        }),
      );
      await f.page.screenshot({
        path: info.outputPath(`latex-article-${mode.toLowerCase()}.png`),
      });
    }
    expect(measurements[0]).toEqual(measurements[1]);
    const exported = await f.member.request.get(
      `/api/v1/notes/${f.note.id}/export?format=html&appearance=reading`,
    );
    expect(exported.ok(), await exported.text()).toBeTruthy();
    const html = await exported.text();
    expect(html).toContain('font-family:"Axiom Latin Modern"');
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).not.toContain('url("./axiom-lm-');
    // A standalone export needs neither the app nor a font CDN.
    const exportContext = await browser.newContext({
      offline: true,
      serviceWorkers: "block",
    });
    try {
      const exportPage = await exportContext.newPage();
      exportPage.on("pageerror", (error) => f.errors.push(error.message));
      await exportPage.setContent(html);
      expect(
        await exportPage.evaluate(async () =>
          (await document.fonts.load('19px "Axiom Latin Modern"')).every(
            (font) => font.status === "loaded",
          ),
        ),
      ).toBe(true);
    } finally {
      await exportContext.close();
    }
    await f.page.goto("/workbench/settings/theme");
    await f.page
      .getByRole("button", { name: "Use Night Paper theme", exact: true })
      .click();
    await f.page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(f.page.getByLabel("Appearance synchronization")).toContainText(
      "synced to your account",
    );
    await f.page.reload();
    await expect(
      f.page.getByRole("button", {
        name: "Use Night Paper theme",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await f.page.goto("/workbench/settings/typography");
    await expect(style).toHaveAttribute("aria-pressed", "true");
    expect(await f.source()).toBe(body);
  } finally {
    await f.close();
  }
});

test("legacy appearance clients cannot overwrite new fonts or lose their settings silently", async ({
  browser,
}) => {
  const f = await fixture(browser, "Unchanged document.");
  try {
    const headers = { "X-Axiom-Appearance-Schema": "2" };
    const legacy = await f.member.request.get("/api/v1/me/preferences", {
      headers,
    });
    expect(legacy.ok()).toBe(true);
    const old = await legacy.json();
    expect(old.preferences.schemaVersion).toBe(2);
    expect(
      (
        await f.member.request.patch("/api/v1/me/preferences", {
          headers: { origin },
          data: { ...old, mutationId: randomUUID() },
        })
      ).status(),
    ).toBe(426);
    const current = await (
      await f.member.request.get("/api/v1/me/preferences-bundle")
    ).json();
    expect(current.appearance.preferences.schemaVersion).toBe(5);
    expect(current.editor.preferences.schemaVersion).toBe(2);
    const saved = await f.member.request.patch(
      "/api/v1/me/preferences-bundle",
      {
        headers: { origin },
        data: {
          appearance: {
            version: current.appearance.version,
            preferences: {
              ...current.appearance.preferences,
              proseFont: "latinModern",
            },
          },
          editor: current.editor,
          mutationId: randomUUID(),
        },
      },
    );
    expect(saved.ok(), await saved.text()).toBe(true);
    for (const path of ["preferences", "preferences-bundle"])
      expect(
        (
          await f.member.request.get("/api/v1/me/" + path, { headers })
        ).status(),
      ).toBe(426);
    const before = await saved.json();
    expect(
      (
        await f.member.request.patch("/api/v1/me/preferences-bundle", {
          headers: { origin },
          data: {
            ...before,
            appearance: {
              ...before.appearance,
              preferences: { ...old.preferences, proseSize: 25 },
            },
            mutationId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(426);
    expect(
      await (
        await f.member.request.get("/api/v1/me/preferences-bundle")
      ).json(),
    ).toEqual(before);
    expect(await f.source()).toBe("Unchanged document.");
  } finally {
    await f.close();
  }
});

test("a pending v2 appearance outbox upgrades without discarding offline writing choices", async ({
  browser,
}) => {
  const f = await fixture(browser, "Keep this note.");
  try {
    await f.page.goto("/workbench/settings/typography");
    await expect(f.page.getByLabel("Appearance synchronization")).toContainText(
      "synced to your account",
    );
    await f.page.route("**/api/v1/me/preferences-bundle", (route) =>
      route.abort(),
    );
    const legacyDraft = await f.page.evaluate(() => {
      const key = Object.keys(localStorage).find((key) =>
        key.startsWith("axiom:preferences-bundle:"),
      )!;
      const saved = JSON.parse(localStorage.getItem(key)!);
      saved.base.appearance.preferences.schemaVersion = 2;
      saved.values.appearance.schemaVersion = 2;
      delete saved.base.appearance.preferences.documentDecorations;
      delete saved.values.appearance.documentDecorations;
      saved.values.appearance.proseSize = 26;
      saved.values.editor.defaultCodeLanguage = "julia";
      saved.mutationId = crypto.randomUUID();
      return { key, saved };
    });
    // Seed the old outbox before the upgraded app starts, not underneath an
    // already-running controller that still owns the current cache revision.
    await f.page.addInitScript(({ key, saved }) => {
      localStorage.setItem(key, JSON.stringify(saved));
    }, legacyDraft);
    await f.page.reload();
    await expect(
      f.page.getByLabel("Note font size value", { exact: true }),
    ).toHaveValue("26");
    await f.page.unroute("**/api/v1/me/preferences-bundle");
    await f.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect
      .poll(async () => {
        const saved = await (
          await f.member.request.get("/api/v1/me/preferences-bundle")
        ).json();
        return [
          saved.appearance.preferences.schemaVersion,
          saved.appearance.preferences.proseSize,
          saved.editor.preferences.defaultCodeLanguage,
        ];
      })
      .toEqual([4, 26, "julia"]);
    expect(await f.source()).toBe("Keep this note.");
  } finally {
    await f.close();
  }
});
