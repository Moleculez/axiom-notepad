import { test, expect, type Page } from "@playwright/test";
import { interfaceStyles } from "../../packages/shared/src/interface-styles";
import { mindmapId } from "../../apps/showcase/src/samples";

const source = `# Research overview

## Question

A testable mathematical question with readable evidence.

## Method

- [ ] Reproduce the baseline with a deliberately long task title that wraps inside the research inspector
  - [x] Inspect random seeds
  - [ ] Review evidence

## Evidence

> Keep the observation separate from the interpretation.

| Symbol | Meaning |
| --- | --- |
| alpha | Initial estimate |
| beta | Revised estimate |
`;

const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, baseURL }) => {
  failures.set(page, []);
  page.on("pageerror", (error) => failures.get(page)!.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (
      /^https?:/.test(url) &&
      (!url.startsWith(new URL(baseURL!).origin) ||
        /\/api\/|\/sync(?:\b|\/)|\.env/.test(url))
    )
      failures.get(page)!.push(`Unexpected request: ${url}`);
  });
  page.on("websocket", (socket) =>
    failures.get(page)!.push(`Unexpected socket: ${socket.url()}`),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.get(page)!.push(`${response.status()} ${response.url()}`);
  });
});
test.afterEach(async ({ page }) => expect(failures.get(page)).toEqual([]));

