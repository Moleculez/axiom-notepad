import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fixture, origin, caret } from "./native-editor-helpers";
import type { MinimapPreferences } from "../../packages/shared/src/minimap";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Use isolated staging for minimap acceptance.");
});
const sample =
  "# Abstract\n\nOpening observation.\n\n## Method\n\n- Parent\n  - Child\n\n> Keep the assumptions.\n\n$$\nE=mc^2\n$$\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```python\nx = 1\ny = 2\n```\n\n" +
  Array.from(
    { length: 65 },
    (_, i) =>
      `## Section ${i + 1}\n\nObservation ${i + 1}: reproducibility matters.\n\n`,
  ).join("") +
  "[^a]: A final footnote.\n\nSee the note[^a].";
const scroller = (page: Page) =>
  page.locator(".ws-document-main .ws-document-scroll");
async function command(page: Page, name: string) {
  await page.bringToFront();
  await page.keyboard.press("ControlOrMeta+Shift+.");
  await page
    .getByRole("combobox", { name: "Find a command", exact: true })
    .fill(name);
  await page.getByRole("option").filter({ hasText: name }).click();
}
async function preferences(
  f: Awaited<ReturnType<typeof fixture>>,
  patch: Partial<MinimapPreferences>,
  appearance: Record<string, unknown> = {},
) {
  const bundle = await (
    await f.member.request.get("/api/v1/me/preferences-bundle")
  ).json();
  const response = await f.member.request.patch(
    "/api/v1/me/preferences-bundle",
    {
      headers: { origin },
      data: {
        appearance: {
          version: bundle.appearance.version,
          preferences: {
            ...bundle.appearance.preferences,
            ...appearance,
            minimap: {
              ...bundle.appearance.preferences.minimap,
              enabled: true,
              ...patch,
            },
          },
        },
        editor: bundle.editor,
        mutationId: randomUUID(),
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  await f.page.reload();
  await expect(
    f.page.getByRole("scrollbar", { name: "Document minimap scroll position" }),
  ).toBeVisible();
}
async function painted(page: Page) {
  await expect(page.locator(".minimap-canvas")).toHaveAttribute(
    "data-paint-count",
    /[1-9]/,
  );
}

async function markerPositionError(
  page: Page,
  label: string,
  size: MinimapPreferences["size"],
  target?: Locator,
) {
  // Measure the actual rendered caret/search line independently of the app's
  // source index. This catches both incorrect scaling and character/line drift.
  const point = target
    ? await target.evaluate((el) => {
        const box = el.getClientRects()[0];
        return (box.top + box.bottom) / 2;
      })
    : await page.evaluate(() => {
        const selection = getSelection();
        if (!selection?.rangeCount) throw new Error("Missing editor caret");
        const range = selection.getRangeAt(0).cloneRange();
        let rect = range.getBoundingClientRect();
        if (!rect.height && range.startContainer.nodeType === Node.TEXT_NODE) {
          const length = range.startContainer.textContent!.length;
          const at = range.startOffset;
          range.setStart(range.startContainer, at < length ? at : at - 1);
          range.setEnd(range.startContainer, at < length ? at + 1 : at);
          rect = range.getBoundingClientRect();
        }
        return (rect.top + rect.bottom) / 2;
      });
  return page.evaluate(
    ({ label, size, point }) => {
      const root = document.querySelector<HTMLElement>(
        ".ws-document-main .ws-document-scroll",
      )!;
      const map = document.querySelector<HTMLElement>(".document-minimap")!;
      const marker = Array.from(
        map.querySelectorAll<HTMLElement>(".minimap-marker"),
      ).find((el) => el.title.split(" · ").includes(label));
      if (!marker) return Infinity;
      const mapBox = map.getBoundingClientRect(),
        rootBox = root.getBoundingClientRect();
      const natural = Math.max(
        0.015,
        Math.min(0.3, (mapBox.width - 8) / rootBox.width),
      );
      const scale =
        size === "fill"
          ? rootBox.height / root.scrollHeight
          : size === "fit"
            ? Math.min(natural, rootBox.height / root.scrollHeight)
            : natural;
      const offset =
        Math.max(0, root.scrollHeight * scale - rootBox.height) *
        (root.scrollTop / Math.max(1, root.scrollHeight - rootBox.height));
      const expected = (point - rootBox.top + root.scrollTop) * scale - offset;
      const box = marker.getBoundingClientRect();
      return Math.abs((box.top + box.bottom) / 2 - mapBox.top - expected);
    },
    { label, size, point },
  );
}

for (const mode of ["Write", "Source"] as const)
  for (const size of ["fit", "fill", "proportional"] as const)
    test(`cursor and search marker alignment: ${mode}, ${size}`, async ({
      browser,
    }, info) => {
      const opening = "Opening alignmentneedle on a single text line.";
      const paragraph =
        "A wrapped research paragraph: " +
        "measured uncertainty and reproducible observations; ".repeat(22) +
        "finally alignmentneedle at the end.";
      const body =
        `${opening}\n\n${paragraph}\n\n` +
        (size === "proportional"
          ? Array.from(
              { length: 90 },
              (_, i) => `## Section ${i}\n\nLater observation ${i}.\n\n`,
            ).join("")
          : "A closing observation.");
      const f = await fixture(browser, body);
      try {
        await preferences(
          f,
          { size, width: 160, headings: false, slider: "always" },
          { codeWrap: true },
        );
        if (mode === "Source")
          await f.page.getByRole("button", { name: mode, exact: true }).click();
        await painted(f.page);
        const line = f.page
          .getByTestId("note-editor")
          .locator(mode === "Write" ? "p" : ".cm-line")
          .filter({ hasText: opening });
        await caret(line, 1);
        await expect
          .poll(() => markerPositionError(f.page, "Editing position", size))
          .toBeLessThan(1.5);
        await caret(line);
        await expect
          .poll(() => markerPositionError(f.page, "Editing position", size))
          .toBeLessThan(1.5);
        const wrapped = f.page
          .getByTestId("note-editor")
          .locator(mode === "Write" ? "p" : ".cm-line")
          .filter({ hasText: paragraph });
        await caret(wrapped);
        await expect
          .poll(() => markerPositionError(f.page, "Editing position", size))
          .toBeLessThan(1.5);
        await f.page.keyboard.press("ArrowUp");
        await expect
          .poll(() => markerPositionError(f.page, "Editing position", size))
          .toBeLessThan(1.5);

        await command(f.page, "Find in note");
        await f.page
          .locator(".axiom-find input[type='search']")
          .fill("alignmentneedle");
        const results = f.page.locator(".axiom-search-range");
        await expect(results).toHaveCount(2);
        // Nearby cursor/selection/search marks can cluster within eight pixels.
        for (const i of [0, 1])
          await expect
            .poll(() =>
              markerPositionError(
                f.page,
                `Search result ${i + 1}`,
                size,
                results.nth(i),
              ),
            )
            .toBeLessThan(5);
        if (size === "proportional") {
          await scroller(f.page).evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
          await expect(
            f.page.locator('.minimap-marker[title*="Search result"]'),
          ).toHaveCount(0);
          await scroller(f.page).evaluate((el) => {
            el.scrollTop = 0;
          });
          await expect
            .poll(() =>
              markerPositionError(
                f.page,
                "Search result 1",
                size,
                results.first(),
              ),
            )
            .toBeLessThan(5);
        }
        await f.page.screenshot({
          path: info.outputPath(
            `minimap-marker-${mode.toLowerCase()}-${size}.png`,
          ),
        });
        expect(await f.source()).toBe(body);
      } finally {
        await f.close();
      }
    });

test("marker alignment follows typing, resizing, embedded editors and folds", async ({
  browser,
}, info) => {
  const body =
    "Opening observation.\n\n```python\nfirst = 1\ntargetcode = 2\nlast = 3\n```\n\n$$\nx=1\n+y\n$$\n\nA closing observation.";
  const f = await fixture(browser, body);
  try {
    await preferences(f, { size: "fill", headings: false, width: 160 });
    const code = f.page.locator(
      '.axiom-embedded[data-kind="codeBlock"] .cm-content',
    );
    await code.click();
    await code.press("ControlOrMeta+Home");
    await code.press("ArrowDown");
    await code.press("End");
    await expect
      .poll(() => markerPositionError(f.page, "Editing position", "fill"))
      .toBeLessThan(1.5);
    await f.page.keyboard.insertText(" + 4");
    await expect.poll(f.source).toContain("targetcode = 2 + 4");
    await expect
      .poll(() => markerPositionError(f.page, "Editing position", "fill"))
      .toBeLessThan(1.5);
    await f.page.setViewportSize({ width: 1600, height: 1100 });
    await expect
      .poll(() => markerPositionError(f.page, "Editing position", "fill"))
      .toBeLessThan(1.5);
    const math = f.page.locator('.axiom-embedded[data-kind="mathBlock"]');
    await math
      .getByRole("button", { name: "Edit display equation", exact: true })
      .click();
    await math.locator(".cm-content").press("ControlOrMeta+End");
    await expect
      .poll(() => markerPositionError(f.page, "Editing position", "fill"))
      .toBeLessThan(1.5);

    await command(f.page, "Find in note");
    await f.page.locator(".axiom-find input[type='search']").fill("targetcode");
    await expect
      .poll(() =>
        markerPositionError(
          f.page,
          "Search result 1",
          "fill",
          f.page.locator(".axiom-search-range"),
        ),
      )
      .toBeLessThan(5);
    await f.page.getByTestId("note-editor").hover();
    await f.page.getByRole("button", { name: /^Collapse python code/ }).click();
    const folded = f.page.locator(".axiom-folded-block");
    await expect(folded).toHaveCount(1);
    // A match inside a folded range points at its visible summary, not the
    // preceding/following paragraph, and measuring it must not expand the fold.
    const marker = f.page.locator('.minimap-marker[title*="Search result 1"]');
    await expect(marker).toBeVisible();
    await marker.click();
    await expect(folded).toHaveCount(1);
    await f.page.screenshot({
      path: info.outputPath("minimap-marker-folded-code.png"),
    });
    expect(await f.source()).toBe(
      body.replace("targetcode = 2", "targetcode = 2 + 4"),
    );
  } finally {
    await f.close();
  }
});

test("minimap is opt-in, scroll-only and preserves the live typing position", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    await expect(f.page.locator(".document-minimap")).toHaveCount(0);
    await command(f.page, "Toggle minimap");
    await painted(f.page);
    const paragraph = f.page
      .getByTestId("note-editor")
      .locator("p")
      .filter({ hasText: "Opening observation." });
    await caret(paragraph);
    const before = await f.page.evaluate(() => ({
      text: getSelection()?.anchorNode?.textContent,
      offset: getSelection()?.anchorOffset,
    }));
    const map = f.page.getByRole("scrollbar", {
      name: "Document minimap scroll position",
    });
    const box = (await map.boundingBox())!;
    await f.page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
    await expect
      .poll(() => scroller(f.page).evaluate((el) => el.scrollTop))
      .toBeGreaterThan(1000);
    expect(
      await f.page.evaluate(() => ({
        text: getSelection()?.anchorNode?.textContent,
        offset: getSelection()?.anchorOffset,
      })),
    ).toEqual(before);
    await f.page.keyboard.insertText(" Retained cursor.");
    await expect
      .poll(f.source)
      .toBe(
        sample.replace(
          "Opening observation.",
          "Opening observation. Retained cursor.",
        ),
      );
    await f.page.screenshot({ path: info.outputPath("minimap-writing.png") });
  } finally {
    await f.close();
  }
});

test("viewport dragging, wheel and keyboard navigation do not repaint a fit map or change source", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "# Navigation\n\n" +
      "A long observation with no remote previews.\n\n".repeat(180),
  );
  try {
    await command(f.page, "Toggle minimap");
    await painted(f.page);
    await f.page.evaluate(() => document.fonts.ready);
    await f.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const count = await f.page
      .locator(".minimap-canvas")
      .getAttribute("data-paint-count");
    const measures = Number(
      await f.page.locator(".document-minimap").getAttribute("data-measures"),
    );
    const map = f.page.getByRole("scrollbar", {
      name: "Document minimap scroll position",
    });
    const box = (await map.boundingBox())!,
      thumb = (await f.page.locator(".minimap-viewport").boundingBox())!;
    await f.page.mouse.move(box.x + 20, thumb.y + thumb.height / 2);
    await f.page.mouse.down();
    await f.page.mouse.move(box.x + 20, box.y + box.height * 0.85, {
      steps: 8,
    });
    await f.page.mouse.up();
    await expect
      .poll(() => scroller(f.page).evaluate((el) => el.scrollTop))
      .toBeGreaterThan(1000);
    await map.focus();
    await f.page.keyboard.press("Home");
    await expect
      .poll(() => scroller(f.page).evaluate((el) => el.scrollTop))
      .toBe(0);
    await f.page.keyboard.press("PageDown");
    await expect
      .poll(() => scroller(f.page).evaluate((el) => el.scrollTop))
      .toBeGreaterThan(200);
    await f.page.mouse.move(box.x + 25, box.y + 300);
    await f.page.mouse.wheel(0, 220);
    await f.page.keyboard.press("End");
    await expect
      .poll(() =>
        scroller(f.page).evaluate((el) =>
          Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
        ),
      )
      .toBeLessThan(2);
    expect(
      await f.page.locator(".minimap-canvas").getAttribute("data-paint-count"),
    ).toBe(count);
    expect(
      Number(
        await f.page.locator(".document-minimap").getAttribute("data-measures"),
      ),
    ).toBeLessThanOrEqual(measures + 1);
    expect(await f.source()).toContain("# Navigation");
  } finally {
    await f.close();
  }
});

