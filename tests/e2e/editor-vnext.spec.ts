import { test, expect, type Page, type Locator } from "@playwright/test";
import { fixture, origin, caret } from "./native-editor-helpers";

test.beforeAll(() => {
  if (
    !["http://localhost:3002", "http://localhost:3004"].includes(origin) ||
    process.env.NEXT_PUBLIC_AXIOM_EDITOR_ENGINE !== "milkdown"
  )
    throw new Error(
      "Editor vNext acceptance requires the isolated current-engine candidate on port 3002 or 3004.",
    );
});

test("active headings keep rendered typography and editable hashes across peer edits and reload", async ({
  browser,
}, testInfo) => {
  const f = await fixture(browser, "# Heading\n\nBody");
  try {
    await candidate(f.page);
    const heading = f.page.getByTestId("note-editor").locator("h1");
    await expect(heading).toHaveText("Heading");
    const typography = (element: Element) => {
      const style = getComputedStyle(element);
      return [
        style.fontSize,
        style.fontFamily,
        style.fontWeight,
        style.lineHeight,
      ];
    };
    const resting = await heading.evaluate(typography);
    await caret(heading);
    await expect(heading).toHaveText("# Heading");
    await expect(heading).toHaveClass(/axiom-source-prose/);
    expect(await heading.evaluate(typography)).toEqual(resting);
    await f.page.keyboard.insertText(" revised");
    await expect.poll(f.source).toBe("# Heading revised\n\nBody");
    await f.page.screenshot({
      path: testInfo.outputPath("active-heading-with-hash.png"),
    });

    const peer = await f.owner.newPage();
    peer.on("pageerror", (error) => f.errors.push(error.message));
    await peer.goto("/workbench/notes/" + f.note.id);
    await expect(peer.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await peer.getByRole("button", { name: "Source", exact: true }).click();
    await expect(peer.getByTestId("note-editor")).toHaveClass(/cm-content/);
    await peer.getByTestId("note-editor").press("ControlOrMeta+Home");
    await peer.keyboard.insertText("##");
    const revised = f.page
      .getByTestId("note-editor")
      .locator("h3.axiom-source-prose");
    await expect(revised).toBeVisible();
    await expect
      .poll(() =>
        revised.evaluate((element) => {
          // Presence labels are view widgets, not editable heading text.
          const copy = element.cloneNode(true) as Element;
          copy.querySelectorAll(".axiom-peer-caret").forEach((n) => n.remove());
          return copy.textContent;
        }),
      )
      .toBe("### Heading revised");
    // The local caret follows the peer's heading-level change without repair.
    await f.page.keyboard.insertText("!");
    await expect.poll(f.source).toBe("### Heading revised!\n\nBody");
    await f.page.keyboard.press("ControlOrMeta+z");
    await expect.poll(f.source).toBe("### Heading revised\n\nBody");
    await f.page.reload();
    await candidate(f.page);
    await expect(f.page.getByTestId("note-editor").locator("h3")).toContainText(
      "Heading revised",
    );
    await f.page.getByRole("button", { name: "Read", exact: true }).click();
    await expect(f.page.locator(".read-mount:not(.print-only) h3")).toHaveText(
      "Heading revised",
    );
    expect(await f.source()).toBe("### Heading revised\n\nBody");
    await peer.close();
  } finally {
    await f.close();
  }
});

async function candidate(page: Page) {
  await expect(
    page.locator('.axiom-editor[data-engine="milkdown"]'),
  ).toBeVisible();
}
async function selectText(locator: Locator, value: string) {
  await locator.evaluate((element, value) => {
    (element.closest(".ProseMirror") as HTMLElement).focus();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const from = text.textContent!.indexOf(value);
      if (from < 0) continue;
      const range = document.createRange();
      range.setStart(text, from);
      range.setEnd(text, from + value.length);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }
    throw new Error("Selection text not found: " + value);
  }, value);
}

