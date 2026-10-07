import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  mindmapId,
  researchId,
  imagePath,
} from "../../apps/showcase/src/samples";
const sharp: typeof import("sharp").default = createRequire(import.meta.url)(
  "sharp",
);

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
  await expect(page.locator(".ws-note-footer")).toContainText("nodes");
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
async function mapOption(page: Page, name: string) {
  await page
    .getByRole("button", { name: "More map options", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name, exact: true })
    .or(page.getByRole("menuitemcheckbox", { name, exact: true }))
    .click();
}

test("source resizer belongs to its pane and editing never resets zoom", async ({
  page,
}, info) => {
  await start(page);
  await replaceSource(
    page,
    "# Root\n\n- Parent\n  - Child\n\n## Results\n\nEvidence\n",
  );
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const pane = page.locator(".mindmap-source-pane"),
    handle = page.getByRole("separator", { name: "Resize mind-map source" });
  const panelBox = (await pane.boundingBox())!,
    handleBox = (await handle.boundingBox())!;
  expect(
    Math.abs(handleBox.x + handleBox.width / 2 - (panelBox.x + panelBox.width)),
  ).toBeLessThan(6);
  expect(handleBox.height).toBeLessThan(1000);
  await handle.focus();
  await handle.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "370");
  await handle.press("Shift+ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "410");
  const dragBox = (await handle.boundingBox())!;
  await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + dragBox.width / 2 + 90, dragBox.y + 80, {
    steps: 8,
  });
  await expect(handle).toHaveAttribute("aria-valuenow", "500");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "410");
  await page.getByRole("button", { name: "Reset zoom to 100 percent" }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const scale = () =>
    page
      .locator(".mindmap-stage")
      .evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a);
  const before = await scale();
  const cm = pane.locator(".cm-content");
  await cm.click();
  await cm.press("ControlOrMeta+End");
  await page.keyboard.insertText("\nMore research");
  await expect.poll(() => source(page)).toContain("More research");
  await expect.poll(scale).toBeCloseTo(before, 5);
  await cm.press("ControlOrMeta+z");
  await expect.poll(() => source(page)).not.toContain("More research");
  await expect.poll(scale).toBeCloseTo(before, 5);
  await mapOption(page, "Map display options");
  await page
    .getByRole("dialog", { name: "Mind-map display" })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await expect.poll(scale).toBeCloseTo(before, 5);
  await handle.focus();
  await handle.press("Enter");
  await expect(handle).toHaveAttribute("aria-valuenow", "360");
  await expect.poll(scale).toBeCloseTo(before, 5);
  await expect(page.locator(".mindmap-status")).toHaveCount(0);
  await expect(page.locator(".ws-note-footer")).toHaveCount(1);
  await expect(page.locator(".ws-note-footer")).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith("axiom:mindmap:"))
          .map(
            (key) =>
              JSON.parse(localStorage.getItem(key) ?? "null")?.camera?.scale,
          ),
      ),
    )
    .toEqual(expect.arrayContaining([expect.closeTo(before, 5)]));
  await handle.press("ArrowRight");
  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", "370");
  await expect.poll(scale).toBeCloseTo(before, 5);
  await page.screenshot({
    path: info.outputPath("mindmap-source-resize-footer.png"),
  });
});

