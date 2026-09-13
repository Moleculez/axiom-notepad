import { test, expect } from "@playwright/test";
import { fixture, origin, caret } from "./native-editor-helpers";

test("typeset equations remain stable while typing and still update through the real math worker", async ({
  browser,
}, info) => {
  if (origin !== "http://localhost:3004")
    throw new Error("Run only against isolated staging on 3004.");
  const f = await fixture(
    browser,
    "Before equation\n\n$$\nx^2 + y^2\\label{energy}\n$$\n\nAfter equation",
  );
  try {
    const editor = f.page.getByTestId("note-editor");
    const block = editor.locator('[data-kind="mathBlock"]');
    const preview = block.locator("[data-math-request]");
    await expect(preview).toHaveAttribute("data-math-state", "ready", {
      timeout: 30000,
    });
    await preview.evaluate((node) => {
      (window as any).__typesetIdentity = node.firstElementChild;
      (window as any).__typesetResets = 0;
      new MutationObserver(() => {
        if (!node.querySelector("mjx-container, svg"))
          (window as any).__typesetResets++;
      }).observe(node, { childList: true, subtree: true });
    });
    await caret(editor.locator("p").filter({ hasText: /^Before equation$/ }));
    await f.page.keyboard.type(" remains steady", { delay: 25 });
    expect(
      await preview.evaluate(
        (node) => node.firstElementChild === (window as any).__typesetIdentity,
      ),
    ).toBeTruthy();
    await block.getByRole("button", { name: "Edit display equation" }).click();
    const input = block.getByRole("textbox", { name: "Equation TeX source" });
    await input.press("ControlOrMeta+Home");
    await f.page.keyboard.type("z+", { delay: 40 });
    await expect(preview).toHaveAttribute("data-math-state", "ready");
    await expect.poll(f.source).toContain("z+x^2 + y^2");
    expect(await f.page.evaluate(() => (window as any).__typesetResets)).toBe(
      0,
    );
    await f.page.screenshot({
      path: info.outputPath("stable-equation-preview.png"),
    });
    await f.page.reload();
    await expect(
      f.page.getByTestId("note-editor").locator('[data-math-state="ready"]'),
    ).toBeVisible();
    expect(await f.source()).toContain("Before equation remains steady");
  } finally {
    await f.close();
  }
});
