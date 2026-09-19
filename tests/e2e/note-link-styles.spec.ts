import { test, expect, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin, caret } from "./native-editor-helpers";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Use isolated staging for note-link appearance acceptance.",
    );
});

const longLabel = "LongResearchReference".repeat(12);
const body = `Follow [[Field notes|Derivation notebook]] for the argument, or revisit [[Missing experiment]].\n\nA long reference: [[Field notes|${longLabel}]].\n\nAn ordinary paragraph for continued writing.\n\n[External paper](https://example.org/paper)`;

async function styleOf(link: Locator) {
  return link.evaluate((el) => {
    const style = getComputedStyle(el),
      paragraph = getComputedStyle(el.closest("p")!),
      icon = getComputedStyle(el, "::before");
    return {
      color: style.color,
      bodyColor: paragraph.color,
      background: style.backgroundColor,
      font: style.fontFamily,
      bodyFont: paragraph.fontFamily,
      size: style.fontSize,
      bodySize: paragraph.fontSize,
      lineHeight: style.lineHeight,
      bodyLineHeight: paragraph.lineHeight,
      decoration: style.textDecorationLine,
      decorationStyle: style.textDecorationStyle,
      radius: style.borderTopLeftRadius,
      icon: icon.maskImage,
      iconText: icon.content,
      iconBackground: icon.backgroundColor,
      iconPaint: icon.backgroundImage,
      iconPaintSize: icon.backgroundSize,
      iconMaskSize: icon.maskSize,
    };
  });
}

async function iconAlignment(link: Locator) {
  return link.evaluate((el) => {
    // Pseudo-elements have no DOM geometry API. Measure an equivalent inline
    // box in an isolated shadow tree, without touching the editable document.
    const host = document.createElement("div");
    host.style.cssText = `position:absolute;left:-10000px;top:0;width:${el.closest("p")!.clientWidth}px`;
    const root = host.attachShadow({ mode: "open" });
    const label = document.createElement("a"),
      icon = document.createElement("span");
    for (const [target, computed] of [
      [label, getComputedStyle(el)],
      [icon, getComputedStyle(el, "::before")],
    ] as const)
      for (const property of computed)
        target.style.setProperty(property, computed.getPropertyValue(property));
    const text = document.createTextNode(el.textContent!);
    label.append(icon, text);
    root.append(label);
    document.body.append(host);
    try {
      const range = document.createRange();
      range.selectNodeContents(text);
      const firstLine = range.getClientRects()[0],
        graphic = icon.getBoundingClientRect();
      return {
        centerOffset:
          graphic.y + graphic.height / 2 - (firstLine.y + firstLine.height / 2),
        gap: firstLine.x - graphic.right,
        width: graphic.width,
      };
    } finally {
      host.remove();
    }
  });
}