test("the persisted note round-trips exactly and rich/source peers converge after offline editing", async ({
  browser,
}) => {
  const original =
    "# Research ###\r\n\r\n* alternate __bold__ &amp; \\*escape\\*\r\n\r\nShared observations.\r\n";
  const f = await fixture(browser, original);
  try {
    await candidate(f.page);
    for (const mode of ["Source", "Write", "Read", "Write"])
      await f.page.getByRole("button", { name: mode, exact: true }).click();
    expect(await f.source()).toBe(original);
    const peer = await f.owner.newPage();
    peer.on("pageerror", (e) => f.errors.push(e.message));
    await peer.goto("/workbench/notes/" + f.note.id);
    await candidate(peer);
    await expect(peer.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await peer.getByRole("button", { name: "Source", exact: true }).click();
    await caret(
      f.page
        .locator(".axiom-prose > p")
        .filter({ hasText: "Shared observations." }),
    );
    await f.page.keyboard.insertText(" VISUAL-RESULT");
    await expect(peer.getByTestId("note-editor")).toContainText(
      "VISUAL-RESULT",
    );
    await peer.getByTestId("note-editor").click();
    await peer.keyboard.press("ControlOrMeta+Home");
    await peer.keyboard.insertText("Peer result.\n\n");
    await expect(f.page.getByTestId("note-editor")).toContainText(
      "Peer result.",
    );
    await f.member.setOffline(true);
    await f.page.getByTestId("note-editor").press("ControlOrMeta+End");
    await f.page.keyboard.insertText(" OFFLINE-RESULT");
    await peer.getByTestId("note-editor").press("ControlOrMeta+End");
    await peer.keyboard.insertText(" ONLINE-RESULT");
    await f.member.setOffline(false);
    for (const page of [f.page, peer]) {
      await expect(page.getByTestId("note-editor")).toContainText(
        "OFFLINE-RESULT",
      );
      await expect(page.getByTestId("note-editor")).toContainText(
        "ONLINE-RESULT",
      );
      await expect(page.locator(".ws-document-status")).toContainText(
        "Saved on server",
      );
    }
    const saved = await f.source();
    expect(saved).toContain("* alternate __bold__ &amp; \\*escape\\*\r\n");
    await f.page.reload();
    await candidate(f.page);
    await expect(f.page.getByTestId("note-editor")).toContainText(
      "OFFLINE-RESULT",
    );
    expect(await f.source()).toBe(saved);
    await peer.close();
  } finally {
    await f.close();
  }
});

test("math renders, block controls are contextual, tables remain editable, and the footer stays outside scrolling", async ({
  browser,
}) => {
  const body =
    "# Field notebook\n\n## Experiment\n\nA **reproducible** observation with $E=mc^2$.\n\n```python\ndef energy(m, c):\n    return m * c**2\n```\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n| Quantity | Value |\n| :--- | ---: |\n| Mass | 1 |\n\n### Observations\n\n" +
    "Measurements retain their source data.\n\n".repeat(24);
  const f = await fixture(browser, body);
  try {
    await candidate(f.page);
    await expect(
      f.page.locator(
        '.axiom-embedded[data-kind="mathBlock"] .axiom-block-preview svg',
      ),
    ).toBeVisible();
    const block = f.page.locator('.axiom-embedded[data-kind="codeBlock"]');
    await block.hover();
    await expect(
      block.getByRole("button", { name: "Block actions" }),
    ).toBeVisible();
    await block.getByRole("button", { name: "Change code language" }).click();
    await block
      .getByRole("combobox", { name: "Code language" })
      .fill("javascript");
    await block.getByRole("combobox", { name: "Code language" }).press("Enter");
    await expect.poll(f.source).toContain("```javascript\n");
    await f.page.locator(".axiom-prose td").first().click({ button: "right" });
    await f.page
      .getByRole("button", { name: "Insert row below", exact: true })
      .click();
    await expect(f.page.locator(".axiom-prose tr")).toHaveCount(3);
    await expect(
      f.page.getByRole("dialog", { name: "Table actions" }),
    ).toHaveCount(0);
    const footer = f.page.locator(".ws-note-footer");
    const before = await footer.boundingBox();
    await f.page.locator(".ws-document-scroll").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(footer).toBeVisible();
    const after = await footer.boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(2);
    expect(after!.y + after!.height).toBeLessThanOrEqual(1000);
    await expect
      .poll(f.source)
      .toContain("def energy(m, c):\n    return m * c**2");
    await f.page.locator(".ws-document-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await f.page.screenshot({ path: "data/editor-vnext-workbench.png" });
  } finally {
    await f.close();
  }
});

test("source-anchored discussions stay in visual mode and survive deletion of their original text", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "# Anchored findings\n\nA reproducible finding supports this model.\n\n## Next step\n\nTest independently.\n",
  );
  try {
    await candidate(f.page);
    await selectText(
      f.page.locator(".axiom-prose > p").first(),
      "reproducible finding",
    );
    // The optional formatting toolbar is hidden by default. Discussion remains
    // reachable from the editor shortcut without turning that toolbar on.
    await f.page.keyboard.press("ControlOrMeta+Alt+Shift+m");
    await expect(
      f.page.locator(".ws-comment-compose blockquote"),
    ).toContainText("reproducible finding");
    await f.page
      .getByRole("textbox", { name: "Comment", exact: true })
      .fill("Please verify this result independently.");
    await f.page
      .getByRole("button", { name: "Post comment", exact: true })
      .click();
    await expect(f.page.locator(".ws-note-comment")).toContainText(
      "Please verify this result independently.",
    );
    await expect(f.page.locator(".axiom-discussion-range")).toContainText(
      "reproducible finding",
    );
    await f.page.locator(".ws-comment-anchor").click();
    await expect(f.page.locator(".axiom-editor")).toHaveAttribute(
      "data-mode",
      "write",
    );
    await f.page.keyboard.press("Backspace");
    await expect.poll(f.source).not.toContain("reproducible finding");
    await expect(f.page.locator(".ws-note-comment")).toContainText(
      "Original text unavailable · discussion retained",
    );
    await f.page.reload();
    await candidate(f.page);
    await f.page.getByTestId("note-editor").focus();
    await f.page.keyboard.press("ControlOrMeta+Alt+Shift+m");
    await expect(f.page.locator(".ws-note-comment")).toContainText(
      "Please verify this result independently.",
    );
    await expect(f.page.locator(".ws-note-comment")).toContainText(
      "Original text unavailable · discussion retained",
    );
    const response = await f.member.request.get(
      `/api/v1/notes/${f.note.id}/comments`,
    );
    const comments = await response.json();
    expect(comments[0].anchor.start.length).toBeGreaterThan(0);
    expect(comments[0].anchor.quote).toBe("reproducible finding");
  } finally {
    await f.close();
  }
});

