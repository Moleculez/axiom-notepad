import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Use isolated staging for preference writes.");
});

test("block range preference previews, cancels, persists, resets and rejects old writers", async ({
  browser,
}, info) => {
  const f = await fixture(
    browser,
    "# Unchanged research\n\n- Parent\n  - Child\n",
  );
  try {
    const page = f.page;
    await page.goto("/workbench/settings/appearance-general");
    await expect(
      page.getByRole("navigation", { name: "Current location" }),
    ).toContainText("General");
    const toggle = page.getByRole("checkbox", {
      name: "Show block ranges",
      exact: true,
    });
    const preview = page.getByLabel("General settings preview", {
      exact: true,
    });
    await expect(toggle).toBeChecked();
    await expect(preview.locator(".axiom-block-guide").first()).toBeVisible();
    const original = await f.source();
    await toggle.uncheck();
    await expect(preview.locator(".axiom-block-guide")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByLabel("Appearance synchronization")).toContainText(
      "synced to your account",
    );
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await page
      .getByRole("button", { name: "Reset section", exact: true })
      .click();
    await expect(toggle).toBeChecked();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByLabel("Appearance synchronization")).toContainText(
      "synced to your account",
    );
    await page.screenshot({
      path: info.outputPath("appearance-general-guides.png"),
    });
    const request = page.context().request;
    const current = await (
      await request.get("/api/v1/me/preferences-bundle", {
        headers: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
      })
    ).json();
    expect(current.appearance.preferences.blockGuides).toBe(true);
    const old = await (
      await request.get("/api/v1/me/preferences-bundle", {
        headers: { "X-Axiom-Appearance-Schema": "5" },
      })
    ).json();
    expect(old.appearance.preferences.schemaVersion).toBe(5);
    expect(old.appearance.preferences).not.toHaveProperty("blockGuides");
    const rejected = await request.patch("/api/v1/me/preferences-bundle", {
      headers: { origin },
      data: {
        appearance: old.appearance,
        editor: old.editor,
        mutationId: randomUUID(),
      },
    });
    expect(rejected.status()).toBe(426);
    expect(await f.source()).toBe(original);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("metadata and guides remain aligned in light, dark and enlarged desktop appearance", async ({
  browser,
}, info) => {
  const source =
    "---\ntitle: A reproducible result\nauthors:\n  - Ada\n  - Emmy\ntags: [physics, research]\n---\n\n# Research\n\n- Record the observation\n  - [ ] Check the assumptions\n\n> Keep context close.\n>\n> > A nested perspective.\n\n$$\nE = mc^2\n$$\n\nNext steps.";
  const f = await fixture(browser, source);
  try {
    const page = f.page;
    const metadata = page.locator(".axiom-metadata");
    const read = async () =>
      (
        await page.context().request.get("/api/v1/me/preferences-bundle", {
          headers: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
        })
      ).json();
    for (const look of ["light", "dark", "large"] as const) {
      if (look === "large") {
        const bundle = await read();
        const response = await page
          .context()
          .request.patch("/api/v1/me/preferences-bundle", {
            headers: { origin },
            data: {
              appearance: {
                version: bundle.appearance.version,
                preferences: {
                  ...bundle.appearance.preferences,
                  mode: "light",
                  uiScale: 1.5,
                  proseSize: 30,
                  radius: 0,
                  documentDecorations: "latex",
                },
              },
              editor: bundle.editor,
              mutationId: randomUUID(),
            },
          });
        expect(response.ok(), await response.text()).toBe(true);
        await page.reload();
      } else await page.emulateMedia({ colorScheme: look });
      await expect(metadata).toBeVisible();
      // Typesetting is intentionally lazy outside the document viewport.
      await page
        .getByRole("button", { name: "Edit display equation", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        page.locator('[data-math-state="ready"]').first(),
      ).toBeVisible();
      await metadata.scrollIntoViewIfNeeded();
      const rows = await metadata.locator("tr").evaluateAll((elements) =>
        elements.map((row) => {
          const key = row.querySelector("th input")!,
            value = row.querySelector("td input, td pre")!;
          const a = key.getBoundingClientRect(),
            b = value.getBoundingClientRect();
          return {
            top: Math.abs(a.top - b.top),
            right: b.right,
            rowRight: row.getBoundingClientRect().right,
            background: getComputedStyle(row.querySelector("th")!)
              .backgroundColor,
          };
        }),
      );
      expect(
        rows.every((row) => row.top < 1 && row.right <= row.rowRight + 1),
      ).toBe(true);
      expect(rows.every((row) => row.background === "rgba(0, 0, 0, 0)")).toBe(
        true,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath("metadata-guides-" + look + ".png"),
      });
    }
    expect(await f.source()).toBe(source);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test("folding remains local while a collaborator edits the shared document", async ({
  browser,
}, info) => {
  const source =
    "Shared introduction.\n\n```python\ndef energy(m):\n    return m * c**2\n```\n\n- Record evidence\n  - Compare\n  - Reproduce\n\nFinal paragraph.";
  const f = await fixture(browser, source);
  const peer = await f.owner.newPage();
  peer.on("pageerror", (e) => f.errors.push(e.message));
  try {
    await peer.goto(`/workbench/notes/${f.note.id}`);
    await expect(peer.getByTestId("note-editor")).toBeVisible();
    await expect(peer.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    const gutter = f.page.getByRole("group", { name: "Block folding" });
    await f.page.getByTestId("note-editor").hover();
    await gutter.getByRole("button", { name: /^Collapse python code/ }).click();
    await expect(f.page.locator(".axiom-folded-block")).toHaveCount(1);
    await expect(peer.locator(".axiom-folded-block")).toHaveCount(0);
    const dimensions = await f.page
      .locator(".axiom-fold-expand, .axiom-fold-toggle")
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          gutter: button.classList.contains("axiom-fold-toggle"),
          height: button.getBoundingClientRect().height,
        })),
      );
    expect(
      dimensions.every((d) => (d.gutter ? d.height === 20 : d.height <= 24)),
    ).toBe(true);
    const paragraph = peer
      .getByTestId("note-editor")
      .locator("p")
      .filter({ hasText: "Shared introduction." });
    await paragraph.click();
    await peer.keyboard.press("End");
    await peer.keyboard.insertText(" Peer update.");
    await expect(f.page.getByTestId("note-editor")).toContainText(
      "Peer update.",
    );
    await expect(f.page.locator(".axiom-folded-block")).toHaveCount(1);
    await expect
      .poll(() => f.source())
      .toBe(
        source.replace(
          "Shared introduction.",
          "Shared introduction. Peer update.",
        ),
      );
    await f.page.screenshot({
      path: info.outputPath("collaborative-folding.png"),
    });
    await gutter.getByRole("button", { name: /^Expand python code/ }).click();
    await expect(f.page.locator(".axiom-folded-block")).toHaveCount(0);
    await expect(f.page.getByTestId("note-editor")).toContainText(
      "return m * c**2",
    );
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
