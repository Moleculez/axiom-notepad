import { expect, test, type Download } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  appearanceVariables,
  defaults,
} from "../../packages/shared/src/appearance";
import { fixture, origin } from "./native-editor-helpers";

// Keep Sharp's CJS semver graph out of Node 22's mixed ESM loader path.
const sharp: typeof import("sharp").default = createRequire(import.meta.url)(
  "sharp",
);

let f: Awaited<ReturnType<typeof fixture>>, spaceId: string;
const latex = "\\frac{x^2 + y^2}{\\sqrt{1 + z^2}} = \\alpha";
test.beforeAll(async ({ browser }) => {
  test.setTimeout(90000);
  if (origin !== "http://localhost:3002")
    throw new Error(
      "Math preview tests require the isolated 3002 database/storage.",
    );
  f = await fixture(browser, "# Preview export verification\n");
  const spaces = await (await f.member.request.get("/api/v1/spaces")).json();
  spaceId = spaces.find(
    (s: { group_id: string; kind: string }) =>
      s.group_id === f.group.id && s.kind === "team",
  ).id;
});
test.afterAll(async () => {
  await f?.close();
});
async function studio() {
  const response = await f.member.request.post("/api/v1/tools", {
    headers: { origin },
    data: {
      kind: "math",
      name: "Preview export " + randomUUID().slice(0, 6),
      spaceId,
      source: latex,
      mutationId: randomUUID(),
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const project = await response.json(),
    page = f.page;
  await page.goto(`/workbench/tools/math/${project.id}`);
  await expect(page.locator(".studio-status")).toContainText("Saved on server");
  await expect(
    page.getByRole("button", { name: "Copy PNG", exact: true }),
  ).toBeEnabled();
  return { page, project };
}
async function bytes(download: Download) {
  expect(await download.failure()).toBeNull();
  return readFile((await download.path())!);
}

test("preview downloads keep real SVG/PNG/JPG formats, scale, transparency and source", async ({}, info) => {
  const { page, project } = await studio();
  const format = page.getByLabel("Preview image format"),
    resolution = page.getByLabel("Preview export resolution");
  await expect(resolution.locator("..")).toHaveCSS("flex-direction", "row");
  const download = async (label: string) => {
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: `Download ${label}`, exact: true })
      .click();
    return pending;
  };
  await resolution.selectOption("1");
  const small = await sharp(await bytes(await download("PNG"))).metadata();
  expect(small.format).toBe("png");
  expect(small.hasAlpha).toBe(true);
  await resolution.selectOption("3");
  const largeBytes = await bytes(await download("PNG")),
    large = await sharp(largeBytes).metadata();
  expect(large.width).toBe(small.width! * 3);
  expect(large.height).toBe(small.height! * 3);
  const alpha = await sharp(largeBytes).ensureAlpha().raw().toBuffer();
  expect(alpha[3]).toBe(0);
  expect((await sharp(largeBytes).stats()).channels[3].max).toBe(255);
  await format.selectOption("svg");
  await expect(resolution).toBeDisabled();
  const vector = await download("SVG"),
    svg = (await bytes(vector)).toString();
  expect(vector.suggestedFilename()).toMatch(/\.svg$/);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain("<path");
  expect(svg).not.toContain("<image");
  await page
    .getByRole("button", { name: "Transparent image background" })
    .click();
  const opaqueSvg = (await bytes(await download("SVG"))).toString();
  expect(opaqueSvg).toContain("<rect");
  expect(opaqueSvg).toContain('fill="#ffffff"');
  await page.getByRole("button", { name: "More preview actions" }).click();
  await page.getByRole("menuitem", { name: "Rendering settings…" }).click();
  await page.getByLabel("Paper color").fill("#f4eadb");
  await page.getByLabel("Ink color").fill("#274060");
  await page.keyboard.press("Escape");
  const coloredSvg = (await bytes(await download("SVG"))).toString();
  expect(coloredSvg).toContain('fill="#f4eadb"');
  expect(coloredSvg).toContain('color="#274060"');
  await format.selectOption("jpeg");
  await expect(
    page.getByRole("button", { name: "Transparent image background" }),
  ).toBeDisabled();
  const jpg = await download("JPG"),
    jpgBytes = await bytes(jpg),
    metadata = await sharp(jpgBytes).metadata();
  expect(jpg.suggestedFilename()).toMatch(/\.jpg$/);
  expect(metadata.format).toBe("jpeg");
  expect(metadata.hasAlpha).toBe(false);
  expect(metadata.width).toBe(large.width);
  const paperPixel = (await sharp(jpgBytes).raw().toBuffer()).subarray(0, 3);
  for (const [channel, value] of [244, 234, 219].entries())
    expect(Math.abs(paperPixel[channel] - value)).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "More preview actions" }).click();
  const menu = page.getByRole("menu", { name: "Preview actions" });
  await expect(menu.getByRole("separator")).toHaveCount(1);
  await expect(menu.locator("button svg")).toHaveCount(4);
  await page.screenshot({
    path: info.outputPath("math-preview-actions-light.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "More preview actions" }),
  ).toBeFocused();
  await expect(menu).toBeHidden();
  await page.getByRole("button", { name: "More preview actions" }).click();
  await menu.getByRole("menuitem", { name: "All export formats…" }).click();
  await expect(
    page.getByRole("dialog", { name: "Export equation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const dark = appearanceVariables(defaults, true);
  await page.evaluate((variables) => {
    document.documentElement.dataset.theme = "dark";
    for (const [name, value] of Object.entries(variables))
      document.documentElement.style.setProperty(name, value);
  }, dark);
  await expect
    .poll(() =>
      page
        .locator(".math-preview-actions")
        .evaluate((element) => getComputedStyle(element).color),
    )
    .not.toBe("rgb(255, 255, 255)");
  await page.screenshot({
    path: info.outputPath("math-preview-actions-dark.png"),
    animations: "disabled",
  });
  const note = await (
    await f.member.request.get(`/api/v1/notes/${project.id}`)
  ).json();
  expect(note.body).toBe(latex);
});

test("preview copies actual browser images, SVG markup, LaTeX and MathML", async ({
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Native clipboard reads require Chromium's automation permissions; other engines cover downloads and denial handling.",
  );
  await f.member.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin,
  });
  try {
    const { page } = await studio();
    await page.getByRole("button", { name: "Copy PNG", exact: true }).click();
    await expect(page.locator(".ws-notice")).toContainText("PNG copied");
    const png = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read())[0];
      return Array.from(
        new Uint8Array(await (await item.getType("image/png")).arrayBuffer()),
      );
    });
    expect((await sharp(Buffer.from(png)).metadata()).format).toBe("png");
    await page.getByLabel("Preview image format").selectOption("svg");
    await page.getByRole("button", { name: "Copy SVG", exact: true }).click();
    await expect(page.locator(".ws-notice")).toContainText(
      /SVG (markup )?copied/,
    );
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      "<svg",
    );
    await page.getByLabel("Preview image format").selectOption("jpeg");
    await page.getByRole("button", { name: "Copy JPG", exact: true }).click();
    await expect(page.locator(".ws-notice")).toContainText(
      /(JPG copied|Copied as an opaque PNG)/,
    );
    const raster = await page.evaluate(async () => {
      const mime = ClipboardItem.supports("image/jpeg")
        ? "image/jpeg"
        : "image/png";
      const item = (await navigator.clipboard.read())[0];
      return {
        mime,
        bytes: Array.from(
          new Uint8Array(await (await item.getType(mime)).arrayBuffer()),
        ),
      };
    });
    const image = sharp(Buffer.from(raster.bytes));
    expect((await image.metadata()).format).toBe(
      raster.mime === "image/jpeg" ? "jpeg" : "png",
    );
    const pixels = await image.ensureAlpha().raw().toBuffer();
    expect(pixels.subarray(0, 4)).toEqual(Buffer.from([255, 255, 255, 255]));
    for (const name of ["LaTeX", "MathML"]) {
      await page.getByRole("button", { name: "More preview actions" }).click();
      await page
        .getByRole("menuitem", { name: `Copy ${name}`, exact: true })
        .click();
      await expect(page.locator(".ws-notice")).toContainText(`${name} copied`);
      const text = await page.evaluate(() => navigator.clipboard.readText());
      if (name === "LaTeX") expect(text).toBe(latex);
      else expect(text).toContain('xmlns="http://www.w3.org/1998/Math/MathML"');
    }
  } finally {
    await f.member.clearPermissions();
  }
});