test("Appearance previews, cancels, persists and resets minimap settings with old-client protection", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    await f.page.goto("/workbench/settings/appearance-general");
    const toggle = f.page.getByRole("checkbox", {
      name: "Show document minimap",
      exact: true,
    });
    const preview = f.page.getByLabel("General settings preview", {
      exact: true,
    });
    await toggle.check();
    await expect(preview.locator(".document-minimap")).toBeVisible();
    await f.page
      .getByLabel("Minimap position", { exact: true })
      .selectOption("left");
    await expect(preview.locator(".document-navigation-row")).toHaveAttribute(
      "data-minimap",
      "left",
    );
    await f.page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(toggle).not.toBeChecked();
    await expect(preview.locator(".document-minimap")).toHaveCount(0);
    await toggle.check();
    await f.page
      .getByLabel("Minimap rendering", { exact: true })
      .selectOption("blocks");
    const width = f.page.getByRole("spinbutton", {
      name: "Minimap width value",
      exact: true,
    });
    await width.fill("500");
    await toggle.uncheck();
    await expect(width).toHaveValue("120");
    await expect(
      f.page.getByRole("button", { name: "Apply", exact: true }),
    ).toBeEnabled();
    await toggle.check();
    await f.page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(f.page.getByLabel("Appearance synchronization")).toContainText(
      "synced to your account",
    );
    await f.page.reload();
    await expect(toggle).toBeChecked();
    await expect(
      f.page.getByLabel("Minimap rendering", { exact: true }),
    ).toHaveValue("blocks");
    await f.page.screenshot({
      path: info.outputPath("minimap-appearance-general.png"),
    });
    const old = await (
      await f.member.request.get("/api/v1/me/preferences-bundle", {
        headers: { "X-Axiom-Appearance-Schema": "7" },
      })
    ).json();
    expect(old.appearance.preferences).not.toHaveProperty("minimap");
    const rejected = await f.member.request.patch(
      "/api/v1/me/preferences-bundle",
      {
        headers: { origin, "X-Axiom-Appearance-Schema": "7" },
        data: {
          appearance: old.appearance,
          editor: old.editor,
          mutationId: randomUUID(),
        },
      },
    );
    expect(rejected.status()).toBe(426);
    await f.page
      .getByRole("button", { name: "Reset section", exact: true })
      .click();
    await expect(toggle).not.toBeChecked();
    expect(await f.source()).toBe(sample);
  } finally {
    await f.close();
  }
});

