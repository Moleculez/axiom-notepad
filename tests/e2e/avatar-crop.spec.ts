import { test, expect, type Locator } from "@playwright/test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
const sharp = createRequire(import.meta.url)(
  "sharp",
) as typeof import("sharp").default;
test.use({ actionTimeout: 15000 });
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Avatar tests require isolated staging on port 3004.");
});
async function picture(orientation?: number) {
  const source = Buffer.alloc(480 * 240 * 3);
  for (let y = 0; y < 240; y++)
    for (let x = 0; x < 480; x++) {
      const at = (y * 480 + x) * 3;
      source[at] = x < 240 ? 210 : 30;
      source[at + 1] = 70;
      source[at + 2] = x < 240 ? 45 : 210;
    }
  const pipeline = sharp(source, {
    raw: { width: 480, height: 240, channels: 3 },
  });
  return orientation
    ? pipeline.withMetadata({ orientation }).jpeg().toBuffer()
    : pipeline
        .withExif({ IFD0: { Make: "Private test camera" } })
        .png()
        .toBuffer();
}
async function fits(dialog: Locator) {
  expect(
    await dialog.evaluate((el) => {
      const preview = el
          .querySelector(".image-geometry-surface")!
          .getBoundingClientRect(),
        fields = el
          .querySelector(".image-geometry-fields")!
          .getBoundingClientRect(),
        box = el.getBoundingClientRect(),
        footer = el.querySelector(".dialog-footer")!.getBoundingClientRect();
      return (
        preview.right <= fields.left &&
        el.scrollWidth <= el.clientWidth &&
        footer.bottom <= box.bottom + 1 &&
        box.bottom <= innerHeight
      );
    }),
  ).toBe(true);
}
test("profile pictures crop locally, cancel safely and save the selected area without losing profile drafts", async ({
  browser,
}, info) => {
  const f = await fixture(browser, "Unchanged avatar research.");
  try {
    const page = f.page,
      content = await picture();
    await page.goto("/workbench/settings/profile");
    const before = await (
      await f.member.request.get("/api/v1/me/profile")
    ).json();
    await page
      .getByLabel("Full name", { exact: true })
      .fill("Researcher with a new photo");
    const input = page.getByLabel("Upload profile picture", { exact: true });
    let uploads = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v1/me/avatar"
      )
        uploads++;
    });
    await input.setInputFiles({
      name: "profile.png",
      mimeType: "image/png",
      buffer: content,
    });
    const dialog = page.getByRole("dialog", {
      name: "Crop profile picture",
      exact: true,
    });
    await expect(
      dialog.getByLabel("Round profile picture preview"),
    ).toBeVisible();
    await expect(dialog.getByLabel("Width", { exact: true })).toHaveValue(
      "240",
    );
    expect(uploads).toBe(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      (await (await f.member.request.get("/api/v1/me/profile")).json()).image,
    ).toBe(before.image);
    await input.setInputFiles({
      name: "profile.png",
      mimeType: "image/png",
      buffer: content,
    });
    await dialog.getByLabel("Crop left", { exact: true }).fill("240");
    const pixel = await dialog
      .getByLabel("Round profile picture preview")
      .evaluate((canvas: HTMLCanvasElement) =>
        Array.from(canvas.getContext("2d")!.getImageData(64, 64, 1, 1).data),
      );
    expect(pixel).toEqual([30, 70, 210, 255]);
    await fits(dialog);
    await page.screenshot({
      path: info.outputPath("profile-crop-preview.png"),
    });
    await dialog
      .getByRole("button", { name: "Save photo", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    expect(uploads).toBe(1);
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
      "Researcher with a new photo",
    );
    const after = await (
      await f.member.request.get("/api/v1/me/profile")
    ).json();
    expect(after.name).toBe(before.name);
    const response = await f.member.request.get(after.image),
      bytes = await response.body(),
      metadata = await sharp(bytes).metadata();
    expect([metadata.width, metadata.height]).toEqual([256, 256]);
    expect(metadata.exif).toBeUndefined();
    const color = await sharp(bytes)
      .extract({ left: 128, top: 128, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(color[2]).toBeGreaterThan(190);
    expect(color[0]).toBeLessThan(50);
    await expect(page.locator(".ws-profile-photo img")).toHaveAttribute(
      "src",
      after.image,
    );
    await expect(page.locator(".ws-account-avatar img")).toHaveAttribute(
      "src",
      after.image,
    );
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(
      page.getByText("Profile saved.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator(".ws-profile-photo img")).toHaveAttribute(
      "src",
      after.image,
    );
    expect(
      (await (await f.member.request.get("/api/v1/me/profile")).json()).name,
    ).toBe("Researcher with a new photo");
    expect(await f.source()).toBe("Unchanged avatar research.");
  } finally {
    await f.close();
  }
});
test("photo crop honors EXIF orientation and retains the selection after an upload failure", async ({
  browser,
}) => {
  const f = await fixture(browser, "Unchanged photo orientation.");
  try {
    const page = f.page;
    await page.goto("/workbench/settings/profile");
    await page
      .getByLabel("Upload profile picture", { exact: true })
      .setInputFiles({
        name: "portrait.jpg",
        mimeType: "image/jpeg",
        buffer: await picture(6),
      });
    const dialog = page.getByRole("dialog", {
      name: "Crop profile picture",
      exact: true,
    });
    await expect(dialog.getByLabel("Crop preview")).toHaveJSProperty(
      "width",
      240,
    );
    await expect(dialog.getByLabel("Crop preview")).toHaveJSProperty(
      "height",
      480,
    );
    await dialog.getByLabel("Crop top", { exact: true }).fill("240");
    await page.route("**/api/v1/me/avatar", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Upload interrupted. Please retry." }),
      }),
    );
    await dialog
      .getByRole("button", { name: "Save photo", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("Upload interrupted");
    await expect(dialog.getByLabel("Crop top", { exact: true })).toHaveValue(
      "240",
    );
    await page.unroute("**/api/v1/me/avatar");
    await dialog
      .getByRole("button", { name: "Save photo", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    const profile = await (
      await f.member.request.get("/api/v1/me/profile")
    ).json();
    const color = await sharp(
      await (await f.member.request.get(profile.image)).body(),
    )
      .extract({ left: 128, top: 128, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(color[2]).toBeGreaterThan(190);
    expect(color[0]).toBeLessThan(50);
  } finally {
    await f.close();
  }
});
test("invalid photos and stale profile versions cannot replace the current avatar", async ({
  browser,
}) => {
  const f = await fixture(browser, "Unchanged avatar concurrency.");
  try {
    const page = f.page;
    await page.goto("/workbench/settings/profile");
    const input = page.getByLabel("Upload profile picture", { exact: true });
    await input.setInputFiles({
      name: "invalid.png",
      mimeType: "image/png",
      buffer: Buffer.from("not an image"),
    });
    const dialog = page.getByRole("dialog", {
      name: "Crop profile picture",
      exact: true,
    });
    await expect(dialog.getByRole("alert")).toBeVisible();
    await page.keyboard.press("Escape");
    await input.setInputFiles({
      name: "too-large.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
    });
    await expect(dialog.getByRole("alert")).toContainText("5 MB");
    await page.keyboard.press("Escape");
    await input.setInputFiles({
      name: "valid.png",
      mimeType: "image/png",
      buffer: await picture(),
    });
    await expect(
      dialog.getByLabel("Round profile picture preview"),
    ).toBeVisible();
    const before = await (
      await f.member.request.get("/api/v1/me/profile")
    ).json();
    const response = await f.member.request.patch("/api/v1/me/profile", {
      headers: { origin },
      data: {
        ...before,
        name: "Changed on another device",
        mutationId: randomUUID(),
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    await dialog
      .getByRole("button", { name: "Save photo", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(/changed|refresh/i);
    const after = await (
      await f.member.request.get("/api/v1/me/profile")
    ).json();
    expect(after.image).toBe(before.image);
    expect(after.name).toBe("Changed on another device");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await f.close();
  }
});
