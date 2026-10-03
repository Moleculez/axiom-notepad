import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
import { interfaceStyles } from "../../packages/shared/src/interface-styles";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Control acceptance requires isolated staging on 3004.");
});

test("interface treatments preview transactionally, preserve typography and survive save/reload", async ({
  browser,
}, info) => {
  const f = await fixture(
    browser,
    "# Unchanged research\n\nEvidence stays intact.",
  );
  try {
    const read = async () => {
      const response = await f.member.request.get(
        "/api/v1/me/preferences-bundle",
      );
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const original = await read();
    await f.page.goto("/workbench/settings/theme");
    for (const { id, name } of interfaceStyles) {
      const choice = f.page.getByRole("button", {
        name: new RegExp(`^${name} `),
      });
      await choice.click();
      await expect(choice).toHaveAttribute("aria-pressed", "true");
      await expect(f.page.locator("html")).toHaveAttribute(
        "data-interface-style",
        id,
      );
      // Preview is not a persisted preference or a document mutation.
      expect(await read()).toEqual(original);
    }
    await f.page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(f.page.locator("html")).toHaveAttribute(
      "data-interface-style",
      original.appearance.preferences.interfaceStyle,
    );
    await f.page.getByRole("button", { name: /^macOS Studio / }).click();
    await f.page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(f.page.getByLabel("Appearance synchronization")).toContainText(
      "synced to your account",
    );
    const saved = await read();
    expect(saved.appearance.preferences).toEqual({
      ...original.appearance.preferences,
      interfaceStyle: "macos",
    });
    expect(saved.editor).toEqual(
      original.editor.version === 0
        ? { ...original.editor, version: 1 }
        : { ...original.editor, version: original.editor.version + 1 },
    );
    await f.page.reload();
    await expect(f.page.locator("html")).toHaveAttribute(
      "data-interface-style",
      "macos",
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
      path: info.outputPath("macos-production-form.png"),
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

test("appearance v10 can read representable styles but cannot erase v11 preferences", async ({
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
              interfaceStyle: "macos",
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
      await f.member.request.get("/api/v1/me/preferences-bundle")
    ).json();
    expect(retained.appearance.preferences.interfaceStyle).toBe("macos");
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
