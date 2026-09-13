import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fixture, origin, replaceSource } from "./native-editor-helpers";
const sharp = createRequire(import.meta.url)(
  "sharp",
) as typeof import("sharp").default;
test.use({ actionTimeout: 15000 });

async function api(request: APIRequestContext, path: string, data?: unknown) {
  const response = await request.fetch(`/api/v1/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { origin },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function upload(
  request: APIRequestContext,
  spaceId: string,
  resourceId?: string,
  color = "#2b80c8",
) {
  const content = await sharp({
    create: { width: 320, height: 200, channels: 4, background: color },
  })
    .png()
    .toBuffer();
  const id = randomUUID();
  await api(request, "uploads", {
    id,
    spaceId,
    resourceId,
    name: "Research-image.png",
    bytes: content.length,
  });
  const chunk = await request.put(`/api/v1/uploads/${id}/chunks/1`, {
    headers: { origin, "content-type": "application/octet-stream" },
    data: content,
  });
  expect(chunk.ok(), await chunk.text()).toBe(true);
  await api(request, `uploads/${id}/complete`, {});
  await expect
    .poll(async () => (await api(request, `uploads/${id}`)).status, {
      timeout: 30000,
    })
    .toBe("complete");
  const result = await api(request, `uploads/${id}`);
  return {
    file: await api(request, `resources/${result.resourceId}`),
    content,
  };
}
async function pixels(page: Page) {
  return page
    .getByLabel("Image canvas", { exact: true })
    .evaluate((canvas: HTMLCanvasElement) => ({
      width: canvas.width,
      height: canvas.height,
      pixel: Array.from(
        canvas.getContext("2d")!.getImageData(10, 10, 1, 1).data,
      ),
    }));
}
async function createCopy(page: Page, spaceId: string) {
  const dialog = page.getByRole("dialog", {
    name: "New drawing / image project",
    exact: true,
  });
  await dialog
    .getByLabel("Name", { exact: true })
    .fill("Editable research image");
  await dialog.getByRole("combobox").selectOption(spaceId);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Image canvas", { exact: true })).toBeVisible();
  await expect
    .poll(() => pixels(page))
    .toEqual({ width: 320, height: 200, pixel: [43, 128, 200, 255] });
  await expect(
    page.getByRole("button", { name: "Save version", exact: true }),
  ).toBeEnabled();
  return {
    id: new URL(page.url()).pathname.split("/").at(-1)!,
    url: page.url(),
  };
}
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Image copy acceptance requires isolated staging on port 3004.",
    );
});
test("Edit a copy shows the source image, saves it and preserves edits on reload", async ({
  browser,
}, info) => {
  test.setTimeout(90000);
  const f = await fixture(
    browser,
    "# Image copy regression\n\nUnchanged research.\n",
  );
  try {
    const spaceId = (await api(f.member.request, `resources/${f.note.id}`))
      .space_id;
    const original = await upload(f.member.request, spaceId);
    const page = f.page;
    await page.goto(`/workbench/image/${original.file.id}`);
    await expect(
      page.locator(".visual-file-preview .visual-sheet>img"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edit a copy", exact: true })
      .click();
    const { id } = await createCopy(page, spaceId);
    expect(id).not.toBe(original.file.id);
    await page.getByRole("button", { name: "Add layer", exact: true }).click();
    await page
      .getByRole("button", { name: "Save version", exact: true })
      .click();
    await expect(page.locator(".studio-status")).toContainText(
      "Saved as a new cloud version",
    );
    await page.route(`**/api/v1/files/${original.file.id}/content**`, (route) =>
      route.abort(),
    );
    await page.reload();
    await expect(page.locator(".image-layer")).toHaveCount(2);
    await expect
      .poll(() => pixels(page))
      .toEqual({ width: 320, height: 200, pixel: [43, 128, 200, 255] });
    await expect(
      page.getByRole("button", { name: "Save version", exact: true }),
    ).toBeDisabled();
    expect(await api(f.member.request, `files/${id}/versions`)).toHaveLength(2);
    expect(
      await api(f.member.request, `files/${original.file.id}/versions`),
    ).toHaveLength(1);
    const response = await f.member.request.get(
      `/api/v1/files/${original.file.id}/content?version=${original.file.current_version_id}`,
    );
    expect((await response.body()).equals(original.content)).toBe(true);
    expect(await f.source()).toBe(
      "# Image copy regression\n\nUnchanged research.\n",
    );
    await page.screenshot({ path: info.outputPath("image-copy-reopened.png") });
  } finally {
    await f.close();
  }
});

test("note viewer editing imports the displayed version and Save copy can publish an editable copy", async ({
  browser,
}, info) => {
  test.setTimeout(90000);
  const f = await fixture(browser, "Unchanged image evidence.");
  try {
    const page = f.page;
    const spaceId = (await api(f.member.request, `resources/${f.note.id}`))
      .space_id;
    const original = await upload(f.member.request, spaceId);
    await upload(f.member.request, spaceId, original.file.id, "#cf593e");
    const body = `# Image evidence\n\n![Research image](/api/v1/attachments/${original.file.current_version_id})\n\nUnchanged conclusion.`;
    await replaceSource(page, body);
    await expect.poll(f.source).toBe(body);
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await page.locator(".axiom-image img").dblclick();
    const viewer = page.getByRole("dialog");
    await viewer
      .getByRole("button", { name: "Export image", exact: true })
      .click();
    await viewer
      .getByRole("button", { name: "Edit a copy in Image Studio", exact: true })
      .click();
    const copy = await createCopy(page, spaceId);
    await page.getByRole("button", { name: "Add layer", exact: true }).click();
    await page.getByRole("button", { name: "Save copy", exact: true }).click();
    await expect(page).not.toHaveURL(copy.url);
    const savedId = new URL(page.url()).pathname.split("/").at(-1)!;
    expect(savedId).not.toBe(original.file.id);
    expect(savedId).not.toBe(copy.id);
    await expect(page.locator(".studio-status")).toContainText(
      "lease acquired",
    );
    await expect(page.locator(".image-layer")).toHaveCount(2);
    await expect
      .poll(() => pixels(page))
      .toEqual({ width: 320, height: 200, pixel: [43, 128, 200, 255] });
    await page.getByRole("button", { name: "Add layer", exact: true }).click();
    await page
      .getByRole("button", { name: "Save version", exact: true })
      .click();
    await expect(page.locator(".studio-status")).toContainText(
      "Saved as a new cloud version",
    );
    expect(
      await api(f.member.request, `files/${savedId}/versions`),
    ).toHaveLength(3);
    expect(
      await api(f.member.request, `files/${original.file.id}/versions`),
    ).toHaveLength(2);
    expect(await f.source()).toBe(body);
    await page.screenshot({ path: info.outputPath("pinned-image-copy.png") });
  } finally {
    await f.close();
  }
});