async function start(page: Page) {
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
  await page.keyboard.insertText(source);
  await page
    .getByRole("button", { name: "Close map source", exact: true })
    .click();
  await expect(
    page.getByRole("treeitem", { name: "Research overview", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("button", { name: "Fit mind map", exact: true }).click();
}

async function geometry(page: Page) {
  return page
    .getByRole("treeitem", { name: "Research overview", exact: true })
    .locator(".mindmap-label")
    .evaluate((element) => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight,
    }));
}

async function frameContract(page: Page, radius: "square" | "rounded") {
  const node = page.getByRole("treeitem", {
      name: "Research overview",
      exact: true,
    }),
    label = node.locator(".mindmap-label");
  const frame = await label.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borders: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
      radius: parseFloat(style.borderTopLeftRadius),
      background: style.backgroundColor,
      shadow: style.boxShadow,
    };
  });
  expect(frame.borders).toEqual(["1px", "1px", "1px", "1px"]);
  expect(frame.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(frame.shadow).toBe("none");
  if (radius === "square") expect(frame.radius).toBe(0);
  else expect(frame.radius).toBeGreaterThan(0);
  const before = await geometry(page);
  await node.hover();
  await expect.poll(() => geometry(page)).toEqual(before);
  await node.click();
  await expect(node).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => geometry(page)).toEqual(before);
  const search = page.getByRole("searchbox", { name: "Find in mind map" });
  await search.fill("Research overview");
  await expect(node).toHaveAttribute("data-matching", "true");
  await expect.poll(() => geometry(page)).toEqual(before);
  await search.fill("");
  await expect(page.locator(".ws-note-footer")).toHaveCount(1);
  await expect(page.locator(".ws-note-footer")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

for (const mode of ["light", "dark"] as const) {
  test(`framed map default: ${mode} preserves rounded geometry and fixed footer`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: mode });
    await start(page);
    await frameContract(page, "rounded");
    await page.screenshot({
      path: info.outputPath(`mindmap-framed-${mode}.png`),
    });
  });

  for (const style of interfaceStyles) {
    test(`framed research inspector: ${style.id} ${mode}, large text and accessibility`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce" });
      await start(page);
      await page
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
      const appearance = page.getByRole("dialog", {
        name: "Appearance & editor",
      });
      await appearance.getByLabel("Interface design").selectOption(style.id);
      await appearance.getByRole("button", { name: mode, exact: true }).click();
      const size = appearance.getByLabel("Interface font size value", {
        exact: true,
      });
      await size.fill("22");
      await size.press("Enter");
      const radius = appearance.getByLabel("Corner radius value", {
        exact: true,
      });
      await radius.fill("0");
      await radius.press("Enter");
      await appearance
        .getByLabel("Shadows", { exact: true })
        .selectOption("none");
      await appearance
        .getByRole("button", { name: "Done", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-interface-style",
        style.id,
      );
      await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
      await page
        .getByRole("button", { name: "Fit mind map", exact: true })
        .click();
      await frameContract(page, "square");
      await page
        .getByRole("button", { name: "Branch details", exact: true })
        .click();
      const pane = page.locator(".mindmap-details-pane");
      await expect(pane).toBeVisible();
      const tasks = pane.getByRole("tab", { name: /^Tasks/ });
      await tasks.click();
      await expect(tasks).toHaveAttribute("aria-selected", "true");
      await expect(pane.locator(".mindmap-task-row")).toHaveCount(3);
      await expect(
        pane.getByRole("checkbox", {
          name: "Reopen task Inspect random seeds",
          exact: true,
        }),
      ).toBeChecked();
      const layout = await pane.evaluate((element) => {
        const content = element.querySelector<HTMLElement>(
            ".mindmap-detail-content",
          )!,
          tabs = element.querySelector<HTMLElement>(".mindmap-detail-tabs")!,
          footer = document.querySelector<HTMLElement>(".ws-note-footer")!,
          box = content.getBoundingClientRect(),
          tabBox = tabs.getBoundingClientRect();
        return {
          ownedScroll: getComputedStyle(content).overflowY,
          tabsAboveContent: tabBox.bottom <= box.top + 1,
          contentAboveFooter:
            box.bottom <= footer.getBoundingClientRect().top + 1,
          contained: element.scrollWidth <= element.clientWidth + 1,
          controlsContained: Array.from(
            element.querySelectorAll<HTMLElement>(".ui-button,.ui-checkbox"),
          ).every((control) => {
            const controlBox = control.getBoundingClientRect();
            return (
              controlBox.right <= element.getBoundingClientRect().right + 1 &&
              controlBox.left >= element.getBoundingClientRect().left - 1
            );
          }),
        };
      });
      expect(layout).toEqual({
        ownedScroll: "auto",
        tabsAboveContent: true,
        contentAboveFooter: true,
        contained: true,
        controlsContained: true,
      });
      // Button boxes can fit while their anonymous flex text still overflows.
      // Inspect actual text/count ranges, not only the control geometry.
      const tabText = await pane
        .locator(".mindmap-detail-tabs")
        .evaluate((strip) => {
          const rects: {
            left: number;
            right: number;
            top: number;
            bottom: number;
          }[] = [];
          let contained = true,
            countGap = true;
          for (const button of strip.querySelectorAll<HTMLElement>(
            "[role=tab]",
          )) {
            const box = button.getBoundingClientRect(),
              walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT),
              ranges: DOMRect[] = [];
            let text: Node | null;
            while ((text = walker.nextNode())) {
              if (!text.textContent?.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(text);
              for (const rect of range.getClientRects()) {
                if (!rect.width || !rect.height) continue;
                ranges.push(rect);
                rects.push({
                  left: rect.left,
                  right: rect.right,
                  top: rect.top,
                  bottom: rect.bottom,
                });
                if (
                  rect.left < box.left - 1 ||
                  rect.right > box.right + 1 ||
                  rect.top < box.top - 1 ||
                  rect.bottom > box.bottom + 1
                )
                  contained = false;
              }
            }
            const count = button.querySelector<HTMLElement>(
              ".mindmap-detail-count",
            );
            if (
              count &&
              ranges.length > 1 &&
              count.getBoundingClientRect().left - ranges[0].right < 4
            )
              countGap = false;
          }
          const overlap = rects.some((rect, index) =>
            rects
              .slice(index + 1)
              .some(
                (other) =>
                  Math.min(rect.right, other.right) -
                    Math.max(rect.left, other.left) >
                    0.5 &&
                  Math.min(rect.bottom, other.bottom) -
                    Math.max(rect.top, other.top) >
                    0.5,
              ),
          );
          return { contained, countGap, overlap };
        });
      expect(tabText).toEqual({
        contained: true,
        countGap: true,
        overlap: false,
      });
      await tasks.focus();
      await tasks.press("ArrowLeft");
      await expect(pane.getByRole("tab", { name: /^Evidence/ })).toBeFocused();
      await expect(page.locator(".ws-note-footer")).toBeInViewport();
      await page.screenshot({
        path: info.outputPath(`mindmap-${style.id}-${mode}-large.png`),
      });
      await page.emulateMedia({ forcedColors: "active" });
      const root = page.getByRole("treeitem", {
        name: "Research overview",
        exact: true,
      });
      await root.focus();
      await expect(root).toBeFocused();
      expect(
        await root
          .locator(".mindmap-label")
          .evaluate((element) => getComputedStyle(element).outlineStyle),
      ).toBe("solid");
      await page.screenshot({
        path: info.outputPath(`mindmap-${style.id}-${mode}-forced.png`),
      });
    });
  }
}