test("source/read modes, compact panes, headings and context menus share a single map", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    await preferences(f, { side: "left", slider: "always" });
    await painted(f.page);
    await expect(f.page.locator(".document-navigation-row")).toHaveAttribute(
      "data-minimap",
      "left",
    );
    await f.page.getByRole("button", { name: "Minimap options" }).click();
    await f.page
      .getByRole("menuitem", { name: "Position", exact: true })
      .click();
    await f.page
      .getByRole("menuitemcheckbox", { name: "Right", exact: true })
      .click();
    await expect(f.page.locator(".document-navigation-row")).toHaveAttribute(
      "data-minimap",
      "right",
    );
    await expect
      .poll(async () => {
        const paper = (await scroller(f.page).boundingBox())!;
        const marks = (await f.page
          .locator(".reading-mark-layer")
          .boundingBox())!;
        return Math.abs(paper.x - marks.x);
      })
      .toBeLessThan(1);
    await f.page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(f.page.locator(".document-minimap")).toHaveAttribute(
      "data-mode",
      "source",
    );
    await painted(f.page);
    await f.page.getByRole("button", { name: "Minimap options" }).click();
    await expect(
      f.page.getByRole("menu", { name: "Minimap actions" }),
    ).toBeVisible();
    await f.page
      .getByRole("menuitem", { name: "Document end", exact: true })
      .click();
    await expect
      .poll(() => scroller(f.page).evaluate((el) => el.scrollTop))
      .toBeGreaterThan(1000);
    await f.page.getByRole("button", { name: "Read", exact: true }).click();
    await expect(f.page.locator(".document-minimap")).toHaveAttribute(
      "data-mode",
      "read",
    );
    await f.page.getByRole("button", { name: "Minimap options" }).click();
    await f.page
      .getByRole("menuitem", { name: "Document start", exact: true })
      .click();
    await expect
      .poll(() => scroller(f.page).evaluate((el) => el.scrollTop))
      .toBe(0);
    // Constrain a document pane, not the entire app's responsive sidebars.
    await f.page.locator(".ws-document-main").evaluate((el) => {
      el.style.maxWidth = "580px";
    });
    await expect(f.page.locator(".document-minimap")).toHaveClass(/is-compact/);
    await f.page.screenshot({
      path: info.outputPath("minimap-compact-reading.png"),
    });
    expect(await f.source()).toBe(sample);
    await f.page.emulateMedia({ media: "print" });
    await expect(f.page.locator(".document-minimap")).not.toBeVisible();
  } finally {
    await f.close();
  }
});

