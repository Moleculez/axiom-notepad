import { test, expect, type Page } from "@playwright/test";
import {
  mindmapId,
  researchId,
  imagePath,
} from "../../apps/showcase/src/samples";

// Disposable guest notes only. Deny any account/collaboration/external request.
const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, baseURL }) => {
  const found: string[] = [];
  failures.set(page, found);
  page.on("pageerror", (error) => found.push(error.message));
  page.on("websocket", (socket) => found.push(socket.url()));
  page.on("request", (request) => {
    const url = request.url();
    if (
      /^https?:/.test(url) &&
      (!url.startsWith(new URL(baseURL!).origin) ||
        /\/api\/|\/sync(?:\b|\/)|\.env/.test(url))
    )
      found.push(url);
  });
});
test.afterEach(async ({ page }) => expect(failures.get(page)).toEqual([]));

async function start(page: Page, raw: string) {
  await page.goto(`./#mindmap&note=${mindmapId}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("tree", { name: "Markdown hierarchy" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const editor = page.locator(".mindmap-source-pane .cm-content");
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText(raw);
  await expect.poll(() => source(page)).toBe(raw);
  await page.getByRole("button", { name: "Close map source" }).click();
}
async function source(page: Page): Promise<string> {
  return page.evaluate(
    (id) =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("axiom-showcase-v1", 1);
        request.onsuccess = () => {
          const db = request.result,
            item = db
              .transaction("documents", "readonly")
              .objectStore("documents")
              .get(id);
          item.onsuccess = () => {
            resolve(item.result?.source ?? "");
            db.close();
          };
          item.onerror = () => {
            reject(item.error);
            db.close();
          };
        };
        request.onerror = () => reject(request.error);
      }),
    mindmapId,
  );
}
async function lens(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Research lens", exact: true })
    .click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
const scale = (page: Page) =>
  page
    .locator(".mindmap-stage")
    .evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).a,
    );

test("research lenses emphasize in place and focus results keeps canonical commands", async ({
  page,
}) => {
  const raw =
    "# Study\n\n## Methods\n\n- [ ] Review evidence\n- [x] Checked\n\n$$x^2$$\n\n## Results\n\nText\n\n| A | B |\n| - | - |\n| $x$ | **Y** |\n";
  await start(page, raw);
  await page.getByRole("button", { name: "Reset zoom to 100 percent" }).click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const before = await scale(page),
    stage = await page.locator(".mindmap-stage").getAttribute("style");
  await lens(page, "Equations");
  await expect(
    page.locator('.mindmap-node[data-lens-match="true"]'),
  ).toHaveCount(2);
  await expect.poll(() => scale(page)).toBeCloseTo(before, 5);
  await expect(page.locator(".mindmap-stage")).toHaveAttribute("style", stage!);
  await page
    .getByRole("button", { name: "Focus results", exact: true })
    .click();
  await expect(
    page.getByRole("treeitem", {
      name: "Incomplete task: Review evidence",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect.poll(() => scale(page)).toBeCloseTo(before, 5);
  await lens(page, "Unfinished tasks");
  const task = page.getByRole("treeitem", {
    name: "Incomplete task: Review evidence",
    exact: true,
  });
  await expect(task).toBeVisible();
  await task.focus();
  await task.press("t");
  await expect
    .poll(() => source(page))
    .toBe(raw.replace("[ ] Review", "[x] Review"));
  await expect(
    page.getByRole("treeitem", {
      name: "Complete task: Review evidence",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Undo map edit" }).click();
  await expect.poll(() => source(page)).toBe(raw);
  await expect(task).toBeVisible();
  await page
    .getByRole("button", { name: "Clear research lens and search" })
    .click();
  await expect.poll(() => scale(page)).toBeCloseTo(before, 5);
  await expect(
    page.getByRole("treeitem", { name: "Text", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ws-note-footer")).toBeInViewport();
});

test("branch inspector exposes deduplicated evidence, footnotes and source-backed tasks", async ({
  page,
}, info) => {
  const raw = `# Study\n\n## Evidence\n\n- [ ] Review [[${researchId}|Related note]]\n- [x] Checked\n\nReference[^detail] and \\eqref{eq:x}.\n\n$$x^2 \\label{eq:x}$$\n\n[^detail]: A useful footnote\n    with $y^2$.\n`;
  await start(page, raw);
  await page.getByRole("treeitem", { name: "Evidence", exact: true }).click();
  await page
    .getByRole("button", { name: "Branch details", exact: true })
    .click();
  await expect(page.locator(".mindmap-source-pane")).toHaveCount(0);
  const pane = page.locator(".mindmap-details-pane");
  await expect(pane.locator(".mindmap-detail-summary")).toContainText(
    "1/2 tasks complete",
  );
  await pane.getByRole("tab", { name: "Evidence" }).click();
  await expect(pane.locator(".mindmap-evidence-item")).toHaveCount(3);
  await expect(pane).toContainText("A useful footnote");
  await pane.getByRole("tab", { name: "Tasks" }).click();
  const toggle = pane.getByRole("checkbox", { name: /Complete task Review/ });
  await toggle.check();
  await expect
    .poll(() => source(page))
    .toBe(raw.replace("[ ] Review", "[x] Review"));
  await page.getByRole("button", { name: "Undo map edit" }).click();
  await expect.poll(() => source(page)).toBe(raw);
  await pane.getByRole("tab", { name: "Block", exact: true }).click();
  await pane
    .getByRole("button", { name: "Edit in Source", exact: true })
    .click();
  await expect(pane).toHaveCount(0);
  await expect(page.locator(".mindmap-source-pane")).toBeVisible();
  await page
    .getByRole("button", { name: "Branch details", exact: true })
    .click();
  await pane.getByRole("tab", { name: "Evidence" }).click();
  await page.screenshot({
    path: info.outputPath("mindmap-research-inspector.png"),
  });
});

