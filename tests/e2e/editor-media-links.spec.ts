import { test, expect } from "@playwright/test";
import { fixture, origin } from "./native-editor-helpers";

test.beforeAll(() => {
  if (
    origin !== "http://localhost:3002" ||
    process.env.NEXT_PUBLIC_AXIOM_EDITOR_ENGINE !== "milkdown"
  )
    throw new Error(
      "Media/link acceptance requires the isolated candidate on port 3002.",
    );
});

for (const mode of ["Write", "Source"] as const) {
  test(`${mode}: slash images and attachments upload, replace their queries and follow collaborative bookmarks`, async ({
    browser,
  }, testInfo) => {
    const f = await fixture(browser, "Start\n\n");
    try {
      await expect(
        f.page.locator('.axiom-editor[data-engine="milkdown"]'),
      ).toBeVisible();
      await f.page.getByRole("button", { name: mode, exact: true }).click();
      await f.page.getByTestId("note-editor").press("ControlOrMeta+End");
      await f.page.keyboard.type("/image");
      await f.page.getByRole("option", { name: "Image or attachment" }).click();
      const dialog = f.page.getByRole("dialog", {
        name: "Insert a file from Explorer",
      });
      await expect(dialog).toBeVisible();
      await f.page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect.poll(f.source).toBe("Start\n\n/image");
      // Cancellation must preserve the actual caret, without repairing it.
      await expect(f.page.getByTestId("note-editor")).toBeFocused();
      await f.page.keyboard.type("x");
      await expect.poll(f.source).toBe("Start\n\n/imagex");
      await f.page.keyboard.press("Backspace");
      await f.page.getByRole("option", { name: "Image or attachment" }).click();
      await expect(dialog).toBeVisible();
      const uploadInput = dialog.locator('input[type="file"]');
      await uploadInput.setInputFiles([
        {
          name: "research-figure.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAIAAAAzn+mLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAQUlEQVRIie2WQQkAQAzDpjNeqqoGT8WxPQITUEJTNqSnbtYTYKBKKHYILev6/OAwVkKxQ2hZ10cIH7RKKHaIz5Y9G0TtWz8OKy8AAAAASUVORK5CYII=",
            "base64",
          ),
        },
        {
          name: "measurements.csv",
          mimeType: "text/csv",
          buffer: Buffer.from("time,energy\n0,1\n1,2\n"),
        },
      ]);
      const figure = dialog.getByRole("button", {
        name: /research-figure\.png/,
      });
      await expect(figure).toBeVisible({ timeout: 20000 });
      await expect(
        dialog.getByRole("button", { name: /measurements\.csv/ }),
      ).toBeVisible();
      await f.page.screenshot({
        path: testInfo.outputPath("slash-file-picker.png"),
      });

      const peer = await f.owner.newPage();
      peer.on("pageerror", (e) => f.errors.push(e.message));
      await peer.goto("/workbench/notes/" + f.note.id);
      await expect(peer.locator(".ws-document-status")).toContainText(
        "Saved on server",
      );
      await peer.getByRole("button", { name: "Source", exact: true }).click();
      await expect(peer.getByTestId("note-editor")).toHaveClass(/cm-content/);
      await peer.getByTestId("note-editor").press("ControlOrMeta+Home");
      await peer.keyboard.insertText("Peer preface\n\n");
      await expect(f.page.getByTestId("note-editor")).toContainText(
        "Peer preface",
      );
      await figure.click();
      await expect(dialog).toHaveCount(0);
      await expect
        .poll(f.source)
        .toMatch(
          /^Peer preface\n\nStart\n\n!\[research-figure\.png\]\(\/api\/v1\/attachments\/[\da-f-]{36}\)$/,
        );
      const withImage = await f.source();
      await expect(peer.getByTestId("note-editor")).toContainText(
        "![research-figure.png]",
      );
      // Undo restores the query, never the collaborator's preface.
      await f.page.getByTestId("note-editor").press("ControlOrMeta+z");
      await expect.poll(f.source).toBe("Peer preface\n\nStart\n\n/image");
      await f.page.keyboard.press("ControlOrMeta+Shift+z");
      await expect.poll(f.source).toBe(withImage);

      await f.page.getByTestId("note-editor").press("ControlOrMeta+End");
      await f.page.keyboard.press("Enter");
      await f.page.keyboard.press("Enter");
      await f.page.keyboard.type("/attachment");
      await f.page.getByRole("option", { name: "Image or attachment" }).click();
      await dialog.getByRole("button", { name: /measurements\.csv/ }).click();
      await expect
        .poll(f.source)
        .toContain("\n\n[measurements.csv](/api/v1/attachments/");
      const saved = await f.source();
      expect(saved).not.toContain("/image");
      expect(saved).not.toContain("\n/attachment");
      await expect(peer.getByTestId("note-editor")).toContainText(
        "[measurements.csv]",
      );
      await f.page.reload();
      await f.page.getByRole("button", { name: "Write", exact: true }).click();
      const image = f.page
        .getByTestId("note-editor")
        .getByRole("img", { name: "research-figure.png" });
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
        )
        .toBe(true);
      expect(await f.source()).toBe(saved);
      await f.page.screenshot({
        path: testInfo.outputPath("inserted-image-and-attachment.png"),
      });
      if (mode === "Write") {
        await f.page
          .getByRole("button", { name: "Source", exact: true })
          .click();
        await f.page.getByTestId("note-editor").press("ControlOrMeta+End");
        await f.page.keyboard.press("Enter");
        await f.page.keyboard.press("Enter");
        await f.page.keyboard.type("/image");
        await f.page
          .getByRole("option", { name: "Image or attachment" })
          .click();
        await expect(peer.getByTestId("note-editor")).toContainText("/image");
        await peer.getByTestId("note-editor").press("ControlOrMeta+End");
        for (let i = 0; i < 6; i++)
          await peer.keyboard.press("Shift+ArrowLeft");
        await peer.keyboard.insertText("Peer replacement");
        await expect(f.page.getByTestId("note-editor")).toContainText(
          "Peer replacement",
        );
        await dialog
          .getByRole("button", { name: /research-figure\.png/ })
          .click();
        await expect(
          f.page.getByText(
            "The insertion location changed. Choose a new location and try again.",
          ),
        ).toBeVisible();
        await expect.poll(f.source).toBe(saved + "\n\nPeer replacement");
        await f.page
          .getByRole("button", { name: "Write", exact: true })
          .click();
      }
      await f.page
        .locator(".axiom-inline-link")
        .filter({ hasText: "measurements.csv" })
        .click({ modifiers: ["Meta"] });
      await expect(f.page.locator(".ws-file-pane h1")).toHaveText(
        "measurements.csv",
      );
      await expect(f.page.locator(".ws-file-source")).toContainText(
        "time,energy",
      );
      await peer.close();
    } finally {
      await f.close();
    }
  });
}

