import { test, expect, type Page, type Locator } from "@playwright/test";
import { interfaceStyles } from "../../packages/shared/src/interface-styles";
import { expectGalleryCheckboxPaint } from "../e2e/interface-style-helpers";

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
  await page.goto("./#editor", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".axiom-editor")).toBeVisible();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
});
test.afterEach(async ({ page }) => expect(failures.get(page)).toEqual([]));

async function canonicalDocuments(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const opening = indexedDB.open("axiom-showcase-v1", 1);
        opening.onupgradeneeded = () => {
          opening.transaction?.abort();
          reject(new Error("Showcase storage was not initialized."));
        };
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const request = db
            .transaction("documents", "readonly")
            .objectStore("documents")
            .getAll();
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
          request.onsuccess = () => {
            db.close();
            resolve(
              JSON.stringify(
                request.result
                  .map((item: { id: string; source: string }) => ({
                    id: item.id,
                    source: item.source,
                  }))
                  .sort((a, b) => a.id.localeCompare(b.id)),
              ),
            );
          };
        };
      }),
  );
}

async function containLayout(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".demo-settings-fields")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Done", exact: true }),
  ).toBeInViewport();
}

/** A native dialog's header/footer are outside its fields scrollport. An
 * offscreen article heading is not evidence that its actual controls are
 * visible: position the requested field in that scrollport explicitly. */
async function revealField(target: Locator) {
  await target.evaluate((element) => {
    const owner = element.closest<HTMLElement>(".demo-settings-fields");
    if (!owner) throw new Error("Comparison control has no fields scrollport.");
    const anchor = element.closest(".ui-field") ?? element;
    const inset = Math.max(
      8,
      parseFloat(getComputedStyle(owner).fontSize) * 0.5,
    );
    owner.scrollTop +=
      anchor.getBoundingClientRect().top -
      owner.getBoundingClientRect().top -
      owner.clientTop -
      inset;
  });
}

async function fullyInsideFields(targets: Locator[]) {
  for (const target of targets) {
    const result = await target.evaluate((element) => {
      const owner = element.closest<HTMLElement>(".demo-settings-fields");
      if (!owner)
        throw new Error("Comparison control has no fields scrollport.");
      const bounds = owner.getBoundingClientRect();
      const viewport = {
        left: bounds.left + owner.clientLeft,
        top: bounds.top + owner.clientTop,
      };
      const box = (
        element.closest(".ui-field") ?? element
      ).getBoundingClientRect();
      return {
        visible: box.width > 0 && box.height > 0,
        contained:
          box.left >= viewport.left - 0.5 &&
          box.right <= viewport.left + owner.clientWidth + 0.5 &&
          box.top >= viewport.top - 0.5 &&
          box.bottom <= viewport.top + owner.clientHeight + 0.5,
      };
    });
    expect(result).toEqual({ visible: true, contained: true });
  }
}

