import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
  type Locator,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fixture, origin } from "./native-editor-helpers";
const sharp = createRequire(import.meta.url)(
  "sharp",
) as typeof import("sharp").default;
test.use({ actionTimeout: 15000 });
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Image geometry acceptance uses isolated staging on 3004.");
});
async function api(request: APIRequestContext, path: string, data?: unknown) {
  const response = await request.fetch(`/api/v1/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { origin },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function ready(browser: Browser, dark = false) {
  const f = await fixture(browser, "# Crop and resize\n\nUnchanged research.");
  try {
    const spaceId = (await api(f.member.request, `resources/${f.note.id}`))
      .space_id;
    const pixels = Buffer.alloc(320 * 200 * 4);
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 320; x++) {
        const i = (y * 320 + x) * 4;
        pixels[i] = x % 256;
        pixels[i + 1] = y;
        pixels[i + 2] = 180;
        pixels[i + 3] = 255;
      }
    const content = await sharp(pixels, {
        raw: { width: 320, height: 200, channels: 4 },
      })
        .png()
        .toBuffer(),
      uploadId = randomUUID();
    await api(f.member.request, "uploads", {
      id: uploadId,
      spaceId,
      name: "Research gradient.png",
      bytes: content.length,
    });
    const chunk = await f.member.request.put(
      `/api/v1/uploads/${uploadId}/chunks/1`,
      {
        headers: { origin, "content-type": "application/octet-stream" },
        data: content,
      },
    );
    expect(chunk.ok()).toBe(true);
    await api(f.member.request, `uploads/${uploadId}/complete`, {});
    await expect
      .poll(
        async () => (await api(f.member.request, `uploads/${uploadId}`)).status,
      )
      .toBe("complete");
    const file = await api(
      f.member.request,
      `resources/${(await api(f.member.request, `uploads/${uploadId}`)).resourceId}`,
    );
    const project = await api(f.member.request, "files/new", {
      type: "image",
      spaceId,
      name: "Research figure",
      mutationId: randomUUID(),
    });
    if (dark) {
      const bundle = await api(f.member.request, "me/preferences-bundle");
      const response = await f.member.request.patch(
        "/api/v1/me/preferences-bundle",
        {
          headers: { origin },
          data: {
            appearance: {
              version: bundle.appearance.version,
              preferences: { ...bundle.appearance.preferences, mode: "dark" },
            },
            editor: bundle.editor,
            mutationId: randomUUID(),
          },
        },
      );
      expect(response.ok(), await response.text()).toBe(true);
    }
    await f.page.goto(
      `/workbench/image/${project.id}?file=${file.id}&version=${file.current_version_id}`,
    );
    await expect(
      f.page.getByRole("button", { name: "Save version", exact: true }),
    ).toBeEnabled();
    await save(f.page);
    return { ...f, project, file, content };
  } catch (e) {
    await f.close();
    throw e;
  }
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Save version", exact: true }).click();
  await expect(page.locator(".studio-status")).toContainText(
    "Saved as a new cloud version",
  );
}
async function pixels(page: Page) {
  return page
    .getByLabel("Image canvas", { exact: true })
    .evaluate((canvas: HTMLCanvasElement) => ({
      width: canvas.width,
      height: canvas.height,
      color: Array.from(
        canvas.getContext("2d")!.getImageData(10, 10, 1, 1).data,
      ),
    }));
}
async function cropFields(dialog: Locator) {
  await dialog
    .getByLabel("Crop aspect ratio", { exact: true })
    .selectOption("free");
  await dialog.getByLabel("Width", { exact: true }).fill("100");
  await dialog.getByLabel("Height", { exact: true }).fill("80");
  await dialog.getByLabel("Crop left", { exact: true }).fill("50");
  await dialog.getByLabel("Crop top", { exact: true }).fill("40");
}
async function geometry(dialog: Locator) {
  const result = await dialog.evaluate((el) => {
    const preview = el
        .querySelector(".image-geometry-stage")!
        .getBoundingClientRect(),
      fields = el
        .querySelector(".image-geometry-fields")!
        .getBoundingClientRect(),
      footer = el.querySelector(".dialog-footer")!.getBoundingClientRect(),
      surface = el
        .querySelector(".image-geometry-surface")!
        .getBoundingClientRect(),
      box = el.getBoundingClientRect();
    return {
      split: preview.right <= fields.left,
      previewFits:
        surface.left >= preview.left &&
        surface.right <= preview.right &&
        surface.right <= fields.left,
      footer: footer.bottom <= box.bottom + 1,
      bounded: el.scrollWidth <= el.clientWidth + 1,
      visible: box.bottom <= innerHeight && box.top >= 0,
    };
  });
  expect(result).toEqual({
    split: true,
    previewFits: true,
    footer: true,
    bounded: true,
    visible: true,
  });
}
test("crop preview supports ratio presets, pointer handles, cancellation and saved undo/redo", async ({
  browser,
}, info) => {
  const f = await ready(browser);
  try {
    const page = f.page,
      dialog = page.getByRole("dialog", { name: "Crop image", exact: true });
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    await dialog
      .getByLabel("Crop aspect ratio", { exact: true })
      .selectOption("square");
    await expect(dialog.getByLabel("Width", { exact: true })).toHaveValue(
      "200",
    );
    const handle = dialog.getByRole("button", {
      name: "Resize crop from bottom right",
      exact: true,
    });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 30, box.y - 30, { steps: 8 });
    await page.mouse.up();
    const width = Number(
      await dialog.getByLabel("Width", { exact: true }).inputValue(),
    );
    expect(width).toBeLessThan(200);
    expect(
      Number(await dialog.getByLabel("Height", { exact: true }).inputValue()),
    ).toBe(width);
    const left = Number(
      await dialog.getByLabel("Crop left", { exact: true }).inputValue(),
    );
    await dialog
      .getByRole("button", { name: "Move crop selection", exact: true })
      .press("ArrowRight");
    await expect(dialog.getByLabel("Crop left", { exact: true })).toHaveValue(
      String(left + 1),
    );
    await cropFields(dialog);
    await geometry(dialog);
    await page.screenshot({ path: info.outputPath("crop-preview.png") });
    await expect
      .poll(() => pixels(page))
      .toEqual({ width: 320, height: 200, color: [10, 10, 180, 255] });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save version", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    await cropFields(dialog);
    await dialog
      .getByRole("button", { name: "Apply crop", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => pixels(page))
      .toEqual({ width: 100, height: 80, color: [60, 50, 180, 255] });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(() => pixels(page))
      .toEqual({ width: 320, height: 200, color: [10, 10, 180, 255] });
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await save(page);
    await page.reload();
    await expect
      .poll(() => pixels(page))
      .toEqual({ width: 100, height: 80, color: [60, 50, 180, 255] });
    expect(
      await api(f.member.request, `files/${f.file.id}/versions`),
    ).toHaveLength(1);
    expect(
      (
        await (
          await f.member.request.get(`/api/v1/files/${f.file.id}/content`)
        ).body()
      ).equals(f.content),
    ).toBe(true);
    expect(await f.source()).toBe("# Crop and resize\n\nUnchanged research.");
  } finally {
    await f.close();
  }
});
test("resize offers proportions, presets, bounds, resampling and current dimensions on reopening", async ({
  browser,
}, info) => {
  const f = await ready(browser, true);
  try {
    const page = f.page,
      dialog = page.getByRole("dialog", { name: "Resize image", exact: true });
    await page.getByRole("button", { name: "Resize", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Keep proportions" }),
    ).toHaveAttribute("aria-pressed", "true");
    await dialog.getByLabel("Width", { exact: true }).fill("160");
    await expect(dialog.getByLabel("Height", { exact: true })).toHaveValue(
      "100",
    );
    await dialog.getByRole("button", { name: "200%", exact: true }).click();
    await expect(dialog.getByLabel("Width", { exact: true })).toHaveValue(
      "640",
    );
    await dialog.getByRole("button", { name: "Keep proportions" }).click();
    await dialog.getByLabel("Width", { exact: true }).fill("123");
    await dialog.getByLabel("Height", { exact: true }).fill("67");
    await expect(dialog.getByLabel("Width", { exact: true })).toHaveValue(
      "123",
    );
    await dialog.getByLabel("Width", { exact: true }).fill("0");
    await expect(
      dialog.getByRole("button", { name: "Resize image", exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByRole("alert")).toContainText("whole-pixel");
    await dialog.getByLabel("Width", { exact: true }).fill("8193");
    await expect(
      dialog.getByRole("button", { name: "Resize image", exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "50%", exact: true }).click();
    await dialog
      .getByLabel("Resampling", { exact: true })
      .selectOption("pixelated");
    await geometry(dialog);
    await page.screenshot({ path: info.outputPath("resize-dark.png") });
    const expected = await page
      .getByLabel("Image canvas", { exact: true })
      .evaluate((image: HTMLCanvasElement) => {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 100;
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        ctx.scale(0.5, 0.5);
        ctx.drawImage(image, 0, 0);
        return {
          width: 160,
          height: 100,
          color: Array.from(ctx.getImageData(10, 10, 1, 1).data),
        };
      });
    await dialog
      .getByLabel("Width", { exact: true })
      .press("ControlOrMeta+Enter");
    await expect(dialog).toBeHidden();
    await expect.poll(() => pixels(page)).toEqual(expected);
    await page.getByRole("button", { name: "Resize", exact: true }).click();
    await expect(dialog.getByLabel("Width", { exact: true })).toHaveValue(
      "160",
    );
    await expect(dialog.getByLabel("Height", { exact: true })).toHaveValue(
      "100",
    );
    await page.keyboard.press("Escape");
    await save(page);
    await page.reload();
    await expect.poll(() => pixels(page)).toEqual(expected);
  } finally {
    await f.close();
  }
});
test("crop is available from selection, keyboard and the image context menu", async ({
  browser,
}) => {
  const f = await ready(browser);
  try {
    const page = f.page,
      dialog = page.getByRole("dialog", { name: "Crop image", exact: true });
    await page
      .getByRole("button", { name: "Rectangular selection (M)", exact: true })
      .click();
    const box = (await page.locator(".image-overlay").boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 80, { steps: 8 });
    await page.mouse.up();
    await page
      .getByRole("button", { name: "Crop to selection", exact: true })
      .click();
    expect(
      Number(await dialog.getByLabel("Width", { exact: true }).inputValue()),
    ).toBeLessThan(320);
    await page.keyboard.press("Escape");
    await page.keyboard.press("c");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator(".image-overlay").click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Image actions", exact: true });
    await expect(menu.locator("[data-icon='crop']")).toBeVisible();
    await menu.getByRole("menuitem", { name: /^Resize image/ }).click();
    const resize = page.getByRole("dialog", {
      name: "Resize image",
      exact: true,
    });
    await expect(resize).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+Alt+i");
    await expect(resize).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Save version", exact: true }),
    ).toBeDisabled();
  } finally {
    await f.close();
  }
});