test("Command/Control-click opens external hyperlinks once; local headings and note content stay in the editor", async ({
  browser,
}, testInfo) => {
  const body =
    "Caret here\n\n[Research paper](https://example.org/paper#results)\n\n[Reference][paper]\n\n[Local results](#results)\n\n## Results\n\nStable observations.\n\n[paper]: https://example.org/reference\n";
  const f = await fixture(browser, body);
  try {
    await f.member.route("https://example.org/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>Research paper fixture</title><p>Local test response only.</p>",
      }),
    );
    const opened: string[] = [];
    for (const [label, modifier, url] of [
      ["Research paper", "Meta", "https://example.org/paper#results"],
      ["Reference", "Control", "https://example.org/reference"],
    ] as const) {
      const popup = f.member.waitForEvent("page");
      await f.page
        .locator(".axiom-inline-link")
        .filter({ hasText: label })
        .click({ modifiers: [modifier] });
      const tab = await popup;
      await expect(tab).toHaveURL(url);
      expect(await tab.evaluate(() => window.opener === null)).toBe(true);
      opened.push(tab.url());
      await tab.close();
      await expect(f.page).toHaveURL(
        new RegExp("/workbench/notes/" + f.note.id),
      );
      expect(await f.source()).toBe(body);
    }
    expect(opened).toHaveLength(2);
    expect(f.member.pages()).toHaveLength(1);
    await f.page
      .locator(".axiom-inline-link")
      .filter({ hasText: "Local results" })
      .click({ modifiers: ["Meta"] });
    await expect(
      f.page.locator('.axiom-source-prose[data-source-kind="heading"]'),
    ).toContainText("## Results");
    expect(await f.source()).toBe(body);
    await f.page.screenshot({
      path: testInfo.outputPath("link-navigation-preserves-note.png"),
    });
  } finally {
    await f.close();
  }
});