test("fold controls are contextual, screen-sized and count whole hidden subtrees", async ({
  page,
}, info) => {
  await start(page);
  await replaceSource(
    page,
    "# Root\n\n- Parent\n  - Child\n    - Grandchild\n- Other\n  - Other child\n",
  );
  await expect(
    page.getByRole("button", { name: "Fold Root", exact: true }),
  ).toHaveCount(0);
  const parent = page.getByRole("treeitem", { name: "Parent", exact: true });
  await parent.hover();
  const fold = page.getByRole("button", { name: "Fold Parent", exact: true });
  const controlBox = (await fold.boundingBox())!;
  // CSS pixel transforms can serialize 32 as 31.999969 in Firefox.
  // Keep a sub-millipixel tolerance, not a smaller interaction target.
  expect(controlBox.width).toBeGreaterThanOrEqual(32 - 0.001);
  await page.mouse.move(
    controlBox.x + controlBox.width / 2,
    controlBox.y + controlBox.height / 2,
    { steps: 12 },
  );
  await expect(fold).toBeVisible();
  await fold.click();
  const expand = page.getByRole("button", {
    name: "Expand Parent",
    exact: true,
  });
  await expect(expand).toContainText("2");
  const badgeBox = (await expand.boundingBox())!;
  const countBox = (await expand
    .locator(".mindmap-hidden-count")
    .boundingBox())!;
  expect(countBox.y).toBeGreaterThanOrEqual(badgeBox.y);
  expect(countBox.y + countBox.height).toBeLessThanOrEqual(
    badgeBox.y + badgeBox.height,
  );
  await expect(
    page.getByRole("treeitem", { name: "Child", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  expect((await expand.boundingBox())!.width).toBeGreaterThanOrEqual(
    32 - 0.001,
  );
  expect((await expand.boundingBox())!.height).toBeGreaterThanOrEqual(
    32 - 0.001,
  );
  await expand.click();
  await parent.focus();
  await parent.press("ArrowDown");
  await expect(
    page.getByRole("treeitem", { name: "Child", exact: true }),
  ).toBeFocused();
  const childBox = (await page
    .getByRole("treeitem", { name: "Child", exact: true })
    .boundingBox())!;
  const parentControl = (await page
    .getByRole("button", { name: "Fold Parent", exact: true })
    .boundingBox())!;
  expect(
    parentControl.x + parentControl.width <= childBox.x ||
      parentControl.x >= childBox.x + childBox.width ||
      parentControl.y + parentControl.height <= childBox.y ||
      parentControl.y >= childBox.y + childBox.height,
  ).toBe(true);
  await mapOption(page, "Map display options");
  const display = page.getByRole("dialog", { name: "Mind-map display" });
  await display.getByLabel("Direction").selectOption("left");
  await display.getByRole("button", { name: "Done", exact: true }).click();
  await parent.focus();
  await parent.press("Space");
  await expect(expand).toBeVisible();
  const leftParent = (await parent.boundingBox())!;
  const leftBadge = (await expand.boundingBox())!;
  expect(leftBadge.x + leftBadge.width).toBeLessThanOrEqual(leftParent.x - 4);
  await page.screenshot({ path: info.outputPath("mindmap-fold-controls.png") });
});

test("research blocks render bounded previews and retain rendered equations while panning", async ({
  page,
}, info) => {
  await start(page);
  const raw =
    "---\ntitle: Experiment\n---\n\n# Research\n\n## Evidence\n\n$$\nE=mc^2\n$$\n\n```python\na=1\nb=2\nc=3\nd=4\ne=5\n```\n\n| A | B | C | D |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |\n| 5 | 6 | 7 | 8 |\n| 9 | 10 | 11 | 12 |\n| 13 | 14 | 15 | 16 |\n\n![Spectrum](https://external.invalid/picture.png)\n\nText[^proof].\n\n[^proof]: Research evidence\n";
  await replaceSource(page, raw);
  await page.getByRole("button", { name: "Fit mind map", exact: true }).click();
  await expect(page.locator('[data-block-preview="code"]')).toContainText(
    "5 lines",
  );
  await expect(page.locator('[data-block-preview="code"]')).not.toContainText(
    "e=5",
  );
  const logo = (await page.locator(".mindmap-language-logo").boundingBox())!;
  expect(logo.width).toBeLessThan(32);
  expect(logo.height).toBeLessThan(32);
  await expect(
    page.locator('[data-block-preview="table"] table tr'),
  ).toHaveCount(4);
  await expect(
    page.locator('[data-block-preview="table"] table th'),
  ).toHaveCount(3);
  await expect(page.locator('[data-block-preview="media"] img')).toHaveCount(0);
  await expect(
    page.locator('[data-block-preview="image"] .image-unavailable'),
  ).toContainText("Image unavailable");
  const equation = page.locator(
    '[data-block-preview="equation"] [data-math-request]',
  );
  await expect(equation).toHaveAttribute("data-math-state", "ready", {
    timeout: 30000,
  });
  const painted = await equation.innerHTML();
  await page.locator(".mindmap-viewport").hover({ position: { x: 20, y: 20 } });
  await page.mouse.wheel(40, 25);
  await expect(equation).toHaveAttribute("data-math-state", "ready");
  expect(await equation.innerHTML()).toBe(painted);
  await mapOption(page, "Map display options");
  const display = page.getByRole("dialog", { name: "Mind-map display" });
  await display.getByRole("switch", { name: /Supporting material/ }).check();
  await display.getByRole("button", { name: "Done", exact: true }).click();
  await expect(
    page.getByRole("treeitem", { name: "Supporting material", exact: true }),
  ).toBeVisible();
  await expect.poll(() => source(page)).toBe(raw);
  await page.screenshot({
    path: info.outputPath("mindmap-research-blocks.png"),
  });
});

test("Mermaid and images render completely, stay painted during edits and pan, and follow themes", async ({
  page,
}, info) => {
  await start(page);
  const raw = `# Evidence\n\n\`\`\`mermaid\nflowchart LR\n  A[Alpha] --> B[Beta]\n  B --> C[Gamma]\n  C --> D[Delta]\n  D --> E[Epsilon]\n  E --> F[Conclusion]\n\`\`\`\n\n![Spectral model](${imagePath})\n`;
  await replaceSource(page, raw);
  const diagram = page.locator('[data-block-preview="diagram"] [data-mermaid]'),
    image = page.locator('[data-block-preview="image"] img');
  await expect(diagram).toHaveAttribute("data-preview-state", "ready", {
    timeout: 30000,
  });
  await expect(diagram).toHaveAttribute("aria-busy", "false");
  await expect(diagram.locator("svg")).toHaveCount(1);
  await expect(diagram).toContainText("Conclusion");
  await expect(diagram.locator("pre")).toHaveCount(0);
  await page.getByRole("button", { name: "Fit mind map", exact: true }).click();
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBe(900);
  await expect(page.locator(".mindmap-image-frame")).toHaveAttribute(
    "data-image-state",
    "ready",
  );
  await expect(
    page.getByRole("button", { name: "Retry image loading" }),
  ).toHaveCount(0);
  const dimensions = await image.evaluate((el: HTMLImageElement) => ({
    height: el.offsetHeight,
    width: el.offsetWidth,
    available: el.closest(".mindmap-rich-label")!.clientWidth,
  }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.available);
  expect(dimensions.height).toBeLessThanOrEqual(176);
  const painted = await diagram.innerHTML();
  await diagram.evaluate((el) => {
    el.dataset.acceptanceIdentity = "original-diagram";
    el.dataset.emptyPaints = "0";
    new MutationObserver(() => {
      if (!el.querySelector("svg"))
        el.dataset.emptyPaints = String(Number(el.dataset.emptyPaints) + 1);
    }).observe(el, { childList: true, subtree: true });
  });
  await image.evaluate((el) => {
    el.dataset.acceptanceIdentity = "original-image";
  });
  await page.locator(".mindmap-viewport").hover({ position: { x: 20, y: 20 } });
  await page.mouse.wheel(40, 25);
  expect(await diagram.innerHTML()).toBe(painted);
  await expect(image).toHaveAttribute(
    "data-acceptance-identity",
    "original-image",
  );
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const scale = () =>
      page
        .locator(".mindmap-stage")
        .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a),
    zoom = await scale();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const cm = page.locator(".mindmap-source-pane .cm-content");
  await cm.click();
  await cm.press("ControlOrMeta+Home");
  for (let i = 0; i < 8; i++) await cm.press("ArrowDown");
  await cm.press("End");
  await cm.press("ArrowLeft");
  await page.keyboard.insertText(" revised");
  await expect
    .poll(() => source(page))
    .toBe(raw.replace("Conclusion]", "Conclusion revised]"));
  await expect(diagram).toHaveAttribute("data-preview-state", "ready");
  await expect(diagram).toHaveAttribute("aria-busy", "false");
  await expect(diagram).toContainText("Conclusion revised");
  await expect(diagram).toHaveAttribute(
    "data-acceptance-identity",
    "original-diagram",
  );
  await expect(diagram).toHaveAttribute("data-empty-paints", "0");
  await expect.poll(scale).toBeCloseTo(zoom, 5);
  // A temporary syntax error must show its status, keep the last good SVG and
  // recover through the same source-backed undo path rather than erase content.
  await cm.press("ControlOrMeta+Home");
  for (let i = 0; i < 3; i++) await cm.press("ArrowDown");
  await cm.press("Home");
  await cm.press("Shift+End");
  await page.keyboard.insertText("flowchart ???");
  await expect(diagram).toHaveAttribute("data-preview-state", "stale");
  await expect(diagram).toContainText("Last valid preview");
  await expect(diagram.locator("svg")).toHaveCount(1);
  await expect(diagram).toHaveAttribute("data-empty-paints", "0");
  await cm.press("ControlOrMeta+z");
  await expect(diagram).toHaveAttribute("data-preview-state", "ready");
  await expect(diagram).toHaveAttribute("aria-busy", "false");
  await expect(diagram).toContainText("Conclusion revised");
  await page.getByRole("button", { name: "Close map source" }).click();
  await page.getByRole("button", { name: "Fit mind map", exact: true }).click();
  await page.screenshot({
    path: info.outputPath("mindmap-mermaid-images-light.png"),
  });
  const light = await diagram.innerHTML();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const appearance = page.getByRole("dialog", { name: "Appearance & editor" });
  await appearance.getByRole("button", { name: "dark", exact: true }).click();
  await appearance.getByRole("button", { name: "Done", exact: true }).click();
  await expect(diagram).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => diagram.innerHTML()).not.toBe(light);
  await expect(image).toHaveAttribute(
    "data-acceptance-identity",
    "original-image",
  );
  await expect
    .poll(() => source(page))
    .toBe(raw.replace("Conclusion]", "Conclusion revised]"));
  await expect(page.locator(".ws-note-footer")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await image.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  const screenshot = await page.screenshot({
    path: info.outputPath("mindmap-mermaid-images-dark.png"),
  });
  // Natural dimensions alone cannot detect a decoded SVG that failed to repaint.
  // Inspect real screenshot pixels without drawing the image on a second canvas.
  const box = (await image.boundingBox())!,
    crop = await sharp(screenshot)
      .extract({
        left: Math.ceil(box.x) + 4,
        top: Math.ceil(box.y) + 4,
        width: Math.floor(box.width) - 8,
        height: Math.floor(box.height) - 8,
      })
      .removeAlpha()
      .raw()
      .toBuffer();
  let detail = 0;
  for (let i = 3; i < crop.length; i += 3)
    if (
      Math.abs(crop[i] - crop[0]) +
        Math.abs(crop[i + 1] - crop[1]) +
        Math.abs(crop[i + 2] - crop[2]) >
      30
    )
      detail++;
  expect(detail).toBeGreaterThan(100);
});

test("broken local images expose a retry without changing source or opening network URLs", async ({
  page,
}, info) => {
  await start(page);
  await page.locator('.showcase-app > input[type="file"]').setInputFiles({
    name: "broken-image.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  const raw = "# Image\n\n![Unusable evidence](broken-image.png)\n";
  await replaceSource(page, raw);
  await page.getByRole("button", { name: "Fit mind map", exact: true }).click();
  const frame = page.locator(".mindmap-image-frame");
  await expect(frame).toHaveAttribute("data-image-state", "error");
  await expect(frame).toContainText("Image unavailable · Unusable evidence");
  const retry = frame.getByRole("button", { name: "Retry image loading" });
  await expect(retry).toBeVisible();
  await retry.focus();
  await retry.press("Enter");
  await expect(frame).toHaveAttribute("data-image-state", "error");
  await expect.poll(() => source(page)).toBe(raw);
  await page.screenshot({ path: info.outputPath("mindmap-image-retry.png") });
});

test("rich exports wait for Mermaid SVG and keep images as private-free summaries", async ({
  page,
}) => {
  await start(page);
  const raw = `# Evidence\n\n\`\`\`mermaid\nflowchart LR\nA --> B\nB --> C\nC --> D\nD --> E\nE --> F\n\`\`\`\n\n![Spectral model](${imagePath})\n`;
  await replaceSource(page, raw);
  await expect(
    page.locator('[data-block-preview="diagram"] [data-mermaid]'),
  ).toHaveAttribute("data-preview-state", "ready", { timeout: 30000 });
  await mapOption(page, "Export mind map");
  const dialog = page.getByRole("dialog", { name: "Export mind map" });
  await dialog.getByLabel("Format", { exact: true }).selectOption("svg");
  const prepared = page.waitForFunction(
    () =>
      !!document.querySelector(
        '.mindmap-export-label [data-mermaid][data-preview-state="ready"] svg',
      ),
  );
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  await prepared;
  const svg = await readFile((await (await downloaded).path())!, "utf8");
  expect(svg).toContain("data:image/png;base64,");
  expect(svg).not.toContain(imagePath);
  expect(svg).not.toMatch(/blob:|\/api\/|data-mermaid|https:\/\//);
  await expect.poll(() => source(page)).toBe(raw);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const invalid = raw.replace("flowchart LR", "flowchart ???");
  await replaceSource(page, invalid);
  await expect(
    page.locator('[data-block-preview="diagram"] [data-mermaid]'),
  ).toHaveAttribute("data-preview-state", "error");
  let extraDownloads = 0;
  page.on("download", () => extraDownloads++);
  await mapOption(page, "Export mind map");
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  await expect(dialog).toContainText("An equation or diagram could not render");
  await expect(
    dialog.getByRole("button", { name: "Download", exact: true }),
  ).toBeEnabled();
  expect(extraDownloads).toBe(0);
  await expect.poll(() => source(page)).toBe(invalid);
});

test("search restores folds, focused navigation and overview never rewrite Markdown", async ({
  page,
}) => {
  await start(page);
  const raw = "# Root\n\n- Parent\n  - Hidden target\n- Elsewhere\n";
  await replaceSource(page, raw);
  const parent = page.getByRole("treeitem", { name: "Parent", exact: true });
  await parent.hover();
  await page.getByRole("button", { name: "Fold Parent", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Find in mind map" });
  await search.fill("Hidden");
  await search.press("Enter");
  await expect(
    page.getByRole("treeitem", { name: "Hidden target", exact: true }),
  ).toBeFocused();
  await search.fill("");
  await expect(
    page.getByRole("treeitem", { name: "Hidden target", exact: true }),
  ).toHaveCount(0);
  await parent.click();
  await mapOption(page, "Map hierarchy");
  await page
    .getByRole("menuitem", { name: "Focus selected branch", exact: true })
    .click();
  await expect(page.locator(".mindmap-focus-path")).toContainText("Parent");
  await expect(
    page.getByRole("treeitem", { name: "Elsewhere", exact: true }),
  ).toHaveCount(0);
  await mapOption(page, "Toggle map overview");
  await expect(page.locator(".mindmap-overview")).toBeVisible();
  await page.getByRole("button", { name: /Navigate map overview/ }).focus();
  await page.keyboard.press("ArrowRight");
  await page
    .locator(".mindmap-focus-path")
    .getByRole("button", { name: "Show entire map", exact: true })
    .click();
  await expect(
    page.getByRole("treeitem", { name: "Elsewhere", exact: true }),
  ).toBeVisible();
  await expect.poll(() => source(page)).toBe(raw);
});

test("equation edits retain node identity, painted output and zoom", async ({
  page,
}, info) => {
  await start(page);
  const raw = "# Math\n\n$$\nE=mc^2\n$$\n";
  await replaceSource(page, raw);
  const equation = page.locator(
    '[data-block-preview="equation"] [data-math-request]',
  );
  await expect(equation).toHaveAttribute("data-math-state", "ready", {
    timeout: 30000,
  });
  const painted = await equation.innerHTML();
  await page.getByRole("button", { name: "Reset zoom to 100 percent" }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const before = await page
    .locator(".mindmap-stage")
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  await equation
    .locator("xpath=ancestor::div[@data-map-node]")
    .evaluate((el) => {
      el.setAttribute("data-acceptance-identity", "original-equation");
      const root = el as HTMLElement;
      root.dataset.emptyPaints = "0";
      const observer = new MutationObserver(() => {
        if (!root.querySelector("[data-math-request] svg"))
          root.dataset.emptyPaints = String(
            Number(root.dataset.emptyPaints) + 1,
          );
      });
      observer.observe(root, { childList: true, subtree: true });
    });
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const cm = page.locator(".mindmap-source-pane .cm-content");
  await cm.click();
  await cm.press("ControlOrMeta+Home");
  for (let i = 0; i < 3; i++) await cm.press("ArrowDown");
  await cm.press("End");
  await page.keyboard.insertText("+x^2");
  await expect
    .poll(() => source(page))
    .toBe(raw.replace("E=mc^2", "E=mc^2+x^2"));
  await expect(equation).toHaveAttribute("data-math-state", "ready");
  await expect.poll(() => equation.innerHTML()).not.toBe(painted);
  const retained = page.locator(
    '[data-acceptance-identity="original-equation"]',
  );
  await expect(retained).toHaveCount(1);
  await expect(retained).toHaveAttribute("data-empty-paints", "0");
  expect(
    await page
      .locator(".mindmap-stage")
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a),
  ).toBeCloseTo(before, 5);
  await page.screenshot({ path: info.outputPath("mindmap-equation-edit.png") });
});

test("dragging validates destinations, cancels cleanly and preserves one-step undo", async ({
  page,
}, info) => {
  await start(page);
  const raw = "# Root\n\n- Parent\n  - Child\n- Target\n  - Existing\n";
  await replaceSource(page, raw);
  await page.getByRole("button", { name: "Fit mind map", exact: true }).click();
  const parent = page.getByRole("treeitem", { name: "Parent", exact: true });
  const child = page.getByRole("treeitem", { name: "Child", exact: true });
  const target = page.getByRole("treeitem", { name: "Target", exact: true });
  const dragTo = async (from: typeof parent, to: typeof parent) => {
    const a = (await from.boundingBox())!,
      b = (await to.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  };
  await dragTo(parent, child);
  await expect(child).toHaveAttribute("data-map-drop-invalid", "true");
  await page.screenshot({ path: info.outputPath("mindmap-invalid-drag.png") });
  await page.mouse.up();
  await expect.poll(() => source(page)).toBe(raw);
  await page.getByRole("button", { name: "Dismiss map message" }).click();
  await dragTo(child, target);
  await expect(target).toHaveAttribute("data-map-drop", "child");
  await page.keyboard.press("Escape");
  await expect(target).not.toHaveAttribute("data-map-drop");
  await expect(page.locator(".mindmap-viewport")).not.toHaveAttribute(
    "data-dragging-branch",
  );
  await page.mouse.up();
  await expect.poll(() => source(page)).toBe(raw);
  await dragTo(child, target);
  await expect(target).toHaveAttribute("data-map-drop", "child");
  await page.mouse.up();
  await expect
    .poll(() => source(page))
    .toBe("# Root\n\n- Parent\n- Target\n  - Existing\n  - Child\n");
  await page.getByRole("button", { name: "Undo map edit" }).click();
  await expect.poll(() => source(page)).toBe(raw);
});

test("multi-selection task operations use one undo transaction", async ({
  page,
}) => {
  await start(page);
  const raw = "# Root\n\n- [ ] A\n  - [ ] Inner\n- [ ] B\n";
  await replaceSource(page, raw);
  const a = page.getByRole("treeitem", {
      name: "Incomplete task: A",
      exact: true,
    }),
    b = page.getByRole("treeitem", { name: "Incomplete task: B", exact: true });
  await a.click();
  await b.click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator('.mindmap-node[aria-selected="true"]')).toHaveCount(
    2,
  );
  await b.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Selection actions", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Complete tasks", exact: true })
    .click();
  await expect.poll(() => source(page)).toBe(raw.replaceAll("[ ]", "[x]"));
  await page
    .getByRole("button", { name: "Undo map edit", exact: true })
    .click();
  await expect.poll(() => source(page)).toBe(raw);
});

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
  await page
    .getByRole("button", { name: "Apply node edit", exact: true })
    .click();
  await expect.poll(() => source(page)).toContain("- Sibling\n");
  const added = page.getByRole("treeitem", { name: "Sibling", exact: true });
  await added.focus();
  await added.press("ControlOrMeta+Enter");
  await expect(field).toBeFocused();
  await field.fill("Child");
  await field.press("Enter");
  await expect.poll(() => source(page)).toContain("  - Child\n");
  await a.hover();
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
  await page
    .getByRole("button", { name: "Cancel node edit", exact: true })
    .click();
  await expect.poll(() => source(page)).toContain("- A\n");
  await a.press("ControlOrMeta+/");
  await expect(page.locator(".mindmap-source-pane")).toBeVisible();
  await page
    .getByRole("button", { name: "Branch details", exact: true })
    .click();
  await expect(page.locator(".mindmap-source-pane")).toHaveCount(0);
  await expect(page.locator(".mindmap-details-pane")).toBeVisible();
  await expect(page.locator(".ws-note-footer")).toBeInViewport();
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
  await expect(page.locator(".ws-note-footer")).toContainText("Read only");
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
  await mapOption(page, "Export mind map");
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
    await appearance
      .getByLabel("Corner radius value", { exact: true })
      .fill("0");
    await appearance
      .getByLabel("Corner radius value", { exact: true })
      .press("Enter");
    await appearance
      .getByLabel("Shadows", { exact: true })
      .selectOption("none");
    await appearance.getByRole("button", { name: "Done", exact: true }).click();
    await mapOption(page, "Map display options");
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
    await expect(page.locator(".ws-note-footer")).toBeInViewport();
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