test("a local image draft can recover without fetching the import source again", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const f = await fixture(browser, "Unchanged recovery evidence.");
  try {
    const page = f.page;
    const spaceId = (await api(f.member.request, `resources/${f.note.id}`))
      .space_id;
    const original = await upload(f.member.request, spaceId);
    await page.goto(`/workbench/image/${original.file.id}`);
    await page
      .getByRole("button", { name: "Edit a copy", exact: true })
      .click();
    const copy = await createCopy(page, spaceId);
    await page.getByRole("button", { name: "Add layer", exact: true }).click();
    await page
      .getByRole("link", { name: "Back to folder", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Keep your image draft before leaving" })
      .getByRole("button", { name: "Keep draft & leave" })
      .click();
    await expect(page).toHaveURL(/\/workbench\/explorer/);
    let importedAgain = 0;
    await page.route(
      `**/api/v1/files/${original.file.id}/content**`,
      (route) => {
        importedAgain++;
        return route.abort();
      },
    );
    await page.goto(copy.url);
    await page
      .getByRole("dialog", { name: "Restore local image draft?", exact: true })
      .getByRole("button", { name: "Restore draft", exact: true })
      .click();
    await expect(page.locator(".image-layer")).toHaveCount(2);
    await expect
      .poll(() => pixels(page))
      .toEqual({ width: 320, height: 200, pixel: [43, 128, 200, 255] });
    expect(importedAgain).toBe(0);
    await page
      .getByRole("button", { name: "Save version", exact: true })
      .click();
    await expect(page.locator(".studio-status")).toContainText(
      "Saved as a new cloud version",
    );
  } finally {
    await f.close();
  }
});

test("a saved blank version is not replaced by stale import parameters", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const f = await fixture(browser, "Unchanged blank figure evidence.");
  try {
    const page = f.page;
    const spaceId = (await api(f.member.request, `resources/${f.note.id}`))
      .space_id;
    const original = await upload(f.member.request, spaceId);
    const project = await api(f.member.request, "files/new", {
      type: "image",
      name: "Deliberately blank",
      spaceId,
      mutationId: randomUUID(),
    });
    await page.goto(`/workbench/image/${project.id}`);
    await expect(page.locator(".studio-status")).toContainText(
      "lease acquired",
    );
    await page.getByRole("button", { name: "Add layer", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByRole("button", { name: "Save version", exact: true })
      .click();
    await expect(page.locator(".studio-status")).toContainText(
      "Saved as a new cloud version",
    );
    let imports = 0;
    await page.route(
      `**/api/v1/files/${original.file.id}/content**`,
      (route) => {
        imports++;
        return route.abort();
      },
    );
    await page.goto(
      `/workbench/image/${project.id}?file=${original.file.id}&version=${original.file.current_version_id}`,
    );
    await expect(
      page.getByLabel("Image canvas", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => pixels(page))
      .toEqual({ width: 1200, height: 800, pixel: [0, 0, 0, 0] });
    await expect(
      page.getByRole("button", { name: "Save version", exact: true }),
    ).toBeDisabled();
    expect(imports).toBe(0);
  } finally {
    await f.close();
  }
});

test("image metadata retains file authorization and PDF-only annotation boundaries", async ({
  browser,
  request,
}) => {
  const f = await fixture(browser, "Unchanged image permissions.");
  const outsider = await fixture(browser, "Unrelated workspace.");
  try {
    const spaceId = (await api(f.member.request, `resources/${f.note.id}`))
      .space_id;
    const original = await upload(f.member.request, spaceId);
    const version = original.file.current_version_id;
    const path = `/api/v1/attachments/${version}/meta`;
    const response = await f.member.request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const metadata = await response.json();
    expect(metadata).toMatchObject({
      id: version,
      resource_id: original.file.id,
      mime: "image/png",
      bytes: original.content.length,
    });
    expect(metadata).not.toHaveProperty("storage_key");
    expect((await request.get(path)).status()).toBe(401);
    expect((await outsider.member.request.get(path)).status()).toBe(404);
    const annotations = `/api/v1/attachments/${version}/annotations`;
    expect((await f.member.request.get(annotations)).status()).toBe(400);
    expect(
      (
        await f.member.request.put(annotations, {
          headers: { origin },
          data: {},
        })
      ).status(),
    ).toBe(400);
    await api(f.member.request, `resources/${original.file.id}/trash`, {
      version: original.file.version,
    });
    // Immutable attachments remain readable to authorized members in Trash
    // (existing notes may still reference them), but never after access revocation.
    expect((await f.member.request.get(path)).status()).toBe(200);
    const member = await api(f.member.request, "me");
    await f.page.close();
    const removed = await f.owner.request.delete(
      `/api/v1/members/${member.user.id}?groupId=${f.group.id}`,
      { headers: { origin } },
    );
    expect(removed.ok(), await removed.text()).toBe(true);
    expect((await f.member.request.get(path)).status()).toBe(404);
  } finally {
    await outsider.close();
    await f.close();
  }
});