test("bookmarks, search and collaborator markers share one navigation rail", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  const peer = await f.owner.newPage();
  peer.on("pageerror", (error) => f.errors.push(error.message));
  try {
    const paragraph = f.page
      .getByTestId("note-editor")
      .locator("p")
      .filter({ hasText: "Opening observation." });
    await paragraph.hover();
    await f.page
      .getByRole("button", { name: "Paragraph reading actions", exact: true })
      .click();
    await f.page
      .getByRole("menuitem", { name: "Bookmark block", exact: true })
      .click();
    await expect(f.page.locator(".reading-mark-overview")).toBeVisible();
    await command(f.page, "Toggle minimap");
    await expect(f.page.locator(".reading-mark-overview")).toHaveCount(0);
    await expect(
      f.page.locator(".minimap-marker[title*='Opening observation']"),
    ).toBeVisible();
    await command(f.page, "Find in note");
    await f.page
      .locator(".axiom-find input[type='search']")
      .fill("Observation");
    await expect(
      f.page.locator(".minimap-marker[title*='Search result']").first(),
    ).toBeVisible();
    await peer.goto(`/workbench/notes/${f.note.id}`);
    await expect(peer.getByTestId("note-editor")).toBeVisible();
    await caret(
      peer
        .getByTestId("note-editor")
        .locator("p")
        .filter({ hasText: /Opening/ }),
    );
    const me = await (await f.owner.request.get("/api/v1/me")).json();
    await expect
      .poll(() =>
        f.page
          .locator(".minimap-marker")
          .evaluateAll(
            (els, name) =>
              els.some((e) => e.getAttribute("title")?.includes(name)),
            me.user.name,
          ),
      )
      .toBe(true);
    await f.page.screenshot({
      path: info.outputPath("minimap-research-markers.png"),
    });
    await f.page
      .getByRole("button", { name: "Close find", exact: true })
      .click();
    await command(f.page, "Toggle minimap");
    await expect(f.page.locator(".reading-mark-overview")).toBeVisible();
    expect(await f.source()).toBe(sample);
  } finally {
    await peer.close();
    await f.close();
  }
});