for (const mode of ["light", "dark"] as const)
  test(`note references remain distinct, inline and source-safe in ${mode} appearance`, async ({
    browser,
  }, info) => {
    const f = await fixture(browser, body);
    try {
      const created = await f.member.request.post("/api/v1/notes", {
        headers: { origin },
        data: {
          groupId: f.group.id,
          title: "Field notes",
          body: "Reference destination.",
        },
      });
      expect(created.ok(), await created.text()).toBe(true);
      const note = await created.json();
      const bundle = await (
        await f.member.request.get("/api/v1/me/preferences-bundle")
      ).json();
      const saved = await f.member.request.patch(
        "/api/v1/me/preferences-bundle",
        {
          headers: { origin },
          data: {
            editor: bundle.editor,
            appearance: {
              version: bundle.appearance.version,
              preferences: {
                ...bundle.appearance.preferences,
                mode,
                themePack: mode === "dark" ? "technical-slate" : "default",
                radius: mode === "dark" ? 0 : 12,
                shadows: "none",
              },
            },
            mutationId: randomUUID(),
          },
        },
      );
      expect(saved.ok(), await saved.text()).toBe(true);
      await f.page.reload();
      const editor = f.page.getByTestId("note-editor");
      const link = editor
        .locator("a.wiki-link")
        .filter({ hasText: "Derivation notebook" });
      await expect(link).toBeVisible();
      await expect(link).not.toHaveClass(/unresolved/);
      await expect(link).toHaveAttribute("title", "Linked note: Field notes");
      const writeStyle = await styleOf(link);
      expect(writeStyle.color).not.toBe(writeStyle.bodyColor);
      expect(writeStyle.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(writeStyle.font).toBe(writeStyle.bodyFont);
      expect(writeStyle.size).toBe(writeStyle.bodySize);
      expect(writeStyle.lineHeight).toBe(writeStyle.bodyLineHeight);
      expect(writeStyle.decoration).toBe("underline");
      expect(writeStyle.icon).toContain("data:image/svg+xml");
      expect(writeStyle.iconText).toBe('""');
      // WebKit must not paint the inline font box outside the icon mask.
      expect(writeStyle.iconBackground).toBe("rgba(0, 0, 0, 0)");
      expect(writeStyle.iconPaint).toContain("linear-gradient");
      expect(writeStyle.iconPaintSize).toBe(writeStyle.iconMaskSize);
      if (mode === "dark") expect(writeStyle.radius).toBe("0px");
      const unresolved = editor.locator("a.wiki-link.unresolved");
      await expect(unresolved).toHaveText("Missing experiment");
      await expect(unresolved).toHaveCSS("text-decoration-style", "dashed");
      await expect(unresolved).toHaveAttribute(
        "title",
        "Unresolved note: Missing experiment",
      );

      const before = await link.boundingBox();
      await link.hover();
      await expect
        .poll(async () => (await styleOf(link)).background)
        .not.toBe(writeStyle.background);
      expect(await link.boundingBox()).toEqual(before);
      await link.click({ button: "right" });
      await expect(link).toBeVisible();
      await f.page.keyboard.press("Escape");
      const long = editor.locator("a.wiki-link").filter({ hasText: longLabel });
      expect(
        await long.evaluate((el) => el.getClientRects().length),
      ).toBeGreaterThan(1);
      const scroll = f.page.locator(".ws-document-main .ws-document-scroll");
      expect(
        await scroll.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      await f.page.screenshot({
        path: info.outputPath(`note-links-${mode}-write.png`),
      });

      // Styling and decoration cannot contaminate continued typing or the source.
      await caret(
        editor.locator("p").filter({ hasText: "An ordinary paragraph" }),
      );
      await f.page.keyboard.insertText(" Still editable.");
      const changed = body.replace(
        "An ordinary paragraph for continued writing.",
        "An ordinary paragraph for continued writing. Still editable.",
      );
      await expect.poll(f.source).toBe(changed);
      await f.page.getByRole("button", { name: "Read", exact: true }).click();
      const reading = f.page.locator(".read-mount:not(.print-only)");
      const readLink = reading
        .locator("a.wiki-link")
        .filter({ hasText: "Derivation notebook" });
      await expect(readLink).toBeVisible();
      const readStyle = await styleOf(readLink);
      expect(readStyle.color).toBe(writeStyle.color);
      expect(readStyle.background).toBe(writeStyle.background);
      expect(readStyle.radius).toBe(writeStyle.radius);
      await f.page.keyboard.press("Tab");
      await readLink.focus();
      await expect(readLink).toHaveCSS("outline-style", "solid");
      await expect(readLink).toHaveCSS("outline-width", "2px");
      await f.page.screenshot({
        path: info.outputPath(`note-links-${mode}-read.png`),
      });
      await f.page.keyboard.press("Enter");
      await expect(f.page).toHaveURL(new RegExp(`/workbench/notes/${note.id}`));
      expect(await f.source()).toBe(changed);

      await expect(f.page.locator(".ws-document-main")).toContainText(
        "Reference destination.",
      );
      await f.page
        .getByRole("button", { name: "Go back", exact: true })
        .click();
      await expect(f.page).toHaveURL(
        new RegExp(`/workbench/notes/${f.note.id}`),
      );
      await f.page.getByRole("button", { name: "Write", exact: true }).click();
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", `/workbench/notes/${note.id}`);
      await link.click({ modifiers: ["Meta"] });
      await expect(f.page).toHaveURL(new RegExp(`/workbench/notes/${note.id}`));
      expect(await f.source()).toBe(changed);
    } finally {
      await f.close();
    }
  });

test("note icons stay centered on the first text line across document typography", async ({
  browser,
}, info) => {
  const source = `An [[Field notes|Derivation notebook]] in a sentence.\n\n[[Field notes|${longLabel}]]`;
  const f = await fixture(browser, source);
  try {
    for (const mode of ["Write", "Read"] as const) {
      await f.page.getByRole("button", { name: mode, exact: true }).click();
      const surface = f.page.locator(
        mode === "Write"
          ? '[data-testid="note-editor"].axiom-prose'
          : ".read-mount:not(.print-only) .prose",
      );
      await expect(surface).toBeVisible();
      await expect(surface.locator("a.wiki-link")).toHaveCount(2);
      for (const family of [
        '"Source Sans 3", sans-serif',
        '"Source Serif 4", serif',
        '"Axiom Latin Modern", serif',
      ]) {
        for (const [size, line] of [
          [14, 1.3],
          [18, 1.75],
          [30, 2.4],
        ]) {
          await surface.evaluate(
            async (el, { family, size, line }) => {
              const style = (el as HTMLElement).style;
              style.setProperty("--font-prose", family);
              style.setProperty("--size-prose", `${size}px`);
              style.setProperty("--reading-line", String(line));
              await document.fonts.load(`500 ${size}px ${family}`);
            },
            { family, size, line },
          );
          await expect(surface).toHaveCSS("font-size", `${size}px`);
          for (const link of await surface.locator("a.wiki-link").all()) {
            const geometry = await iconAlignment(link);
            expect(
              Math.abs(geometry.centerOffset),
              `${mode}: ${family}, ${size}px`,
            ).toBeLessThanOrEqual(0.5);
            expect(geometry.width).toBeGreaterThan(0);
            expect(geometry.gap).toBeGreaterThan(0);
            expect(geometry.gap).toBeLessThan(size * 0.3);
          }
        }
      }
      await f.page.screenshot({
        path: info.outputPath(`note-link-alignment-${mode.toLowerCase()}.png`),
      });
    }
    expect(await f.source()).toBe(source);
  } finally {
    await f.close();
  }
});

test("note links retain accessibility cues in forced colors, reduced motion and print", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "An [[Unresolved note|inline note]] for reading.",
  );
  try {
    await f.page.getByRole("button", { name: "Read", exact: true }).click();
    const link = f.page.locator(".read-mount:not(.print-only) .wiki-link");
    await f.page.emulateMedia({ reducedMotion: "reduce" });
    await expect(link).toHaveCSS("transition-duration", "0s");
    await f.page.emulateMedia({ forcedColors: "active" });
    await f.page.keyboard.press("Tab");
    await link.focus();
    await expect(link).toHaveCSS("text-decoration-style", "dashed");
    await expect(link).toHaveCSS("outline-style", "solid");
    expect((await styleOf(link)).icon).not.toBe("none");
    await f.page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    await f.page.emulateMedia({ media: "print", forcedColors: "none" });
    const printed = f.page.locator(".read-mount .wiki-link");
    await expect(printed).toBeVisible();
    await expect(printed).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(
      await printed.evaluate((el) => getComputedStyle(el, "::before").display),
    ).toBe("none");
    expect(await f.source()).toBe(
      "An [[Unresolved note|inline note]] for reading.",
    );
  } finally {
    await f.close();
  }
});