test("preview guards pending/empty renders and handles denied clipboard without losing download", async () => {
  const { page } = await studio();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
        writeText: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      },
    });
  });
  await page.getByRole("button", { name: "Copy PNG", exact: true }).click();
  await expect(
    page.getByText(
      "Clipboard access was denied. Allow clipboard access in your browser or use Download instead.",
    ),
  ).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.png$/);
  // Simulate a worker request boundary without waiting for a timer race.
  const math = page.locator(".math-publication [data-math-request]");
  await math.evaluate((element) => {
    (element as HTMLElement).dataset.mathRequest = "newer equation pending";
  });
  await page.getByRole("button", { name: "Copy PNG", exact: true }).click();
  await expect(
    page.getByText(
      "Wait for a valid math preview before copying or exporting.",
    ),
  ).toBeVisible();
  await math.evaluate((element) => {
    (element as HTMLElement).dataset.mathState = "error";
    element.dispatchEvent(
      new CustomEvent("axiom:math-rendered", { bubbles: true }),
    );
  });
  await expect(
    page.getByRole("button", { name: "Copy PNG", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Download PNG", exact: true }),
  ).toBeDisabled();
  const source = page.getByRole("textbox", {
    name: "LaTeX source",
    exact: true,
  });
  await source.click();
  await source.press("ControlOrMeta+a");
  await source.press("Backspace");
  await expect(source).toHaveText("");
  await expect(
    page.getByRole("button", { name: "Copy PNG", exact: true }),
  ).toBeDisabled();
  await page.keyboard.insertText("x = 1");
  await expect(
    page.getByRole("button", { name: "Copy PNG", exact: true }),
  ).toBeEnabled();
});
