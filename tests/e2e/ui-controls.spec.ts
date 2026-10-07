import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fixture, origin } from "./native-editor-helpers";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
import { interfaceStyles } from "../../packages/shared/src/interface-styles";
import {
  expectGalleryCheckboxPaint,
  expectInterfaceChromeContrast,
} from "./interface-style-helpers";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Control acceptance requires isolated staging on 3004.");
});

test("instance checks cancel during native navigation and rapid focus/pageshow resume a fresh lifetime", async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  const body = "# Navigation lifetime\n\nKeep this research unchanged.",
    f = await fixture(browser, body),
    consoleErrors: string[] = [],
    routing: Promise<void>[] = [];
  f.page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  try {
    await f.page.addInitScript(() => {
      const key = "navigation-lifetime-evidence",
        log = (value: Record<string, unknown>) => {
          const records = JSON.parse(sessionStorage.getItem(key) ?? "[]");
          records.push(value);
          sessionStorage.setItem(key, JSON.stringify(records));
        };
      let phase = "active";
      for (const type of ["beforeunload", "pagehide", "pageshow", "focus"]) {
        window.addEventListener(type, () => {
          if (type === "pagehide") phase = "leaving";
          else if (type === "beforeunload") phase = "prepared";
          else if (type === "pageshow" || phase !== "leaving") phase = "active";
          log({ event: type, phase });
        });
      }
      const native = window.fetch;
      window.fetch = function (input, options) {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (new URL(url, location.href).pathname === "/api/v1/instance") {
          const signal =
            options?.signal ?? (input instanceof Request ? input.signal : null);
          log({ event: "instance", phase, abortedAtStart: !!signal?.aborted });
          signal?.addEventListener(
            "abort",
            () => log({ event: "instance-aborted", phase }),
            { once: true },
          );
        }
        // Instrument only; the production response/rejection stays untouched.
        return native.call(this, input, options);
      };
    });
    await f.page.route("**/api/v1/instance", (route) => {
      const work = (async () => {
        // A slow real bootstrap response keeps the navigation race reproducible
        // in WebKit. No console/page error or route rejection is suppressed.
        await new Promise((resolve) => setTimeout(resolve, 150));
        await route.continue();
      })();
      routing.push(work);
      return work;
    });
    for (const path of [
      "/workbench/settings/theme",
      "/workbench/workspaces",
      "/workbench/settings/general",
    ]) {
      const bootstrap = f.page.waitForRequest(
        (request) => new URL(request.url()).pathname === "/api/v1/instance",
      );
      await f.page.goto(path, { waitUntil: "domcontentloaded" });
      await bootstrap;
      // Leave with the actual bootstrap request still outstanding. This is a
      // full document navigation, not only a synthetic lifecycle unit test.
    }
    await expect(f.page.locator(".ws-app")).toBeVisible();
    const count = () =>
      f.page.evaluate(
        () =>
          JSON.parse(
            sessionStorage.getItem("navigation-lifetime-evidence") ?? "[]",
          ).filter((entry: { event: string }) => entry.event === "instance")
            .length as number,
      );
    let before = await count();
    await f.page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("beforeunload"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect.poll(count).toBeGreaterThanOrEqual(before + 2);
    await f.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/instance" &&
        response.ok(),
    );
    before = await count();
    await f.page.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(await count()).toBe(before);
    await f.page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expect.poll(count).toBeGreaterThan(before);
    await f.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/instance" &&
        response.ok(),
    );
    await f.page.reload();
    await expect(f.page.locator(".ws-app")).toBeVisible();
    await Promise.all(routing);
    const evidence = await f.page.evaluate(
      () =>
        JSON.parse(
          sessionStorage.getItem("navigation-lifetime-evidence") ?? "[]",
        ) as { event: string; phase: string; abortedAtStart?: boolean }[],
    );
    expect(
      evidence
        .filter((entry) => entry.event === "instance")
        .every((entry) => !entry.abortedAtStart && entry.phase === "active"),
    ).toBe(true);
    expect(
      evidence.filter((entry) => entry.event === "instance-aborted").length,
    ).toBeGreaterThanOrEqual(2);
    expect(evidence.some((entry) => entry.event === "pagehide")).toBe(true);
    expect(evidence.some((entry) => entry.event === "pageshow")).toBe(true);
    expect(consoleErrors).toEqual([]);
    expect(f.errors).toEqual([]);
    expect(await f.source()).toBe(body);
    await info.attach("navigation-lifetime-evidence", {
      body: JSON.stringify(evidence),
      contentType: "application/json",
    });
  } finally {
    await Promise.all(routing);
    await f.close();
  }
});