test("folds, passive previews and navigation-only preferences preserve block editors", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    await preferences(
      f,
      { width: 160 },
      { mode: "dark", radius: 0, shadows: "none" },
    );
    await f.page.getByTestId("note-editor").hover();
    await f.page.getByRole("button", { name: /^Collapse python code/ }).click();
    await expect(f.page.locator(".axiom-folded-block")).toHaveCount(1);
    const map = f.page.getByRole("scrollbar", {
      name: "Document minimap scroll position",
    });
    await map.hover({ position: { x: 20, y: 100 } });
    await expect(f.page.locator(".minimap-preview")).toBeVisible();
    await expect(f.page.locator(".axiom-folded-block")).toHaveCount(1);
    await f.page.getByRole("button", { name: "Minimap options" }).click();
    await f.page
      .getByRole("menuitemcheckbox", {
        name: "Always show viewport",
        exact: true,
      })
      .click();
    await expect(f.page.locator(".axiom-folded-block")).toHaveCount(1);
    expect(await f.source()).toBe(sample);
    await f.page.screenshot({
      path: info.outputPath("minimap-dark-folded.png"),
    });
    await f.page
      .getByRole("link", { name: "Open inbox", exact: true })
      .click();
    await expect(
      f.page.locator(".document-minimap").filter({ visible: true }),
    ).toHaveCount(0);
    await expect(f.page.locator(".minimap-preview")).toHaveCount(0);
  } finally {
    await f.close();
  }
});

