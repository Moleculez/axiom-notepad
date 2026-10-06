import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { mindmapId, researchId } from "../../apps/showcase/src/samples";

// Each context owns a disposable guest database. Never authenticate or call APIs.
const errors = new WeakMap<Page, string[]>(),
  outbound = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, baseURL }) => {
  errors.set(page, []);
  outbound.set(page, []);
  page.on("pageerror", (e) => errors.get(page)!.push(e.message));
  page.on("request", (r) => {
    const url = r.url();
    if (
      /^https?:/.test(url) &&
      (!url.startsWith(new URL(baseURL!).origin) ||
        /\/api\/|\/sync(?:\b|\/)|\.env/.test(url))
    )
      outbound.get(page)!.push(url);
  });
  page.on("websocket", (s) => outbound.get(page)!.push(s.url()));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.get(page)!.push(`${r.status()} ${r.url()}`);
  });
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(outbound.get(page)).toEqual([]);
});

async function start(page: Page, id = mindmapId) {
  await page.goto(`./#mindmap&note=${id}`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("tree", { name: "Markdown hierarchy" }),
  ).toBeVisible();
  await expect(page.locator(".mindmap-status")).toContainText("nodes");
}
async function source(page: Page, id = mindmapId): Promise<string> {
  return page.evaluate(
    (id) =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open("axiom-showcase-v1", 1);
        open.onsuccess = () => {
          const db = open.result,
            req = db
              .transaction("documents", "readonly")
              .objectStore("documents")
              .get(id);
          req.onsuccess = () => {
            resolve(req.result?.source ?? "");
            db.close();
          };
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
    id,
  );
}
async function replaceSource(page: Page, value: string) {
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const cm = page.locator(".mindmap-source-pane .cm-content");
  await cm.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(value);
  await expect.poll(() => source(page)).toBe(value);
  await page.getByRole("button", { name: "Close map source" }).click();
}

test("map and document keep one canonical source and author undo", async ({
  page,
}) => {
  await start(page);
  const initial = "# Root\n\n- A\n  - Inner\n- [ ] Review\n- B\n";
  await replaceSource(page, initial);
  const a = page.getByRole("treeitem", { name: "A", exact: true });
  await a.dblclick();
  const field = page.getByRole("textbox", { name: "Edit map node label" });
  await field.fill("**Alpha**");
  await field.press("Enter");
  await expect
    .poll(() => source(page))
    .toBe(initial.replace("- A\n", "- **Alpha**\n"));
  await page.getByRole("button", { name: "Undo map edit" }).click();
  await expect.poll(() => source(page)).toBe(initial);
  await page.getByRole("button", { name: "Redo map edit" }).click();
  await expect(
    page.getByRole("treeitem", { name: "Alpha", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Toggle task Review" }).check();
  await expect.poll(() => source(page)).toContain("- [x] Review");
  await page.getByRole("button", { name: "Document", exact: true }).click();
  await expect(page.locator(".axiom-editor:visible")).toBeVisible();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(
    page.locator(".demo-document-scroll .cm-content:visible"),
  ).toContainText("**Alpha**");
  await page.getByRole("button", { name: "Mind map", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Toggle task Review" }),
  ).toBeChecked();
  await page.reload();
  await expect(
    page.getByRole("treeitem", { name: "Alpha", exact: true }),
  ).toBeVisible();
});

test("new branches edit immediately, navigation reveals folds, and one auxiliary pane owns scroll", async ({
  page,
}, info) => {
  await start(page);
  await replaceSource(page, "# Root\n\n- A\n  - Inner\n- B\n");
  const a = page.getByRole("treeitem", { name: "A", exact: true });
  await a.focus();
  await a.press("Enter");
  const field = page.getByRole("textbox", { name: "Edit map node label" });
  await expect(field).toBeFocused();
  await field.fill("Sibling");
  await field.press("Enter");
  await expect.poll(() => source(page)).toContain("- Sibling\n");
  const added = page.getByRole("treeitem", { name: "Sibling", exact: true });
  await added.focus();
  await added.press("ControlOrMeta+Enter");
  await expect(field).toBeFocused();
  await field.fill("Child");
  await field.press("Enter");
  await expect.poll(() => source(page)).toContain("  - Child\n");
  await page.getByRole("button", { name: "Fold A", exact: true }).click();
  await expect(
    page.getByRole("treeitem", { name: "Inner", exact: true }),
  ).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "Find in mind map" });
  await search.fill("Inner");
  await search.press("Enter");
  const inner = page.getByRole("treeitem", { name: "Inner", exact: true });
  await expect(inner).toBeFocused();
  await inner.press("ArrowLeft");
  await expect(a).toBeFocused();
  await a.press("Space");
  await a.press("ControlOrMeta+Enter");
  await expect(field).toBeFocused();
  await field.fill("Another child");
  await field.press("Enter");
  await expect.poll(() => source(page)).toContain("  - Another child\n");
  await a.dblclick();
  await field.fill("Unapplied draft");
  await page.getByRole("treeitem", { name: "B", exact: true }).dblclick();
  await expect(field).toHaveValue("Unapplied draft");
  await expect(page.locator(".mindmap-surface")).toContainText(
    "Apply, copy or cancel",
  );
  await field.press("Escape");
  await expect.poll(() => source(page)).toContain("- A\n");
  await a.press("ControlOrMeta+/");
  await expect(page.locator(".mindmap-source-pane")).toBeVisible();
  await page
    .getByRole("button", { name: "Branch details", exact: true })
    .click();
  await expect(page.locator(".mindmap-source-pane")).toHaveCount(0);
  await expect(page.locator(".mindmap-details-pane")).toBeVisible();
  await expect(page.locator(".mindmap-status")).toBeInViewport();
  await expect(page.locator(".demo-document-status")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("mindmap-pane-scroll.png") });
});

test("keyboard reorder and read-only maps preserve source", async ({
  page,
}) => {
  await start(page);
  const initial = "# Root\n\n- A\n- B\n";
  await replaceSource(page, initial);
  const b = page.getByRole("treeitem", { name: "B", exact: true });
  await b.focus();
  await b.press("Alt+ArrowUp");
  await expect.poll(() => source(page)).toBe("# Root\n\n- B\n- A\n");
  await page.getByRole("button", { name: "Document", exact: true }).click();
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await page.getByRole("button", { name: "Mind map", exact: true }).click();
  await expect(page.locator(".mindmap-status")).toContainText("Read only");
  await b.focus();
  await b.press("F2");
  await expect(
    page.getByRole("textbox", { name: "Edit map node label" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Undo map edit" }),
  ).toBeDisabled();
  await b.press("Enter");
  await expect.poll(() => source(page)).toBe("# Root\n\n- B\n- A\n");
});

test("bounded plain exports retain hierarchy and offline HTML interactions", async ({
  page,
  context,
}) => {
  await start(page);
  const initial = "# Root\n\n- Parent\n  - Child\n";
  await replaceSource(page, initial);
  await page
    .getByRole("button", { name: "Export mind map", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Export mind map" });
  await dialog.getByLabel("Format", { exact: true }).selectOption("markdown");
  let download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  expect(await readFile((await (await download).path())!, "utf8")).toBe(
    initial,
  );
  await dialog.getByLabel("Format", { exact: true }).selectOption("html");
  await dialog
    .getByRole("checkbox", { name: "Preserve rich labels and equations" })
    .uncheck();
  download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  const html = await readFile((await (await download).path())!, "utf8");
  expect(html).not.toMatch(/href="(?:https?:|\/api)|<iframe|<script src=/);
  const viewer = await context.newPage();
  await viewer.setContent(html);
  const child = viewer.locator('[data-node][aria-label="Child"]');
  await expect(child).toBeVisible();
  await viewer.locator('[data-node][aria-label="Parent"]').click();
  await expect(child).toBeHidden();
  await viewer.getByRole("button", { name: "Expand all", exact: true }).click();
  await expect(child).toBeVisible();
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  expect(await viewer.locator("svg").getAttribute("viewBox")).not.toContain(
    "NaN",
  );
  await viewer.close();
});

for (const mode of ["light", "dark"] as const)
  test(`map display: ${mode}, large text, keyboard, forced colors and reduced motion`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
    await start(page, researchId);
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    const appearance = page.getByRole("dialog", {
      name: "Appearance & editor",
    });
    await appearance.getByRole("button", { name: mode, exact: true }).click();
    await appearance
      .getByLabel("Interface font size value", { exact: true })
      .fill("22");
    await appearance
      .getByLabel("Interface font size value", { exact: true })
      .press("Enter");
    await appearance.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Map display options" }).click();
    const display = page.getByRole("dialog", { name: "Mind-map display" });
    for (const layout of ["right", "left", "balanced"]) {
      await display.getByLabel("Direction").selectOption(layout);
      await expect(page.locator(".mindmap-surface")).toHaveAttribute(
        "data-map-layout",
        layout,
      );
      await expect(
        display.getByRole("button", { name: "Done", exact: true }),
      ).toBeInViewport();
    }
    await display.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.locator(".mindmap-status")).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`mindmap-${mode}-large.png`),
    });
    await page.emulateMedia({ forcedColors: "active" });
    const root = page.getByRole("treeitem").first();
    await root.focus();
    await expect(root).toBeFocused();
    await page.screenshot({
      path: info.outputPath(`mindmap-${mode}-forced.png`),
    });
  });