test("definition-only edits refresh reference images and links without resetting zoom", async ({
  page,
}) => {
  const raw = `# Study\n\n![Evidence][fig]\n\n[Related note][related]\n\n[fig]: ${imagePath}\n[related]: https://example.invalid/initial\n`;
  await start(page, raw);
  const image = page.locator(".mindmap-stage img[alt=Evidence]");
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  const original = await image.getAttribute("src");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const before = await scale(page);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const editor = page.locator(".mindmap-source-pane .cm-content");
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("\n\n[unused]: unused.png\n");
  await expect.poll(() => source(page)).toContain("[unused]");
  await expect(image).toHaveAttribute("src", original!);
  await expect(
    page.locator('.mindmap-stage a[href="https://example.invalid/initial"]'),
  ).toHaveText("Related note");
  await expect.poll(() => scale(page)).toBeCloseTo(before, 5);
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await page.keyboard.insertText(raw.replace("/initial", "/updated"));
  await expect(
    page.locator('.mindmap-stage a[href="https://example.invalid/updated"]'),
  ).toHaveText("Related note");
  await expect(image).toHaveAttribute("src", original!);
  await expect.poll(() => scale(page)).toBeCloseTo(before, 5);
});

test("wiki targets and equation references navigate the logical note or canonical block", async ({
  page,
}) => {
  await start(
    page,
    `# Study\n\n$$x^2 \\label{power}$$\n\nSee \\eqref{power}.\n\n[[${researchId}|Related note]]\n`,
  );
  await page.locator(".mindmap-stage .equation-ref").click();
  await expect(
    page.locator(".mindmap-node[aria-selected=true][data-kind=content]"),
  ).toContainText("Equation");
  await page.locator(".mindmap-stage .wiki-link").click();
  await expect.poll(() => page.url()).toContain(`note=${researchId}`);
});