test("explicit navigation, selection ranges and per-mode visibility preserve document content", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  try {
    await preferences(f, { source: false, read: false });
    const paragraph = f.page
      .getByTestId("note-editor")
      .locator("p")
      .filter({ hasText: "Opening observation." });
    await caret(paragraph);
    for (let i = 0; i < 8; i++) await f.page.keyboard.press("Shift+ArrowLeft");
    await expect(f.page.locator(".minimap-selection-range")).toBeVisible();
    await command(f.page, "Focus minimap");
    const map = f.page.getByRole("scrollbar", {
      name: "Document minimap scroll position",
    });
    await expect(map).toBeFocused();
    await f.page.keyboard.press("End");
    await f.page.keyboard.press("Enter");
    await expect
      .poll(() =>
        f.page.evaluate(
          () => !!document.activeElement?.closest(".editor-mount"),
        ),
      )
      .toBe(true);
    const position = await f.page.evaluate(() => ({
      text: getSelection()?.anchorNode?.textContent,
      offset: getSelection()?.anchorOffset,
    }));
    expect(position.text).not.toBe("Opening observation.");
    await map.focus();
    await f.page.keyboard.press("Home");
    await f.page.getByRole("button", { name: "Minimap options" }).click();
    await f.page
      .getByRole("menuitem", { name: "Return to cursor", exact: true })
      .click();
    await expect
      .poll(() => scroller(f.page).evaluate((el) => el.scrollTop))
      .toBeGreaterThan(1000);
    await f.page.keyboard.press("Escape");
    await expect
      .poll(() =>
        f.page.evaluate(
          () => !!document.activeElement?.closest(".editor-mount"),
        ),
      )
      .toBe(true);
    expect(
      await f.page.evaluate(() => ({
        text: getSelection()?.anchorNode?.textContent,
        offset: getSelection()?.anchorOffset,
      })),
    ).toEqual(position);
    await f.page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(f.page.locator(".document-minimap")).toHaveCount(0);
    await f.page.getByRole("button", { name: "Read", exact: true }).click();
    await expect(f.page.locator(".document-minimap")).toHaveCount(0);
    await f.page.getByRole("button", { name: "Write", exact: true }).click();
    await painted(f.page);
    expect(await f.source()).toBe(sample);
  } finally {
    await f.close();
  }
});

