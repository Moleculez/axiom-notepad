import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
import { defaults } from "../../packages/shared/src/appearance";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Interface acceptance requires the isolated staging database.",
    );
});

async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("matched settings frames keep every edge visible while their contents scroll", async ({
  browser,
}, info) => {
  const f = await fixture(browser, "# Unchanged research\n");
  try {
    await f.page.goto("/workbench/settings/typography");
    await expect(
      f.page.locator('.settings-scratchpad [data-math-state="ready"]').first(),
    ).toBeVisible();
    const fields = f.page.getByLabel("Settings fields", { exact: true });
    const frames = f.page.locator(
      ".settings-fields-pane, .settings-preview-pane",
    );
    for (const fraction of [0, 0.5, 1]) {
      await fields.evaluate(
        (el, value) => el.scrollTo(0, value * el.scrollHeight),
        fraction,
      );
      const bounds = await frames.evaluateAll((elements) =>
        elements.map((el) => {
          const rect = el.getBoundingClientRect(),
            style = getComputedStyle(el);
          return {
            top: rect.top,
            bottom: rect.bottom,
            border: [
              style.borderTopWidth,
              style.borderBottomWidth,
              style.borderColor,
            ],
            radius: style.borderRadius,
            // An inset point beside each edge must still belong to its own pane.
            edgesVisible: [rect.top + 1, rect.bottom - 2].every((y) =>
              el.contains(
                document.elementFromPoint(rect.left + rect.width / 2, y),
              ),
            ),
          };
        }),
      );
      expect(bounds[0].top).toBeCloseTo(bounds[1].top, 0);
      expect(bounds[0].bottom).toBeCloseTo(bounds[1].bottom, 0);
      expect(bounds[0].border).toEqual(bounds[1].border);
      expect(bounds[0].radius).toBe(bounds[1].radius);
      expect(bounds.every((b) => b.edgesVisible)).toBe(true);
      await expect(
        f.page.getByRole("button", { name: "Apply", exact: true }),
      ).toBeInViewport();
      await f.page.screenshot({
        path: info.outputPath(`settings-scroll-${fraction}.png`),
      });
    }
    expect(await fields.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    for (const width of [1024, 1280, 1440, 1920]) {
      await f.page.setViewportSize({ width, height: 1000 });
      const separator = f.page.getByRole("separator", {
        name: "Resize settings and preview",
      });
      for (const key of ["Home", "Enter", "End"]) {
        await separator.press(key);
        await noPageOverflow(f.page);
        expect(
          await f.page
            .locator(".settings-split")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
    }
    expect(await f.source()).toBe("# Unchanged research\n");
  } finally {
    await f.close();
  }
});

test("one preview toolbar preserves both surfaces, writing mode and undo without saving notes", async ({
  browser,
}, info) => {
  const f = await fixture(browser, "Unchanged research.\n");
  try {
    await f.page.goto("/workbench/settings/theme");
    const preview = f.page.getByLabel("Appearance settings preview", {
      exact: true,
    });
    const toolbar = preview.locator(".scratchpad-toolbar");
    await expect(
      toolbar.getByRole("group", { name: "Preview surface", exact: true }),
    ).toBeVisible();
    await expect(f.page.locator(".settings-theme-preview-tabs")).toHaveCount(0);
    const writes: string[] = [];
    f.page.on("request", (r) => {
      if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(r.method()) &&
        /\/api\/v1\/(notes|resources|uploads)/.test(r.url())
      )
        writes.push(r.url());
    });
    await toolbar.getByRole("button", { name: "Source", exact: true }).click();
    const editor = preview.locator(".cm-content");
    await editor.click();
    await editor.press("ControlOrMeta+a");
    await f.page.keyboard.insertText(
      "# Keep this scratch work\n\nA private experiment.",
    );
    await editor.press("ControlOrMeta+End");
    await f.page.keyboard.insertText(" Additional evidence.");
    await toolbar
      .getByRole("button", { name: "Interface", exact: true })
      .click();
    await expect(
      toolbar.getByRole("button", { name: "Source", exact: true }),
    ).toBeHidden();
    await preview
      .getByLabel("Specimen search")
      .fill("Boundary conditions — α, β");
    await preview.getByLabel("Select specimen paper").uncheck();
    await preview.getByRole("button", { name: "Specimen actions" }).click();
    await expect(
      preview.getByRole("group", { name: "Sample action menu" }),
    ).toBeVisible();
    await toolbar.getByRole("button", { name: "Writing", exact: true }).click();
    await expect(
      toolbar.getByRole("button", { name: "Source", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(editor).toContainText("Additional evidence.");
    await editor.click();
    await editor.press("ControlOrMeta+z");
    await expect(editor).not.toContainText("Additional evidence.");
    // The two rapid insertions may form one undo group. Redo must still
    // restore the experiment, proving the mounted editor retained its history.
    await editor.press("ControlOrMeta+Shift+z");
    await expect(editor).toContainText("Keep this scratch work");
    await expect(editor).toContainText("Additional evidence.");
    await toolbar
      .getByRole("button", { name: "Interface", exact: true })
      .click();
    await expect(preview.getByLabel("Specimen search")).toHaveValue(
      "Boundary conditions — α, β",
    );
    await expect(preview.getByLabel("Select specimen paper")).not.toBeChecked();
    await expect(
      preview.getByRole("group", { name: "Sample action menu" }),
    ).toHaveCount(0);
    const specimen = preview.locator(".theme-workbench");
    await specimen.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const specimenScroll = await specimen.evaluate((el) => el.scrollTop);
    await toolbar.getByRole("button", { name: "Writing", exact: true }).click();
    await toolbar
      .getByRole("button", { name: "Interface", exact: true })
      .click();
    expect(await specimen.evaluate((el) => el.scrollTop)).toBe(specimenScroll);
    await f.page.getByRole("button", { name: "Hide live preview" }).click();
    await f.page.getByRole("button", { name: "Show live preview" }).click();
    await expect(preview.getByLabel("Specimen search")).toHaveValue(
      "Boundary conditions — α, β",
    );
    await f.page.screenshot({
      path: info.outputPath("settings-interface-toolbar.png"),
    });
    expect(writes).toEqual([]);
    expect(await f.source()).toBe("Unchanged research.\n");
  } finally {
    await f.close();
  }
});

test("Canvas card headers grow with UI type while editors, ports and selection stay usable", async ({
  browser,
}, info) => {
  const f = await fixture(browser, "Unchanged research.\n");
  // Keep the fixture note open: creating a file refreshes its context in the
  // background. A document reload would cancel those unrelated requests in
  // WebKit before this Canvas-only acceptance check has even started.
  const page = await f.member.newPage();
  page.on("pageerror", (error) => f.errors.push(error.message));
  try {
    const spaces = await (await f.member.request.get("/api/v1/spaces")).json();
    const spaceId = spaces.find(
      (s: { kind: string; group_id: string }) =>
        s.kind === "team" && s.group_id === f.group.id,
    ).id;
    const created = await f.member.request.post("/api/v1/files/new", {
      headers: { origin },
      data: {
        mutationId: randomUUID(),
        type: "canvas",
        name: "Scaled card typography",
        spaceId,
        source: JSON.stringify({
          nodes: [
            {
              id: "text",
              type: "text",
              title: "Boundary conditions and a long research title",
              text:
                "# An observation\n\nKeep **the evidence** readable.\n\n" +
                "A longer paragraph. ".repeat(30),
              x: 0,
              y: 0,
              width: 340,
              height: 280,
              heightMode: "manual",
            },
          ],
          edges: [],
        }),
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const canvas = await created.json();
    await page.goto(`/workbench/tools/canvas/${canvas.id}`);
    const card = page.locator('[data-canvas-node="text"]');
    await expect(card).toBeVisible();
    await expect(page.locator(".canvas-status")).toContainText(
      "Saved on server",
    );
    // CSS preferences affect this visual fixture only, never its shared model.
    await page.evaluate(() => {
      const root = document.documentElement;
      root.style.setProperty("--size-ui", "22.5px");
      root.style.setProperty("--radius", "0px");
      root.style.setProperty("--shadow", "none");
    });
    const header = card.locator(".canvas-card-toolbar");
    const before = (await card.locator(".canvas-card-body").boundingBox())!;
    const heading = (await header.boundingBox())!;
    expect(before.y).toBeGreaterThanOrEqual(heading.y + heading.height - 1);
    await card.locator(".canvas-card-name").dblclick();
    await expect(card.locator(".axiom-prose")).toBeVisible();
    const editing = (await card.locator(".canvas-card-editor").boundingBox())!;
    expect(editing.y).toBeCloseTo(before.y, 0);
    await expect(card).toHaveCSS("border-radius", "0px");
    await expect(card).toHaveCSS("box-shadow", "none");
    await expect(card).toHaveCSS("outline-style", "solid");
    await expect(
      card.getByRole("button", { name: "Connect from right", exact: true }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Source", exact: true }).click();
    await expect(card.locator(".cm-content")).toContainText("the evidence");
    await page.screenshot({
      path: info.outputPath("canvas-scaled-card.png"),
    });
    const saved = await (
      await f.member.request.get(`/api/v1/notes/${canvas.id}`)
    ).json();
    expect(JSON.parse(saved.body).nodes[0]).toMatchObject({
      width: 340,
      height: 280,
    });
    expect(await f.source()).toBe("Unchanged research.\n");
  } finally {
    await f.close();
  }
});

test("desktop pages honor scaled typography, square surfaces and no decorative shadows", async ({
  browser,
}, info) => {
  const f = await fixture(
    browser,
    "# Research\n\n| A | B |\n| --- | --- |\n| x | y |\n\n```python\nx = 1\n```\n",
  );
  try {
    const current = await (
      await f.member.request.get("/api/v1/me/preferences")
    ).json();
    const saved = await f.member.request.patch("/api/v1/me/preferences", {
      headers: { origin },
      data: {
        mutationId: randomUUID(),
        version: current.version,
        preferences: {
          ...defaults,
          mode: "dark",
          themePack: "technical-slate",
          radius: 0,
          shadows: "none",
          uiSize: 22,
          uiScale: 1.5,
          motion: "none",
          proseSize: 25,
        },
      },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    await f.page.setViewportSize({ width: 1440, height: 1000 });
    for (const route of [
      "settings/theme",
      "settings/profile",
      "settings/notifications",
      "settings/groups",
      "workspaces",
      "explorer",
      "trash",
      "audit",
      "tools",
    ]) {
      await f.page.goto("/workbench/" + route);
      await expect(f.page.locator(".ws-app")).toBeVisible();
      await expect(f.page.locator("html")).toHaveAttribute(
        "data-theme",
        "dark",
      );
      await expect(f.page.locator(".ws-loading:visible")).toHaveCount(0);
      if (route === "settings/theme") {
        // Let the lazily loaded math worker finish before navigating away.
        // WebKit reports canceled worker script loads as access-control errors.
        const equations = f.page.locator(
          ".settings-scratchpad [data-math-request]",
        );
        await expect(equations.first()).toBeAttached();
        for (const equation of await equations.all()) {
          await equation.scrollIntoViewIfNeeded();
          await expect(equation).toHaveAttribute("data-math-state", "ready");
        }
        await f.page
          .locator(".settings-scratchpad-scroll")
          .evaluate((el) => el.scrollTo(0, 0));
      }
      if (route === "settings/profile") {
        const form = f.page.locator(".ws-settings-form");
        const inherited = await form.evaluate((el) => {
          const style = getComputedStyle(el);
          return { font: style.fontSize, color: style.color };
        });
        const identity = form.getByRole("heading", {
          name: "Identity",
          exact: true,
        });
        await expect(identity).toHaveCSS("font-size", inherited.font);
        await expect(identity).toHaveCSS("color", inherited.color);
      }
      await noPageOverflow(f.page);
      const styles = await f.page
        .locator(
          ".settings-fields-pane:visible, .settings-preview-pane:visible, .settings-form-section:visible, .console-workspace-card:visible, .tool-launcher:visible",
        )
        .evaluateAll((els) =>
          els.map((el) => {
            const s = getComputedStyle(el);
            return { radius: s.borderRadius, shadow: s.boxShadow };
          }),
        );
      expect(
        styles.every((s) => s.radius === "0px" && s.shadow === "none"),
        route,
      ).toBe(true);
      await f.page.screenshot({
        path: info.outputPath(`harmony-${route.replaceAll("/", "-")}.png`),
      });
    }
    await f.page.goto("/workbench/settings/theme");
    await f.page
      .getByRole("button", { name: "Interface", exact: true })
      .click();
    const sourceSwitch = f.page
      .locator(".scratchpad-surface-switch")
      .getByRole("button", { name: "Writing", exact: true });
    // Establish keyboard modality before focusing: Firefox deliberately keeps
    // programmatic focus mouse-like after the preceding pointer click.
    await f.page.keyboard.press("Tab");
    await sourceSwitch.focus();
    await sourceSwitch.press("Space");
    await expect(sourceSwitch).toHaveAttribute("aria-pressed", "true");
    await expect(sourceSwitch).toBeFocused();
    expect(
      await sourceSwitch.evaluate((el) => getComputedStyle(el).outlineStyle),
    ).not.toBe("none");
    await f.page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await expect(sourceSwitch).toBeFocused();
    await noPageOverflow(f.page);
  } finally {
    await f.close();
  }
});