async function firstLineAlignment(row: Locator, wrapped = false) {
  const geometry = await row.evaluate((element) => {
    const checkbox = element
      .querySelector<HTMLInputElement>(".ui-checkbox")!
      .getBoundingClientRect();
    const icon = element
      .querySelector(".interface-gallery-leading > svg")!
      .getBoundingClientRect();
    const title = element.querySelector(
      ".interface-gallery-row > span:last-child",
    )!;
    const range = document.createRange();
    range.selectNodeContents(title);
    const lines = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    const first = lines[0];
    if (!first)
      throw new Error("Sample selection title has no rendered first line.");
    const center = (box: DOMRect) => box.top + box.height / 2;
    const lineCenters: number[] = [];
    const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
    const titleWidth = title.getBoundingClientRect().width;
    const text = title.firstChild!;
    const fragments = [...(text.textContent ?? "").matchAll(/[\p{L}\p{N}]+/gu)]
      .filter((match) => match[0].length > 1)
      .map((match) => {
        const word = document.createRange();
        word.setStart(text, match.index!);
        word.setEnd(text, match.index! + match[0].length);
        return Array.from(word.getClientRects()).filter(
          (box) => box.width > 0 && box.height > 0,
        ).length;
      });
    for (const line of lines)
      if (
        !lineCenters.some(
          (previous) => Math.abs(previous - center(line)) < lineHeight / 2,
        )
      )
        lineCenters.push(center(line));
    return {
      direction: getComputedStyle(element).flexDirection,
      checkboxDelta: Math.abs(center(checkbox) - center(first)),
      iconDelta: Math.abs(center(icon) - center(first)),
      order:
        checkbox.right <= icon.left + 0.5 && icon.right <= first.left + 0.5,
      lines: lineCenters.length,
      usableEms: titleWidth / parseFloat(getComputedStyle(title).fontSize),
      fragmentedWords: fragments.filter((count) => count > 1).length,
    };
  });
  expect(geometry.direction).toBe("row");
  expect(geometry.order).toBe(true);
  expect(geometry.checkboxDelta).toBeLessThan(2);
  expect(geometry.iconDelta).toBeLessThan(2);
  expect(geometry.usableEms).toBeGreaterThanOrEqual(12);
  expect(geometry.fragmentedWords).toBe(0);
  expect(geometry.lines).toBeLessThanOrEqual(wrapped ? 5 : 3);
  if (wrapped) expect(geometry.lines).toBeGreaterThan(1);
}