test("minimap preferences converge after offline changes without modifying notes", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  try {
    await f.page.goto("/workbench/settings/appearance-general");
    await expect(f.page.getByLabel("Appearance synchronization")).toContainText(
      "synced",
    );
    await f.member.route("**/api/v1/me/preferences-bundle", (route) =>
      route.abort(),
    );
    await f.page
      .getByRole("checkbox", { name: "Show document minimap", exact: true })
      .check();
    await f.page
      .getByLabel("Minimap sizing", { exact: true })
      .selectOption("proportional");
    await f.page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(
      f.page.getByLabel("Appearance synchronization"),
    ).not.toContainText("synced to your account");
    await f.member.unroute("**/api/v1/me/preferences-bundle");
    await f.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect
      .poll(async () => {
        const bundle = await (
          await f.member.request.get("/api/v1/me/preferences-bundle")
        ).json();
        return bundle.appearance.preferences.minimap;
      })
      .toMatchObject({ enabled: true, size: "proportional" });
    await f.page.goto(`/workbench/notes/${f.note.id}`);
    await painted(f.page);
    expect(await f.source()).toBe(sample);
  } finally {
    await f.member.unroute("**/api/v1/me/preferences-bundle");
    await f.close();
  }
});

test("scrolling and minimap-only settings retain an active equation editor", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  try {
    await command(f.page, "Toggle minimap");
    const math = f.page.locator('.axiom-embedded[data-kind="mathBlock"]');
    await math
      .getByRole("button", { name: "Edit display equation", exact: true })
      .click();
    const tex = math.locator(".cm-content");
    const element = await tex.elementHandle();
    await expect(tex).toBeFocused();
    const map = f.page.getByRole("scrollbar", {
      name: "Document minimap scroll position",
    });
    const rect = (await map.boundingBox())!;
    await f.page.mouse.click(rect.x + 25, rect.y + rect.height * 0.75);
    await expect(tex).toBeFocused();
    await f.page.getByRole("button", { name: "Minimap options" }).click();
    await f.page
      .getByRole("menuitemcheckbox", {
        name: "Always show viewport",
        exact: true,
      })
      .click();
    expect(await element!.evaluate((el) => el.isConnected)).toBe(true);
    await f.page.keyboard.press("Escape");
    await expect(tex).toBeFocused();
    await tex.press("End");
    await f.page.keyboard.insertText("+v");
    await expect.poll(f.source).toBe(sample.replace("E=mc^2", "E=mc^2+v"));
  } finally {
    await f.close();
  }
});

test("annotation markers stay private until explicitly shared with readers", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  const original = await (
    await f.owner.request.get("/api/v1/me/preferences-bundle")
  ).json();
  const peer = await f.owner.newPage();
  peer.on("pageerror", (error) => f.errors.push(error.message));
  try {
    await command(f.page, "Toggle minimap");
    await f.page
      .getByTestId("note-editor")
      .locator("p")
      .filter({ hasText: "Opening observation." })
      .hover();
    await f.page
      .getByRole("button", { name: "Paragraph reading actions", exact: true })
      .click();
    await f.page
      .getByRole("menuitem", { name: "Add annotation", exact: true })
      .click();
    await f.page
      .getByRole("textbox", { name: "Annotation title", exact: true })
      .fill("Dimensional check");
    await f.page.getByTestId("annotation-editor").click();
    await f.page.keyboard.insertText("Check the physical units.");
    await f.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      f.page.getByRole("button", { name: "Share annotation", exact: true }),
    ).toBeEnabled();
    await expect(
      f.page.locator('.minimap-marker[title*="Dimensional check"]'),
    ).toBeVisible();
    await peer.goto(`/workbench/notes/${f.note.id}`);
    await preferences({ ...f, member: f.owner, page: peer }, {});
    await painted(peer);
    await expect(
      peer.locator('.minimap-marker[title*="Dimensional check"]'),
    ).toHaveCount(0);
    expect(
      await (
        await f.owner.request.get(`/api/v1/notes/${f.note.id}/comments`)
      ).json(),
    ).toEqual([]);
    await f.page
      .getByRole("button", { name: "Share annotation", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Share with readers", exact: true })
      .click();
    await expect(
      peer.locator('.minimap-marker[title*="Dimensional check"]'),
    ).toBeVisible();
    expect(await f.source()).toBe(sample);
  } finally {
    const latest = await (
      await f.owner.request.get("/api/v1/me/preferences-bundle")
    ).json();
    await f.owner.request.patch("/api/v1/me/preferences-bundle", {
      headers: { origin },
      data: {
        appearance: {
          ...latest.appearance,
          preferences: original.appearance.preferences,
        },
        editor: latest.editor,
        mutationId: randomUUID(),
      },
    });
    await peer.close();
    await f.close();
  }
});

