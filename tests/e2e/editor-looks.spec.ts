import { test, expect } from "@playwright/test";
import { fixture, origin } from "./native-editor-helpers";
test.beforeAll(() => {
  if (
    origin !== "http://localhost:3002" ||
    process.env.NEXT_PUBLIC_AXIOM_EDITOR_ENGINE !== "milkdown"
  )
    throw new Error("Use the isolated candidate.");
});
test("research pages keep light and dark reading surfaces coherent across specialized blocks", async ({
  browser,
}) => {
  const body =
    "---\ntitle: Laboratory notebook\n---\n\n## A clearer view of the experiment\n\nKeep **assumptions explicit**, link the evidence [@review], and leave room for careful thought.[^scope]\n\n- [x] Record the observation\n- [ ] Reproduce the measurement\n\n> [!THEOREM] Energy bound\n> A useful model states its boundary conditions.\n\n| Quantity | Estimate |\n| :--- | ---: |\n| Energy | $E=mc^2$ |\n\n```python\ndef energy(m, c):\n    return m * c**2\n```\n\n$$\nE = mc^2\\label{energy}\n$$\n\n```mermaid\nflowchart LR\nA[Question] --> B[Experiment] --> C[Evidence]\n```\n\n[^scope]: These are notes for discussion, not a final result.\n";
  const f = await fixture(browser, body);
  try {
    for (const [theme, file] of [
      ["Pearl", "light"],
      ["Carbon", "dark"],
    ] as const) {
      await f.page.goto("/workbench/settings/theme");
      await f.page
        .getByRole("button", { name: `Use ${theme} theme`, exact: true })
        .click();
      await f.page.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(
        f.page.getByLabel("Appearance synchronization"),
      ).toContainText("synced to your account");
      await f.page.goto("/workbench/notes/" + f.note.id);
      await expect(f.page.locator(".axiom-prose .axiom-callout")).toBeVisible();
      await expect(
        f.page.locator(".axiom-prose [data-mermaid] svg"),
      ).toBeVisible();
      await expect(
        f.page.locator('.axiom-prose [data-math-state="ready"] svg').first(),
      ).toBeVisible();
      await expect(f.page.locator(".axiom-reference-footer")).toContainText(
        "review",
      );
      expect(
        await f.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await f.page.screenshot({ path: `data/editor-productivity-${file}.png` });
      await f.page.locator(".ws-document-scroll").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect(f.page.locator(".ws-note-footer")).toBeVisible();
      await f.page.screenshot({
        path: `data/editor-productivity-${file}-research.png`,
      });
    }
    expect(await f.source()).toBe(body);
  } finally {
    await f.close();
  }
});
test("new palettes and document styles preview, cancel, persist and never edit the note", async ({
  browser,
}) => {
  const body = "# Personal appearance\n\nThe shared note stays unchanged.\n";
  const f = await fixture(browser, body);
  try {
    await f.page.goto("/workbench/settings/theme");
    await expect(f.page.locator(".palette-gallery .palette-card")).toHaveCount(
      16,
    );
    await f.page
      .getByRole("button", { name: "Use Deep Sea theme", exact: true })
      .click();
    await expect(f.page.locator("html")).toHaveAttribute("data-theme", "dark");
    await f.page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(f.page.getByLabel("Appearance synchronization")).toContainText(
      "synced to your account",
    );
    await f.page.reload();
    await expect(
      f.page.getByRole("button", { name: "Use Deep Sea theme", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(f.page.getByTestId("settings-scratchpad")).toContainText(
      "A little room to think",
    );
    await f.page
      .getByRole("button", { name: "Use Ivory theme", exact: true })
      .click();
    await f.page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(f.page.locator("html")).toHaveAttribute("data-theme", "dark");
    await f.page.getByRole("link", { name: "Typography", exact: true }).click();
    const ui = await f.page
      .getByLabel("Interface font size value", { exact: true })
      .inputValue();
    const heading = f.page.locator(".settings-intro h1");
    const uiHeading = await heading.evaluate(
      (el) => getComputedStyle(el).fontFamily,
    );
    await f.page
      .getByRole("button", { name: "Use Journal document style", exact: true })
      .click();
    await expect(
      f.page.getByLabel("Note font size value", { exact: true }),
    ).toHaveValue("19");
    await expect(
      f.page.getByLabel("Interface font size value", { exact: true }),
    ).toHaveValue(ui);
    await expect(heading).toHaveCSS("font-family", uiHeading);
    await f.page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(f.page.getByLabel("Appearance synchronization")).toContainText(
      "synced to your account",
    );
    await f.page.reload();
    await expect(
      f.page.getByRole("button", {
        name: "Use Journal document style",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await f.page.screenshot({
      path: "data/editor-productivity-journal-dark.png",
    });
    await f.page.goto("/workbench/notes/" + f.note.id);
    for (const mode of ["Write", "Read"]) {
      await f.page.getByRole("button", { name: mode, exact: true }).click();
      const heading = f.page.getByRole("heading", {
        name: "Personal appearance",
        exact: true,
      });
      await expect(heading).toHaveCSS("font-family", /Source Serif 4/);
      const paragraph = f.page
        .getByText("The shared note stays unchanged.", { exact: true })
        .filter({ visible: true });
      await expect(paragraph).toHaveCSS("font-family", /Source Serif 4/);
      expect(
        await paragraph.evaluate(
          (el) =>
            parseFloat(getComputedStyle(el).lineHeight) /
            parseFloat(getComputedStyle(el).fontSize),
        ),
      ).toBeCloseTo(1.85, 2);
    }
    expect(await f.source()).toBe(body);
  } finally {
    await f.close();
  }
});