test("quoted equations render, retain discussion anchors across peer edits, and export offline", async ({
  browser,
}) => {
  const body =
    "# Quoted derivations\n\n> [!THEOREM] Energy\n> The invariant is\n> $$\n> E=mc^2\\label{energy}\n> $$\n> Continue derivation.\n>\n> > In a nested frame\n> > $$\n> > p=mv\n> > $$\n\nSee \\eqref{energy}.\n\n## Review\n\nOutside.";
  const f = await fixture(browser, body);
  try {
    await candidate(f.page);
    const math = f.page.locator('.axiom-embedded[data-kind="mathBlock"]');
    await expect(math).toHaveCount(2);
    for (const block of await math.all())
      await expect(
        block.locator('[data-math-state="ready"] svg'),
      ).toBeVisible();
    await expect(
      f.page.locator('.axiom-callout blockquote [data-math-state="ready"] svg'),
    ).toBeVisible();
    await math
      .first()
      .getByRole("button", { name: "Edit display equation", exact: true })
      .click();
    const tex = math.first().locator(".cm-content");
    await expect(tex).toBeFocused();
    await tex.press("Home");
    for (let i = 0; i < 6; i++) await f.page.keyboard.press("Shift+ArrowRight");
    await f.page.keyboard.press("ControlOrMeta+Alt+Shift+m");
    await expect(
      f.page.locator(".ws-comment-compose blockquote"),
    ).toContainText("E=mc^2");
    await f.page
      .getByRole("textbox", { name: "Comment", exact: true })
      .fill("Verify the rest-energy assumption.");
    await f.page
      .getByRole("button", { name: "Post comment", exact: true })
      .click();
    await expect(f.page.locator(".ws-note-comment")).toContainText(
      "Verify the rest-energy assumption.",
    );
    await f.page.locator(".ws-comment-anchor").click();
    await expect(tex).toBeFocused();

    const peer = await f.owner.newPage();
    peer.on("pageerror", (e) => f.errors.push(e.message));
    await peer.goto("/workbench/notes/" + f.note.id);
    await candidate(peer);
    await expect(peer.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await peer.getByRole("button", { name: "Source", exact: true }).click();
    await peer.getByTestId("note-editor").click();
    await peer.keyboard.press("ControlOrMeta+Home");
    await peer.keyboard.insertText("Peer observation.\n\n");
    await expect(f.page.getByTestId("note-editor")).toContainText(
      "Peer observation.",
    );
    // Do not repair the caret after the peer's insertion. It must still select
    // the original TeX body, not a stale source offset or a quote prefix.
    await f.page.keyboard.press("ArrowRight");
    await f.page.keyboard.insertText("+k");
    await expect
      .poll(f.source)
      .toBe("Peer observation.\n\n" + body.replace("E=mc^2", "E=mc^2+k"));
    await expect(peer.getByTestId("note-editor")).toContainText("E=mc^2+k");
    await f.page.keyboard.press("ControlOrMeta+z");
    const saved = "Peer observation.\n\n" + body;
    await expect.poll(f.source).toBe(saved);
    await f.page.keyboard.press("ControlOrMeta+Enter");
    const finished = saved.replace(
      "> Continue derivation.",
      "> \n> Continue derivation.",
    );
    await expect.poll(f.source).toBe(finished);
    await f.page.reload();
    await candidate(f.page);
    await f.page.getByTestId("note-editor").focus();
    await f.page.keyboard.press("ControlOrMeta+Alt+Shift+m");
    await expect(f.page.locator(".ws-note-comment")).toContainText(
      "Verify the rest-energy assumption.",
    );
    await expect(f.page.locator(".ws-note-comment")).not.toContainText(
      "Original text unavailable",
    );
    await f.page.locator(".ws-comment-anchor").click();
    await expect(math.first().locator(".cm-content")).toBeFocused();
    await expect(math.first().locator(".axiom-discussion-range")).toContainText(
      "E=mc^2",
    );
    for (const mode of ["Source", "Read", "Write"])
      await f.page.getByRole("button", { name: mode, exact: true }).click();
    expect(await f.source()).toBe(finished);
    const response = await f.member.request.get(
      `/api/v1/notes/${f.note.id}/export?format=html`,
    );
    expect(response.ok(), await response.text()).toBeTruthy();
    const html = await response.text();
    expect(html).toContain("callout-theorem");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('id="eq-energy"');
    expect(html).toContain("<svg");
    expect(html).toContain("<math");
    expect(html).not.toContain("data-math-request");
    expect(html).not.toMatch(/<script|https:\/\/cdn/);
    await peer.close();
  } finally {
    await f.close();
  }
});