for (const lines of [10000, 50000])
  test(`large-document benchmark: ${lines} source lines`, async ({
    browser,
  }, info) => {
    test.skip(
      !!process.env.TEST_BROWSER && process.env.TEST_BROWSER !== "chromium",
      "Benchmarked once on Chromium; interaction acceptance runs on all engines.",
    );
    test.setTimeout(180000);
    const body =
      "# Large research note\n\n```text\n" +
      Array.from({ length: lines }, (_, i) => `x_${i} = ${i % 19}`).join("\n") +
      "\n```\n";
    const f = await fixture(browser, body);
    try {
      await f.page.getByRole("button", { name: "Source", exact: true }).click();
      const input = f.page.getByTestId("note-editor");
      await input.click({ position: { x: 24, y: 8 } });
      await f.page.keyboard.press("Home");
      await f.page.evaluate(() => {
        const timings: number[] = [];
        (window as any).__minimapTimings = timings;
        document.querySelector(".editor-mount")!.addEventListener(
          "beforeinput",
          () => {
            const start = performance.now();
            requestAnimationFrame(() =>
              timings.push(performance.now() - start),
            );
          },
          { capture: true },
        );
      });
      const measure = async (text: string) => {
        await f.page.evaluate(() => {
          (window as any).__minimapTimings.length = 0;
        });
        await f.page.keyboard.type(text, { delay: 30 });
        await f.page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        return f.page.evaluate(
          () => [...(window as any).__minimapTimings] as number[],
        );
      };
      const before = await measure("baseline");
      await command(f.page, "Toggle minimap");
      await painted(f.page);
      await input.click({ position: { x: 24, y: 8 } });
      await f.page.keyboard.press("Home");
      const after = await measure("withmap");
      await expect(f.page.locator(".minimap-canvas")).toHaveAttribute(
        "data-paint-count",
        /[1-9]/,
      );
      const frame = await f.page
        .locator(".minimap-canvas")
        .evaluate((canvas: HTMLCanvasElement) => ({
          width: canvas.width,
          height: canvas.height,
          paintMs: Number(canvas.dataset.paintMs),
          paints: Number(canvas.dataset.paintCount),
        }));
      expect(frame.width * frame.height).toBeLessThanOrEqual(4000000);
      expect(before.length).toBeGreaterThan(3);
      expect(after.length).toBeGreaterThan(3);
      const median = (values: number[]) =>
        [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const report = {
        lines,
        baselineInputToFrameMs: before,
        minimapInputToFrameMs: after,
        medianBaseline: median(before),
        medianMinimap: median(after),
        canvas: frame,
      };
      const path = info.outputPath(`minimap-${lines}-benchmark.json`);
      await writeFile(path, JSON.stringify(report, null, 2));
      await info.attach(`minimap-${lines}-benchmark.json`, {
        contentType: "application/json",
        path,
      });
      console.info(
        `Minimap ${lines} lines: baseline ${report.medianBaseline.toFixed(1)} ms, enabled ${report.medianMinimap.toFixed(1)} ms, canvas ${frame.width} × ${frame.height}`,
      );
      expect(median(after)).toBeLessThan(median(before) * 1.75 + 25);
      // Settle the final edit and its derived print/height-map updates before
      // measuring navigation; those updates belong to typing, not scrolling.
      await f.page.waitForTimeout(250);
      const count = Number(
        await f.page.locator(".document-minimap").getAttribute("data-measures"),
      );
      await f.page
        .getByRole("scrollbar", { name: "Document minimap scroll position" })
        .focus();
      await f.page.keyboard.press("End");
      await f.page.keyboard.press("Home");
      await expect
        .poll(() => scroller(f.page).evaluate((el) => el.scrollTop))
        .toBe(0);
      expect(
        Number(
          await f.page
            .locator(".document-minimap")
            .getAttribute("data-measures"),
        ),
      ).toBeLessThanOrEqual(count + 2);
    } finally {
      await f.close();
    }
  });