test("interface treatments preview transactionally, preserve typography and survive save/reload", async ({
  browser,
}, info) => {
  const f = await fixture(
    browser,
    "# Unchanged research\n\nEvidence stays intact.",
  );
  try {
    const attachContrast = async (name: string, value: unknown) => {
      const path = info.outputPath(`${name}.json`);
      await writeFile(path, JSON.stringify(value, null, 2));
      await info.attach(name, { path, contentType: "application/json" });
    };
    const read = async () => {
      const response = await f.member.request.get(
        "/api/v1/me/preferences-bundle",
        { headers: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) } },
      );
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const original = await read();
    await f.page.goto("/workbench/settings/theme");
    for (const mode of ["light", "dark"]) {
      await f.page.getByLabel("Color mode", { exact: true }).selectOption(mode);
      for (const { id, name } of interfaceStyles) {
        const choice = f.page.getByRole("radio", { name, exact: true });
        await choice.check();
        await expect(choice).toBeChecked();
        await expect(f.page.locator("html")).toHaveAttribute(
          "data-interface-style",
          id,
        );
        const contrast = await expectInterfaceChromeContrast(f.page);
        await attachContrast(`chrome-contrast-${id}-${mode}`, contrast);
        if (id === "signal") {
          await f.page.screenshot({
            path: info.outputPath(`signal-${mode}-production-chrome.png`),
          });
          await f.page.getByLabel("Account menu", { exact: true }).click();
          await expect(
            f.page.locator(".ws-account-menu[open] > div"),
          ).toBeVisible();
          await attachContrast(
            `popup-contrast-${id}-${mode}`,
            await expectInterfaceChromeContrast(f.page),
          );
          await f.page.screenshot({
            path: info.outputPath(`signal-${mode}-production-account-menu.png`),
          });
          await f.page.keyboard.press("Escape");
          await expect(f.page.locator(".ws-account-menu[open]")).toHaveCount(0);
          await f.page
            .getByRole("button", { name: "Recent work", exact: true })
            .click();
          await expect(
            f.page.getByRole("region", {
              name: "Recent work switcher",
              exact: true,
            }),
          ).toBeVisible();
          await attachContrast(
            `recent-contrast-${id}-${mode}`,
            await expectInterfaceChromeContrast(f.page),
          );
          await f.page.screenshot({
            path: info.outputPath(`signal-${mode}-production-recent-menu.png`),
          });
          await f.page.keyboard.press("Escape");
          await expect(f.page.locator(".workspace-recent[open]")).toHaveCount(
            0,
          );
        }
        // Preview is not a persisted preference or a document mutation.
        expect(await read()).toEqual(original);
      }
    }
    await f.page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(f.page.locator("html")).toHaveAttribute(
      "data-interface-style",
      original.appearance.preferences.interfaceStyle,
    );
    await f.page.getByRole("radio", { name: "Harbor", exact: true }).check();
    await f.page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(f.page.getByLabel("Appearance synchronization")).toContainText(
      "synced to your account",
    );
    const saved = await read();
    expect(saved.appearance.preferences).toEqual({
      ...original.appearance.preferences,
      interfaceStyle: "harbor",
    });
    expect(saved.editor).toEqual(
      original.editor.version === 0
        ? { ...original.editor, version: 1 }
        : { ...original.editor, version: original.editor.version + 1 },
    );
    await f.page.reload();
    await expect(f.page.locator("html")).toHaveAttribute(
      "data-interface-style",
      "harbor",
    );
    const preview = f.page.getByLabel("Appearance settings preview", {
      exact: true,
    });
    await preview
      .getByRole("button", { name: "Interface", exact: true })
      .click();
    const opener = preview.getByRole("button", { name: "Open sample dialog" });
    await opener.click();
    const dialog = f.page.getByRole("dialog", {
      name: "Sample form",
      exact: true,
    });
    await expect(dialog.getByLabel("Sample title")).toBeFocused();
    await expect(dialog.locator(".dialog-footer")).toBeInViewport();
    await f.page.screenshot({
      path: info.outputPath("harbor-production-form.png"),
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(opener).toBeFocused();
    expect(await f.source()).toBe(
      "# Unchanged research\n\nEvidence stays intact.",
    );
  } finally {
    await f.close();
  }
});

test("appearance v10 can read representable styles but cannot erase v12 preferences", async ({
  browser,
}) => {
  const f = await fixture(browser, "Unchanged research.");
  try {
    const headers = { "X-Axiom-Appearance-Schema": "10" };
    const current = await (
      await f.member.request.get("/api/v1/me/preferences-bundle")
    ).json();
    const legacyResponse = await f.member.request.get(
      "/api/v1/me/preferences-bundle",
      { headers },
    );
    expect(legacyResponse.ok()).toBe(true);
    const legacy = await legacyResponse.json();
    expect(legacy.appearance.preferences).toEqual({
      ...current.appearance.preferences,
      schemaVersion: 10,
    });
    const legacySingle = await f.member.request.get("/api/v1/me/preferences", {
      headers,
    });
    expect(legacySingle.ok()).toBe(true);
    expect(await legacySingle.json()).toEqual(legacy.appearance);
    const writes = [
      ["preferences", { ...legacy.appearance, mutationId: randomUUID() }],
      ["preferences-bundle", { ...legacy, mutationId: randomUUID() }],
    ] as const;
    for (const [path, data] of writes) {
      const response = await f.member.request.patch(`/api/v1/me/${path}`, {
        headers: { ...headers, origin },
        data,
      });
      expect(response.status()).toBe(426);
    }
    const saved = await f.member.request.patch(
      "/api/v1/me/preferences-bundle",
      {
        headers: { origin },
        data: {
          appearance: {
            version: current.appearance.version,
            preferences: {
              ...current.appearance.preferences,
              schemaVersion: APPEARANCE_SCHEMA,
              interfaceStyle: "harbor",
            },
          },
          editor: current.editor,
          mutationId: randomUUID(),
        },
      },
    );
    expect(saved.ok(), await saved.text()).toBe(true);
    for (const path of ["preferences", "preferences-bundle"]) {
      const response = await f.member.request.get(`/api/v1/me/${path}`, {
        headers,
      });
      expect(response.status()).toBe(426);
      expect((await response.json()).error).toContain("Reload Axiom");
    }
    const retained = await (
      await f.member.request.get("/api/v1/me/preferences-bundle", {
        headers: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
      })
    ).json();
    expect(retained.appearance.preferences.interfaceStyle).toBe("harbor");
    expect(retained.editor.preferences).toEqual(current.editor.preferences);
    expect(await f.source()).toBe("Unchanged research.");
  } finally {
    await f.close();
  }
});

test("icon fields align and workspace toolbar actions never split their labels", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const f = await fixture(browser, "Original field-alignment research.\n");
  try {
    for (const uiSize of [15, 22]) {
      for (const { id } of interfaceStyles) {
        const current = await (
          await f.member.request.get("/api/v1/me/preferences-bundle")
        ).json();
        const response = await f.member.request.patch(
          "/api/v1/me/preferences-bundle",
          {
            headers: { origin },
            data: {
              appearance: {
                version: current.appearance.version,
                preferences: {
                  ...current.appearance.preferences,
                  interfaceStyle: id,
                  uiSize,
                  mode: uiSize === 15 ? "light" : "dark",
                },
              },
              editor: current.editor,
              mutationId: randomUUID(),
            },
          },
        );
        expect(response.ok(), await response.text()).toBe(true);
        await f.page.setViewportSize({
          width: uiSize === 15 ? 1440 : 1100,
          height: 1000,
        });
        await f.page.goto("/workbench/workspaces");
        await f.page.reload();
        await expect(f.page.locator("html")).toHaveAttribute(
          "data-interface-style",
          id,
        );
        const toolbar = f.page.locator(".workspace-directory-filters"),
          search = toolbar.getByRole("searchbox", { name: "Find a workspace" }),
          groupLink = toolbar.getByRole("link", {
            name: "Manage groups",
            exact: true,
          });
        await expect(groupLink).toBeInViewport();
        const layout = await groupLink.evaluate((el) => {
          const text = el.querySelector("span")!,
            range = document.createRange();
          range.selectNodeContents(text);
          const box = text.getBoundingClientRect(),
            icon = el.querySelector("svg")!.getBoundingClientRect();
          return {
            lines: range.getClientRects().length,
            offset: Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2),
          };
        });
        expect(layout.lines).toBe(1);
        expect(layout.offset).toBeLessThan(1);
        expect(
          await toolbar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
        const before = await search.boundingBox();
        await search.fill("Alignment check");
        expect(await search.boundingBox()).toEqual(before);
        await toolbar
          .getByRole("button", { name: "Clear workspace search" })
          .click();
        await expect(search).toHaveValue("");
        await expect(search).toBeFocused();
        const sidebar = f.page.getByRole("searchbox", {
          name: "Filter workspaces",
          exact: true,
        });
        await sidebar.fill("Workspace");
        await f.page
          .getByRole("button", { name: "Clear sidebar filter" })
          .click();
        await expect(sidebar).toBeFocused();
        const geometry = await f.page
          .locator(".ui-search-field:visible")
          .evaluateAll((groups) =>
            groups.map((el) => {
              const box = el.getBoundingClientRect(),
                icon = el
                  .querySelector(".ui-input-leading > svg")!
                  .getBoundingClientRect(),
                input = el.querySelector("input")!;
              return {
                offset: Math.abs(
                  icon.y + icon.height / 2 - box.y - box.height / 2,
                ),
                border: getComputedStyle(input).borderWidth,
                background: getComputedStyle(input).backgroundColor,
              };
            }),
          );
        for (const field of geometry) {
          expect(field.offset).toBeLessThan(1);
          expect(field.border).toBe("0px");
          expect(field.background).toBe("rgba(0, 0, 0, 0)");
        }
      }
    }
    await f.page.screenshot({
      path: info.outputPath("workspace-toolbar-fields-large-dark.png"),
    });
    await f.page.goto("/workbench/settings/profile");
    const zone = f.page.getByRole("combobox", {
      name: "Time zone",
      exact: true,
    });
    await zone.fill("shanghai");
    await f.page.getByRole("option", { name: /Asia\/Shanghai/ }).click();
    await expect(zone).toHaveValue("Asia/Shanghai");
    await expect(zone).toBeFocused();
    await f.page.screenshot({
      path: info.outputPath("settings-icon-fields-large-dark.png"),
    });
    expect(await f.source()).toBe("Original field-alignment research.\n");
  } finally {
    await f.close();
  }
});