test("inspector anchors navigate the map and footnotes use their originating branch", async ({
  page,
}) => {
  const raw =
    "# Study\n\nSee \\eqref{power}.\n\n$$x^2 \\label{power}$$\n\nFootnote[^detail].\n\n[^detail]: Contextual evidence\n";
  await start(page, raw);
  await page.getByRole("treeitem", { name: "Study", exact: true }).click();
  await page
    .getByRole("button", { name: "Branch details", exact: true })
    .click();
  const pane = page.locator(".mindmap-details-pane");
  await pane.locator(".equation-ref").click();
  await expect(
    page.locator(".mindmap-node[aria-selected=true][data-kind=content]"),
  ).toContainText("Equation");
  await page.locator('.mindmap-stage a[data-footnote-key="detail"]').click();
  await expect(pane.getByRole("tab", { name: /^Evidence/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(pane).toContainText("Contextual evidence");
  await expect(pane.locator(".mindmap-evidence-item")).toHaveCount(1);
  await expect.poll(() => source(page)).toBe(raw);
});

test("explicit visual inspection reuses the image viewer and returns map focus", async ({
  page,
}) => {
  await start(page, `# Study\n\n![Evidence](${imagePath})\n`);
  const card = page.locator('.mindmap-node:has([data-block-preview="image"])');
  await card.click();
  await page
    .getByRole("button", { name: "Branch details", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Inspect visual", exact: true })
    .click();
  const viewer = page.getByRole("dialog").filter({
    has: page.getByRole("button", { name: "Zoom in", exact: true }),
  });
  await expect(viewer).toBeVisible();
  await viewer.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(card).toBeFocused();
});

test("quick mode switches flush the latest pane preference", async ({
  page,
}) => {
  await start(page, "# Study\n\n- A\n- B\n");
  // The retained document editor has its own Source mode button. Target the
  // map toolbar while the host swaps its visible editor surface.
  const mapSource = page.locator(".mindmap-surface").getByRole("button", {
    name: "Source",
    exact: true,
  });
  await page.getByRole("button", { name: "Document", exact: true }).click();
  await page.getByRole("button", { name: "Mind map", exact: true }).click();
  await expect(mapSource).toBeVisible();
  await expect(mapSource).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".mindmap-source-pane")).toHaveCount(0);
  await mapSource.click();
  await page.getByRole("button", { name: "Document", exact: true }).click();
  await page.getByRole("button", { name: "Mind map", exact: true }).click();
  await expect(mapSource).toBeVisible();
  await expect(mapSource).toHaveAttribute("aria-pressed", "true");
});

test("focused lenses navigate current children before delayed layout results", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage as (
      this: Worker,
      message: unknown,
      options?: Transferable[] | StructuredSerializeOptions,
    ) => void;
    Worker.prototype.postMessage = function (message, options?) {
      if (
        message &&
        typeof message === "object" &&
        "source" in message &&
        "settings" in message &&
        "folds" in message
      ) {
        // Exercise keyboard intent while the previous layout still exists.
        setTimeout(() => send.call(this, message, options), 200);
      } else send.call(this, message, options);
    };
  });
  await start(
    page,
    "# Study\n\n## Method\n\n- [x] Excluded first\n- [ ] Wanted\n\n## Other\n\n- [ ] Outside\n",
  );
  const method = page.getByRole("treeitem", { name: "Method", exact: true });
  await method.click();
  await page
    .getByRole("button", { name: "More map options", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Map hierarchy", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Focus selected branch", exact: true })
    .click();
  await lens(page, "Unfinished tasks");
  await page
    .getByRole("button", { name: "Focus results", exact: true })
    .click();
  await expect(
    page.getByRole("treeitem", {
      name: "Incomplete task: Outside",
      exact: true,
    }),
  ).toHaveCount(0);
  await method.focus();
  await method.press("ArrowRight");
  await expect(
    page.getByRole("treeitem", {
      name: "Incomplete task: Wanted",
      exact: true,
    }),
  ).toBeFocused();
  await expect(page.locator(".mindmap-focus-path")).toContainText("Method");
});
