import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin, caret } from "./native-editor-helpers";
import { latexArticleTypography } from "../../packages/shared/src/document-style";

test.beforeAll(() => {
  if (
    origin !== "http://localhost:3002" ||
    process.env.NEXT_PUBLIC_AXIOM_EDITOR_ENGINE !== "milkdown"
  )
    throw new Error("Use the isolated candidate, never the live workspace.");
});

test("LaTeX decorations survive customization, preview cancellation, reload and personal export", async ({
  browser,
}, info) => {
  const source =
    "# A precise result\n\n## Assumptions\n\n### Derivation\n\nA careful argument.\n\n***\n\n> An explicit observation.\n\nAfter";
  const f = await fixture(browser, source);
  try {
    await f.page.goto("/workbench/settings/typography");
    await f.page
      .getByRole("button", {
        name: "Use LaTeX Article document style",
        exact: true,
      })
      .click();
    await expect(
      f.page.getByLabel("Document decorations", { exact: true }),
    ).toHaveValue("latex");
    const size = f.page.getByLabel("Note font size value", { exact: true });
    await size.fill("22");
    await size.blur();
    await f.page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(f.page.getByLabel("Appearance synchronization")).toContainText(
      "synced to your account",
    );
    await f.page.reload();
    await expect(size).toHaveValue("22");
    await expect(f.page.locator("html")).toHaveAttribute(
      "data-document-decorations",
      "latex",
    );
    await f.page
      .getByLabel("Document decorations", { exact: true })
      .selectOption("none");
    await expect(f.page.locator("html")).toHaveAttribute(
      "data-document-decorations",
      "none",
    );
    await f.page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(f.page.locator("html")).toHaveAttribute(
      "data-document-decorations",
      "latex",
    );
    await f.page.goto("/workbench/notes/" + f.note.id);
    for (const mode of ["Write", "Read"]) {
      await f.page.getByRole("button", { name: mode, exact: true }).click();
      const root =
        mode === "Write"
          ? f.page.locator(".axiom-prose")
          : f.page.locator(".read-mount:not(.print-only)");
      await expect(root.locator("h1")).toHaveAccessibleName("A precise result");
      expect(
        await root
          .locator("[data-section-number]")
          .evaluateAll((els) =>
            els.map((el) => el.getAttribute("data-section-number")),
          ),
      ).toEqual(["1", "1.1", "1.1.1"]);
      expect(
        await root
          .locator("h1")
          .evaluate((el) => getComputedStyle(el, "::before").content),
      ).toContain("§");
      await expect(root.locator("hr")).toHaveCSS("height", "4px");
      await f.page.screenshot({
        path: info.outputPath(`decorations-${mode.toLowerCase()}.png`),
      });
    }
    const response = await f.member.request.get(
      `/api/v1/notes/${f.note.id}/export?format=html&appearance=reading`,
    );
    expect(response.ok()).toBe(true);
    const context = await browser.newContext({
      offline: true,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage();
      await page.setContent(await response.text());
      await expect(page.locator("main h1")).toHaveAccessibleName(
        "A precise result",
      );
      expect(
        await page
          .locator("main [data-section-number]")
          .evaluateAll((els) =>
            els.map((el) => el.getAttribute("data-section-number")),
          ),
      ).toEqual(["1", "1.1", "1.1.1"]);
      expect(
        await page
          .locator("main h1")
          .evaluate((el) => getComputedStyle(el, "::before").content),
      ).toContain("§");
      expect(
        await page
          .locator("header h1")
          .evaluate((el) => getComputedStyle(el, "::before").content),
      ).toBe("none");
      await expect(page.locator("main hr")).toHaveCSS("height", "4px");
    } finally {
      await context.close();
    }
    expect(await f.source()).toBe(source);
  } finally {
    await f.close();
  }
});

test("live quote creation, unwrap and peer edits persist through reload", async ({
  browser,
}) => {
  const f = await fixture(browser, "Before\n\nBody");
  try {
    await caret(f.page.locator(".axiom-prose > p").last(), 0);
    await f.page.keyboard.type(">");
    await expect(f.page.locator(".axiom-prose blockquote")).toHaveCount(0);
    await f.page.keyboard.type(" ");
    const quote = f.page.locator(".axiom-prose blockquote .axiom-source-prose");
    await expect(quote).toHaveText("Body");
    await f.page.keyboard.type("**quoted** ");
    await expect(quote).toHaveText("**quoted** Body");
    await expect.poll(f.source).toBe("Before\n\n> **quoted** Body");
    const peer = await f.owner.newPage();
    await peer.goto("/workbench/notes/" + f.note.id);
    await expect(peer.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await peer.getByRole("button", { name: "Source", exact: true }).click();
    await peer.getByTestId("note-editor").press("ControlOrMeta+Home");
    await peer.keyboard.insertText("Peer result.\n\n");
    await expect
      .poll(f.source)
      .toBe("Peer result.\n\nBefore\n\n> **quoted** Body");
    await caret(quote, 0);
    await f.page.keyboard.press("Backspace");
    await expect
      .poll(f.source)
      .toBe("Peer result.\n\nBefore\n\n**quoted** Body");
    await f.page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(f.source)
      .toBe("Peer result.\n\nBefore\n\n> **quoted** Body");
    await f.page.reload();
    await expect(f.page.locator(".axiom-prose blockquote strong")).toHaveText(
      "quoted",
    );
    await peer.close();
  } finally {
    await f.close();
  }
});

test("v3 clients can read representable preferences but cannot discard saved decorations", async ({
  browser,
}) => {
  const f = await fixture(browser, "Unchanged.");
  try {
    const headers = { "X-Axiom-Appearance-Schema": "3" };
    const old = await (
      await f.member.request.get("/api/v1/me/preferences", { headers })
    ).json();
    expect(old.preferences.schemaVersion).toBe(3);
    expect(old.preferences).not.toHaveProperty("documentDecorations");
    const current = await (
      await f.member.request.get("/api/v1/me/preferences")
    ).json();
    const saved = await f.member.request.patch("/api/v1/me/preferences", {
      headers: { origin },
      data: {
        version: current.version,
        preferences: { ...current.preferences, documentDecorations: "latex" },
        mutationId: randomUUID(),
      },
    });
    expect(saved.ok()).toBe(true);
    const before = await saved.json();
    for (const path of ["preferences", "preferences-bundle"])
      expect(
        (
          await f.member.request.get("/api/v1/me/" + path, { headers })
        ).status(),
      ).toBe(426);
    expect(
      (
        await f.member.request.patch("/api/v1/me/preferences", {
          headers: { origin },
          data: {
            version: before.version,
            preferences: old.preferences,
            mutationId: randomUUID(),
          },
        })
      ).status(),
    ).toBe(426);
    expect(
      await (await f.member.request.get("/api/v1/me/preferences")).json(),
    ).toEqual(before);
  } finally {
    await f.close();
  }
});

test("a pending v3 LaTeX draft upgrades and synchronizes without losing its writing choices", async ({
  browser,
}) => {
  const f = await fixture(browser, "A preserved note.");
  try {
    await f.page.goto("/workbench/settings/typography");
    // The split preview is now visible immediately. Let its worker bootstrap
    // settle before deliberately reloading an old outbox; WebKit otherwise
    // reports the canceled bootstrap as a page error during navigation.
    await expect(
      f.page
        .locator('.settings-scratchpad [data-math-state="ready"] svg')
        .first(),
    ).toBeVisible();
    await expect(f.page.getByLabel("Appearance synchronization")).toContainText(
      "synced to your account",
    );
    await f.page.route("**/api/v1/me/preferences-bundle", (route) =>
      route.abort(),
    );
    const draft = await f.page.evaluate((typography) => {
      const key = Object.keys(localStorage).find((key) =>
        key.startsWith("axiom:preferences-bundle:"),
      )!;
      const saved = JSON.parse(localStorage.getItem(key)!);
      saved.base.appearance.preferences.schemaVersion = 3;
      delete saved.base.appearance.preferences.documentDecorations;
      Object.assign(saved.values.appearance, typography, { schemaVersion: 3 });
      delete saved.values.appearance.documentDecorations;
      saved.values.editor.defaultCodeLanguage = "julia";
      saved.mutationId = crypto.randomUUID();
      return { key, saved };
    }, latexArticleTypography);
    await f.page.addInitScript(
      ({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)),
      draft,
    );
    await f.page.reload();
    await expect(
      f.page.getByLabel("Document decorations", { exact: true }),
    ).toHaveValue("latex");
    await f.page.unroute("**/api/v1/me/preferences-bundle");
    await f.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect
      .poll(async () => {
        const saved = await (
          await f.member.request.get("/api/v1/me/preferences-bundle")
        ).json();
        return [
          saved.appearance.preferences.schemaVersion,
          saved.appearance.preferences.documentDecorations,
          saved.appearance.preferences.proseSize,
          saved.editor.preferences.defaultCodeLanguage,
        ];
      })
      .toEqual([4, "latex", 19, "julia"]);
    expect(await f.source()).toBe("A preserved note.");
  } finally {
    await f.close();
  }
});