test("production comparison gallery keeps checkbox and icon beside wrapped large labels in both color modes", async ({
  browser,
}, info) => {
  test.setTimeout(240000);
  const body =
      "# Unchanged comparison research\n\nThe gallery is local UI only.\n",
    f = await fixture(browser, body);
  try {
    // Capture the public Copy Markdown action without touching the OS clipboard.
    // Source DOM is virtualized: innerText can omit offscreen lines, while
    // textContent concatenates line nodes without canonical newline characters.
    await f.page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (source: string) => {
            (
              window as Window & { __axiomScratchpadCopy?: string }
            ).__axiomScratchpadCopy = source;
          },
        },
      });
    });
    await f.page.setViewportSize({ width: 1100, height: 1000 });
    const read = async () =>
      (await f.member.request.get("/api/v1/me/preferences-bundle")).json();
    for (const mode of ["light", "dark"] as const) {
      const current = await read();
      const response = await f.member.request.patch(
        "/api/v1/me/preferences-bundle",
        {
          headers: { origin },
          data: {
            appearance: {
              version: current.appearance.version,
              preferences: {
                ...current.appearance.preferences,
                mode,
                uiSize: 22,
                uiScale: 1.5,
                radius: 0,
                shadows: "none",
                motion: "none",
              },
            },
            editor: current.editor,
            mutationId: randomUUID(),
          },
        },
      );
      expect(response.ok(), await response.text()).toBe(true);
      await f.page.goto("/workbench/settings/theme");
      await expect
        .poll(() =>
          f.page
            .locator(".ws-app")
            .evaluate((element) =>
              parseFloat(getComputedStyle(element).fontSize),
            ),
        )
        .toBeCloseTo(33, 1);
      const equation = f.page
        .locator(".settings-scratchpad [data-math-request]")
        .first();
      await equation.scrollIntoViewIfNeeded();
      await expect(equation).toHaveAttribute("data-math-state", "ready");
      const preview = f.page.locator(".settings-preview-pane"),
        separator = f.page.getByRole("separator", {
          name: "Resize settings and preview",
          exact: true,
        });
      await separator.press("ArrowRight");
      const splitWidth = await separator.getAttribute("aria-valuenow"),
        fieldsWidth = (await f.page
          .locator(".settings-fields-pane")
          .boundingBox())!.width;
      await preview
        .getByRole("button", { name: "Source", exact: true })
        .click();
      const source = preview.locator(".cm-content"),
        copiedScratch = async () => {
          await f.page.evaluate(() => {
            delete (window as Window & { __axiomScratchpadCopy?: string })
              .__axiomScratchpadCopy;
          });
          await preview
            .getByRole("button", { name: "Copy sample Markdown", exact: true })
            .click();
          const copied = await f.page.evaluate(
            () =>
              (window as Window & { __axiomScratchpadCopy?: string })
                .__axiomScratchpadCopy,
          );
          expect(copied).toBeDefined();
          return copied!;
        },
        originalScratch = await copiedScratch();
      expect(originalScratch).toContain("# A little room to think\n\n");
      expect(originalScratch).toContain("\\int_0^1 x^2");
      await source.click();
      await f.page.keyboard.press("ControlOrMeta+a");
      await f.page.keyboard.insertText("Comparison scratch work survives");
      await expect(source).toContainText("Comparison scratch work survives");
      expect(await copiedScratch()).toBe("Comparison scratch work survives");
      const sourceNode = await source.elementHandle();
      const persisted = await read();
      await f.page
        .getByRole("button", { name: "Compare all styles", exact: true })
        .click();
      await expect(preview).not.toBeVisible();
      await expect(separator).not.toBeVisible();
      expect(
        (await f.page.locator(".settings-fields-pane").boundingBox())!.width,
      ).toBeGreaterThan(fieldsWidth + 250);
      const gallery = f.page.getByRole("region", {
        name: "Interface style comparison",
        exact: true,
      });
      await expect(gallery.locator(".interface-gallery-card")).toHaveCount(
        interfaceStyles.length,
      );
      for (const { id, name } of interfaceStyles) {
        const card = gallery.getByRole("article", {
            name: `${name} controls`,
            exact: true,
          }),
          row = card.locator(".interface-gallery-row");
        await row.evaluate((element) => {
          const owner = element.closest<HTMLElement>(".settings-content")!;
          owner.scrollTop +=
            element.getBoundingClientRect().top -
            owner.getBoundingClientRect().top -
            owner.clientTop -
            16;
        });
        const geometry = await row.evaluate((element) => {
          const leading = element
              .querySelector(".interface-gallery-leading")!
              .getBoundingClientRect(),
            checkbox = element
              .querySelector("input[type='checkbox']")!
              .getBoundingClientRect(),
            icon = element
              .querySelector(".interface-gallery-leading > svg")!
              .getBoundingClientRect(),
            text = element.lastElementChild!,
            textBox = text.getBoundingClientRect(),
            lineHeight = parseFloat(getComputedStyle(text).lineHeight),
            owner = element.closest<HTMLElement>(".settings-content")!,
            ownerBox = owner.getBoundingClientRect(),
            box = element.getBoundingClientRect();
          const node = text.firstChild!,
            fragments = [
              ...(node.textContent ?? "").matchAll(/[\p{L}\p{N}]+/gu),
            ]
              .filter((match) => match[0].length > 1)
              .filter((match) => {
                const range = document.createRange();
                range.setStart(node, match.index!);
                range.setEnd(node, match.index! + match[0].length);
                return (
                  Array.from(range.getClientRects()).filter(
                    (rect) => rect.width > 0 && rect.height > 0,
                  ).length > 1
                );
              });
          return {
            direction: getComputedStyle(element).flexDirection,
            leadingBeforeText: leading.right <= textBox.left + 0.5,
            checkboxBeforeIcon: checkbox.right <= icon.left + 0.5,
            checkboxIconOffset: Math.abs(
              checkbox.top + checkbox.height / 2 - icon.top - icon.height / 2,
            ),
            firstLineOffset: Math.abs(
              leading.top + leading.height / 2 - textBox.top - lineHeight / 2,
            ),
            wrappedLines: Math.round(textBox.height / lineHeight),
            usableEms:
              textBox.width / parseFloat(getComputedStyle(text).fontSize),
            fragmentedWords: fragments.length,
            overflow: element.scrollWidth > element.clientWidth + 1,
            insideScrollport:
              box.top >= ownerBox.top + owner.clientTop - 0.5 &&
              box.bottom <=
                ownerBox.top + owner.clientTop + owner.clientHeight + 0.5,
          };
        });
        expect(geometry.direction).toBe("row");
        expect(geometry.leadingBeforeText).toBe(true);
        expect(geometry.checkboxBeforeIcon).toBe(true);
        expect(geometry.checkboxIconOffset).toBeLessThan(1);
        expect(geometry.firstLineOffset).toBeLessThan(1);
        expect(geometry.wrappedLines).toBeGreaterThanOrEqual(1);
        expect(geometry.wrappedLines).toBeLessThanOrEqual(3);
        expect(geometry.usableEms).toBeGreaterThanOrEqual(12);
        expect(geometry.fragmentedWords).toBe(0);
        expect(geometry.overflow).toBe(false);
        expect(geometry.insideScrollport).toBe(true);
        const checkbox = card.getByRole("checkbox", {
          name: `${name} include field notes`,
          exact: true,
        });
        await checkbox.uncheck();
        await expect(checkbox).not.toBeChecked();
        await expect(row).toHaveAttribute("data-selected", "false");
        await checkbox.check();
        await expect(checkbox).toBeChecked();
        await expect(row).toHaveAttribute("data-selected", "true");
        await f.page.mouse.move(1, 1);
        await info.attach(`${mode}-${id}-checkbox-paint`, {
          body: JSON.stringify(await expectGalleryCheckboxPaint(row)),
          contentType: "application/json",
        });
        await f.page.screenshot({
          path: info.outputPath(
            `production-gallery-${mode}-${id}-wrapped-row.png`,
          ),
        });
      }
      await f.page
        .getByRole("button", { name: "Hide comparison", exact: true })
        .click();
      await expect(preview).toBeVisible();
      await expect(separator).toHaveAttribute("aria-valuenow", splitWidth!);
      expect(
        await sourceNode!.evaluate(
          (node) =>
            node.isConnected &&
            node ===
              document.querySelector(".settings-preview-pane .cm-content"),
        ),
      ).toBe(true);
      await expect(source).toContainText("Comparison scratch work survives");
      await source.click();
      await f.page.keyboard.press("ControlOrMeta+z");
      await expect.poll(copiedScratch).toBe(originalScratch);
      expect(await read()).toEqual(persisted);
      expect(await f.source()).toBe(body);
    }
  } finally {
    await f.close();
  }
});
