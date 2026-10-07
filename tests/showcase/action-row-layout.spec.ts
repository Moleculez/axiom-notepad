import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { interfaceStyles } from "../../packages/shared/src/interface-styles";

// Node renders the real shared TSX controls; Playwright transforms TSX for its
// component runtime and therefore cannot directly server-render those modules.
const { css, html }: { css: string; html: string } = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      "import { actionRowFixture } from './tests/helpers/action-row-fixture.ts'; process.stdout.write(JSON.stringify(actionRowFixture));",
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  ),
);

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  for (const selector of [
    ".fixture-toolbar",
    ".library-filters",
    ".library-selection",
    ".planning-rule-clause",
    ".planning-filters",
  ])
    expect(
      await page
        .locator(selector)
        .evaluateAll((elements) =>
          elements.every((el) => el.scrollWidth <= el.clientWidth + 1),
        ),
      selector,
    ).toBe(true);
}

for (const { id, name } of interfaceStyles) {
  for (const mode of ["light", "dark"] as const) {
    test(`${name}/${mode}: ordered app cascade aligns grouped actions, filters and planning fields`, async ({
      page,
      browserName,
    }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setContent(`<style>${css}</style><style>
        main.ws-app { max-width: 1100px; margin-inline:auto; gap:20px; }
        .fixture-toolbar > .ui-search-field { flex:1 1 12em; width:auto; }
        .fixture-toolbar > .ui-select { --field-width:auto; flex:none; }
        main.ws-app section > h3 { margin:0 0 12px; font-size:var(--size-ui-small); }
      </style>${html}`);
      for (const uiSize of [15, 22]) {
        await page.setViewportSize({
          width: uiSize === 15 ? 1280 : 1024,
          height: 1000,
        });
        await page.evaluate(
          ({ id, mode, uiSize }) => {
            const root = document.documentElement;
            root.dataset.interfaceStyle = id;
            root.dataset.theme = mode;
            root.dataset.motion = "none";
            root.style.setProperty("--size-ui", `${uiSize}px`);
            root.style.setProperty("--radius", "0px");
            root.style.setProperty("--shadow", "none");
          },
          { id, mode, uiSize },
        );
        const sizes = await page
          .locator(
            ".fixture-toolbar, .library-filters, .library-selection, .planning-filters",
          )
          .evaluateAll((rows) =>
            rows.map((row) => {
              const controls = [...row.children].flatMap((child) =>
                child.matches("details")
                  ? [...child.querySelectorAll("summary")]
                  : child.matches(
                        ".button,.icon-button,.ui-input,.ui-input-group,.ui-picker",
                      )
                    ? [child]
                    : [],
              );
              return {
                size: row.getAttribute("data-control-group-size"),
                controls: controls.map((control) => {
                  const box = control.getBoundingClientRect();
                  return {
                    height: box.height,
                    top: box.top,
                    bottom: box.bottom,
                    radius: getComputedStyle(control).borderRadius,
                    nativePopup: control.matches(
                      "select.ui-select:not([multiple]):not([size])",
                    ),
                  };
                }),
              };
            }),
          );
        for (const row of sizes) {
          const expectedHeight =
            row.size === "compact"
              ? Math.max(28, uiSize * 2.133)
              : Math.max(32, uiSize * 2.4);
          for (const box of row.controls) {
            expect(Math.abs(box.height - expectedHeight)).toBeLessThan(1);
            // Native WebKit popup menus retain their platform corner treatment
            // even with authored border-radius:0. Preserve its arrow/semantics;
            // every application-drawn shell/action still must remain square.
            if (!(browserName === "webkit" && box.nativePopup))
              expect(box.radius).toBe("0px");
          }
          // Wrapped controls form whole rows, not fragmented labels or uneven edges.
          for (const box of row.controls)
            for (const other of row.controls)
              if (Math.abs(box.top - other.top) < expectedHeight / 2)
                expect(Math.abs(box.bottom - other.bottom)).toBeLessThan(1);
        }
        const referenceFilters = await page
          .locator(".library-filters > *")
          .evaluateAll((elements) =>
            elements.map((el) => el.getBoundingClientRect().top),
          );
        expect(
          Math.max(...referenceFilters) - Math.min(...referenceFilters),
        ).toBeLessThan(1);
        const remove = await page
          .getByRole("button", { name: "Remove condition", exact: true })
          .boundingBox();
        const condition = await page
          .getByRole("combobox", { name: "Condition property", exact: true })
          .boundingBox();
        expect(
          Math.abs(
            remove!.y +
              remove!.height / 2 -
              condition!.y -
              condition!.height / 2,
          ),
        ).toBeLessThan(1);
        expect(Math.abs(remove!.height - condition!.height)).toBeLessThan(1);
        const planningSearch = await page
          .getByRole("searchbox", { name: "Fixture find tasks", exact: true })
          .evaluate((el) => {
            const box = el.getBoundingClientRect(),
              shell = el.closest(".ui-input-group")!.getBoundingClientRect(),
              icon = el
                .closest(".ui-input-group")!
                .querySelector(".ui-input-leading svg")!
                .getBoundingClientRect();
            return {
              width: box.width,
              iconContained:
                icon.left >= shell.left && icon.right <= shell.right,
              iconOffset: Math.abs(
                icon.top + icon.height / 2 - shell.top - shell.height / 2,
              ),
            };
          });
        expect(planningSearch.width).toBeGreaterThan(uiSize * 9);
        expect(planningSearch.iconContained).toBe(true);
        expect(planningSearch.iconOffset).toBeLessThan(1);
        const nested = await page
          .getByRole("button", { name: "Unsized nested action", exact: true })
          .boundingBox();
        expect(
          Math.abs(nested!.height - Math.max(28, uiSize * 2.133)),
        ).toBeLessThan(1);
        const documentField = page.getByLabel("Document property");
        expect(
          await documentField.evaluate((el) => ({
            background: getComputedStyle(el).backgroundColor,
            radius: getComputedStyle(el).borderRadius,
            shadow: getComputedStyle(el).boxShadow,
          })),
        ).toEqual({
          background: "rgba(0, 0, 0, 0)",
          radius: "0px",
          shadow: "none",
        });
        await noOverflow(page);
        await page.screenshot({
          path: info.outputPath(`alignment-${id}-${mode}-${uiSize}.png`),
          fullPage: true,
        });
      }
      await page.emulateMedia({
        reducedMotion: "reduce",
        forcedColors: "active",
      });
      await page.keyboard.press("Tab");
      for (const tab of [
        page.getByRole("link", { name: "Overview", exact: true }),
        page.getByRole("link", { name: "Storage", exact: true }),
      ]) {
        await tab.focus();
        await expect(tab).toHaveCSS("outline-style", "solid");
        await expect(tab).toHaveCSS("outline-offset", "-2px");
        await expect(tab).toHaveCSS("box-shadow", "none");
      }
      await page.screenshot({
        path: info.outputPath(`alignment-${id}-${mode}-forced.png`),
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
  }
}