for (const mode of ["light", "dark"] as const) {
  test(`interface comparison / ${mode}: eight distinct non-color systems and local interactions`, async ({
    page,
  }, info) => {
    const dialog = page.getByRole("dialog", { name: "Appearance & editor" });
    const before = await canonicalDocuments(page);
    await dialog.getByRole("button", { name: mode, exact: true }).click();
    const preview = dialog.locator(".demo-settings-preview"),
      previewNode = await preview.elementHandle(),
      previewWidth = (await preview.boundingBox())!.width,
      fieldsWidth = (await dialog
        .locator(".demo-settings-fields")
        .boundingBox())!.width;
    await expect(preview).toBeVisible();
    await dialog
      .getByRole("button", { name: "Compare all styles", exact: true })
      .click();
    await expect(preview).not.toBeVisible();
    expect(
      (await dialog.locator(".demo-settings-fields").boundingBox())!.width,
    ).toBeGreaterThan(fieldsWidth + previewWidth - 2);
    const gallery = dialog.getByRole("region", {
      name: "Interface style comparison",
    });
    await expect(gallery.locator(".interface-gallery-card")).toHaveCount(
      interfaceStyles.length,
    );
    const profiles = await gallery
      .locator(".interface-gallery-card")
      .evaluateAll((cards) =>
        cards.map((card) => {
          const style = getComputedStyle(card);
          const shell = getComputedStyle(
            card.querySelector(".ui-input-group")!,
          );
          const row = getComputedStyle(
            card.querySelector(".interface-gallery-row")!,
          );
          const band = getComputedStyle(
            card.querySelector(".interface-gallery-card-heading")!,
          );
          const action = getComputedStyle(
            card.querySelector(".button.primary")!,
          );
          const tab = getComputedStyle(
            card.querySelector('[role="tab"][aria-selected="true"]')!,
          );
          const structural = (value: string) =>
            value.replace(/(?:rgba?|color)\([^)]*\)/g, "color");
          return {
            id: card.getAttribute("data-interface-style")!,
            palette: [
              style.getPropertyValue("--paper"),
              style.getPropertyValue("--accent"),
              style.getPropertyValue("--text"),
            ],
            font: style.fontFamily,
            treatments: [
              shell.borderWidth,
              shell.borderRadius,
              structural(shell.boxShadow),
              structural(row.boxShadow),
              row.textDecorationLine,
              structural(band.boxShadow),
              action.borderRadius,
              structural(action.boxShadow),
              structural(tab.boxShadow),
            ],
          };
        }),
      );
    for (const profile of profiles) {
      expect(profile.palette).toEqual(profiles[0].palette);
      expect(profile.font).toBe(profiles[0].font);
    }
    for (let i = 0; i < profiles.length; i++)
      for (let j = i + 1; j < profiles.length; j++) {
        expect(
          profiles[i].treatments.filter(
            (value, index) => value !== profiles[j].treatments[index],
          ).length,
          `${profiles[i].id} and ${profiles[j].id} need at least three structural differences`,
        ).toBeGreaterThanOrEqual(3);
        expect(profiles[i].treatments.slice(0, 5)).not.toEqual(
          profiles[j].treatments.slice(0, 5),
        );
      }
    for (const style of interfaceStyles) {
      const card = gallery.getByRole("article", {
        name: `${style.name} controls`,
        exact: true,
      });
      const search = card.getByRole("searchbox", {
        name: `${style.name} sample search`,
        exact: true,
      });
      await search.fill("A local comparison");
      const relativeGeometry = () =>
        search.locator("..").evaluate((element) => {
          const box = element.getBoundingClientRect();
          const frame = element
            .closest(".interface-gallery-card")!
            .getBoundingClientRect();
          const precise = (value: number) => Math.round(value * 1024) / 1024;
          return {
            x: precise(box.x - frame.x),
            y: precise(box.y - frame.y),
            width: precise(box.width),
            height: precise(box.height),
          };
        });
      const beforeHover = await relativeGeometry();
      await search.hover();
      expect(await relativeGeometry()).toEqual(beforeHover);
      await card
        .getByRole("button", {
          name: `Clear ${style.name} sample search`,
          exact: true,
        })
        .click();
      await expect(search).toHaveValue("");
      await expect(search).toBeFocused();
      const tab = card.getByRole("tab", { name: "Details", exact: true });
      await tab.focus();
      await tab.press("ArrowRight");
      await expect(
        card.getByRole("tab", { name: "Activity", exact: true }),
      ).toBeFocused();
      await expect(card.getByRole("tabpanel")).toContainText(
        "no real operations",
      );
      await card
        .getByRole("button", { name: "Preview overlay", exact: true })
        .click();
      await expect(
        card.getByRole("group", {
          name: `${style.name} sample overlay`,
          exact: true,
        }),
      ).toBeVisible();
      await card
        .getByRole("button", { name: "Close sample overlay", exact: true })
        .click();
      await card
        .getByRole("button", {
          name: style.id === "axiom" ? "Axiom selected" : `Use ${style.name}`,
          exact: true,
        })
        .click();
      await expect(
        dialog.getByRole("radio", { name: style.name, exact: true }),
      ).toBeChecked();
      await expect(page.locator("html")).toHaveAttribute(
        "data-interface-style",
        style.id,
      );
      const row = card.locator(".interface-gallery-row"),
        checkbox = card.getByRole("checkbox", {
          name: `${style.name} include field notes`,
          exact: true,
        });
      await checkbox.uncheck();
      await expect(checkbox).not.toBeChecked();
      await expect(row).toHaveAttribute("data-selected", "false");
      await checkbox.check();
      await expect(checkbox).toBeChecked();
      await expect(row).toHaveAttribute("data-selected", "true");
      await page.mouse.move(1, 1);
      await info.attach(`${mode}-${style.id}-checkbox-paint`, {
        body: JSON.stringify(await expectGalleryCheckboxPaint(row)),
        contentType: "application/json",
      });
      await revealField(search);
      await fullyInsideFields([
        search,
        card.getByRole("combobox", {
          name: `${style.name} sample density`,
          exact: true,
        }),
        card.locator(".interface-gallery-row"),
      ]);
      await firstLineAlignment(card.locator(".interface-gallery-row"));
      await page.screenshot({
        path: info.outputPath(`gallery-${mode}-${style.id}-fields.png`),
      });
      await revealField(card.locator(".interface-gallery-row"));
      await fullyInsideFields([
        card.locator(".interface-gallery-row"),
        card.getByRole("switch", {
          name: `${style.name} sample reading guides`,
          exact: true,
        }),
        card.getByRole("slider", {
          name: `${style.name} sample reading scale`,
          exact: true,
        }),
      ]);
      await page.screenshot({
        path: info.outputPath(`gallery-${mode}-${style.id}-controls.png`),
      });
      await card
        .getByRole("button", { name: "Example action", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`gallery-${mode}-${style.id}-actions.png`),
      });
      await containLayout(page);
    }
    expect(await canonicalDocuments(page)).toBe(before);
    await dialog
      .getByRole("button", { name: "Hide comparison", exact: true })
      .click();
    await expect(gallery).toHaveCount(0);
    await expect(preview).toBeVisible();
    expect(
      await previewNode!.evaluate(
        (node) =>
          node.isConnected &&
          node === document.querySelector(".demo-settings-preview"),
      ),
    ).toBe(true);
    const axiom = dialog.getByRole("radio", {
      name: interfaceStyles[0].name,
      exact: true,
    });
    await axiom.focus();
    await axiom.press("ArrowRight");
    await expect(
      dialog.getByRole("radio", { name: interfaceStyles[1].name, exact: true }),
    ).toBeChecked();
    await containLayout(page);
    expect(await canonicalDocuments(page)).toBe(before);
  });

  test(`interface comparison / ${mode}: large square controls and accessible chrome`, async ({
    page,
    browserName,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({
      colorScheme: mode,
      reducedMotion: "reduce",
      contrast: "more",
    });
    const dialog = page.getByRole("dialog", { name: "Appearance & editor" });
    await dialog.getByRole("button", { name: mode, exact: true }).click();
    for (const [label, value] of [
      ["Interface font size value", "22"],
      ["Corner radius value", "0"],
    ]) {
      const field = dialog.getByLabel(label, { exact: true });
      await field.fill(value);
      await field.press("Enter");
    }
    await dialog.getByLabel("Shadows", { exact: true }).selectOption("none");
    await dialog
      .getByRole("button", { name: "Compare all styles", exact: true })
      .click();
    const gallery = dialog.getByRole("region", {
      name: "Interface style comparison",
    });
    for (const style of interfaceStyles) {
      const card = gallery.getByRole("article", {
        name: `${style.name} controls`,
        exact: true,
      });
      await card
        .getByRole("button", { name: "Preview overlay", exact: true })
        .click();
      const geometry = await card.evaluate((element) => {
        const input =
          element.querySelector<HTMLInputElement>('[type="search"]')!;
        const shell = input.closest(".ui-input-group")!;
        const icon = shell
          .querySelector(".ui-input-leading svg")!
          .getBoundingClientRect();
        const box = shell.getBoundingClientRect();
        return {
          iconOffset: Math.abs(
            icon.y + icon.height / 2 - box.y - box.height / 2,
          ),
          width: input.getBoundingClientRect().width,
          radius: getComputedStyle(shell).borderRadius,
          overlayShadow: getComputedStyle(
            element.querySelector(".interface-overlay")!,
          ).boxShadow,
          overflow: element.scrollWidth > element.clientWidth + 1,
        };
      });
      expect(geometry.iconOffset).toBeLessThan(1);
      expect(geometry.width).toBeGreaterThan(100);
      expect(geometry.radius).toBe("0px");
      expect(geometry.overlayShadow).toBe("none");
      expect(geometry.overflow).toBe(false);
      const search = card.getByRole("searchbox", {
        name: `${style.name} sample search`,
        exact: true,
      });
      await revealField(search);
      await fullyInsideFields([
        search,
        card.getByRole("combobox", {
          name: `${style.name} sample density`,
          exact: true,
        }),
        card.locator(".interface-gallery-row"),
      ]);
      await firstLineAlignment(card.locator(".interface-gallery-row"));
      await page.mouse.move(1, 1);
      await info.attach(`${mode}-${style.id}-large-checkbox-paint`, {
        body: JSON.stringify(
          await expectGalleryCheckboxPaint(
            card.locator(".interface-gallery-row"),
          ),
        ),
        contentType: "application/json",
      });
      await page.screenshot({
        path: info.outputPath(`gallery-${mode}-${style.id}-large-fields.png`),
      });
      await revealField(card.locator(".interface-gallery-row"));
      await fullyInsideFields([
        card.locator(".interface-gallery-row"),
        card.getByRole("switch", {
          name: `${style.name} sample reading guides`,
          exact: true,
        }),
        card.getByRole("slider", {
          name: `${style.name} sample reading scale`,
          exact: true,
        }),
      ]);
      await page.screenshot({
        path: info.outputPath(`gallery-${mode}-${style.id}-large-controls.png`),
      });
      await card
        .getByRole("button", { name: "Close sample overlay", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`gallery-${mode}-${style.id}-large-overlay.png`),
      });
      await containLayout(page);
    }
    // Text-only stress in this inert comparison fixture exercises long titles
    // without changing application props, source documents or saved preferences.
    // A narrow desktop alone does not necessarily wrap the short default title.
    const sourceBeforeStress = await canonicalDocuments(page);
    const preferencesBeforeStress = await page.evaluate(() =>
      localStorage.getItem("axiom-showcase:appearance"),
    );
    await page.setViewportSize({ width: 1024, height: 800 });
    for (const style of interfaceStyles) {
      const card = gallery.getByRole("article", {
        name: `${style.name} controls`,
        exact: true,
      });
      const row = card.locator(".interface-gallery-row");
      const previousTitle = await row.evaluate((element) => {
        const title = element.querySelector(
          ".interface-gallery-row > span:last-child",
        )!;
        const previous = title.textContent;
        title.textContent =
          "Field notes — α, β and ∇: evidence, numerical stability and reproducibility";
        return previous;
      });
      try {
        await revealField(row);
        await fullyInsideFields([
          row,
          card.getByRole("switch", {
            name: `${style.name} sample reading guides`,
            exact: true,
          }),
          card.getByRole("slider", {
            name: `${style.name} sample reading scale`,
            exact: true,
          }),
        ]);
        await firstLineAlignment(row, true);
        await page.screenshot({
          path: info.outputPath(
            `gallery-${mode}-${style.id}-wrapped-controls.png`,
          ),
        });
      } finally {
        await row.evaluate((element, previous) => {
          element.querySelector(
            ".interface-gallery-row > span:last-child",
          )!.textContent = previous;
        }, previousTitle);
      }
      await containLayout(page);
    }
    expect(await canonicalDocuments(page)).toBe(sourceBeforeStress);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("axiom-showcase:appearance"),
      ),
    ).toBe(preferencesBeforeStress);
    // The renderer's media emulation, not a JS matchMedia shim, exercises
    // opaque texture-free chrome. This capability is exposed through CDP.
    if (browserName === "chromium") {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [
          { name: "prefers-reduced-transparency", value: "reduce" },
          { name: "prefers-reduced-motion", value: "reduce" },
        ],
      });
      for (const style of interfaceStyles)
        expect(
          await dialog
            .locator(
              `.interface-style-miniature[data-interface-style="${style.id}"] .interface-chrome`,
            )
            .evaluate((element) => getComputedStyle(element).backgroundImage),
        ).toBe("none");
      await cdp.detach();
    }
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    if (
      await page.evaluate(() => matchMedia("(forced-colors: active)").matches)
    ) {
      for (const style of interfaceStyles) {
        const card = gallery.getByRole("article", {
          name: `${style.name} controls`,
          exact: true,
        });
        const search = card.getByRole("searchbox", {
          name: `${style.name} sample search`,
          exact: true,
        });
        await search.focus();
        expect(
          await search
            .locator("..")
            .evaluate((element) =>
              parseFloat(getComputedStyle(element).outlineWidth),
            ),
        ).toBeGreaterThan(0);
      }
      await page.screenshot({
        path: info.outputPath(`gallery-${mode}-forced-colors.png`),
      });
    }
    await containLayout(page);
  });
}
