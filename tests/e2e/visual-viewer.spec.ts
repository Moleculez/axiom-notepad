import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  VisualAnnotation,
  VisualWrite,
} from "../../packages/shared/src/visual-annotations";
import type { Resource } from "../../packages/shared/src/workspace";
const sharp = createRequire(import.meta.url)(
  "sharp",
) as typeof import("sharp").default;
import { fixture, origin } from "./native-editor-helpers";
type Lab = Awaited<ReturnType<typeof fixture>>;
function payload(record: VisualAnnotation): VisualWrite {
  const {
    authorId: _a,
    authorName: _b,
    createdAt: _c,
    updatedAt: _d,
    ...value
  } = record;
  return { ...value, mutationId: randomUUID() };
}
async function api(
  f: Lab,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const response = await f.member.request.fetch(`/api/v1/${path}`, {
    method,
    headers: { origin },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function rectangle(f: Lab) {
  const dialog = f.page.getByRole("dialog").last();
  await expect(dialog.locator(".visual-sheet>img").first()).toBeVisible();
  const markup = dialog.getByRole("button", {
    name: "Annotations and markup",
    exact: true,
  });
  if ((await markup.getAttribute("aria-pressed")) !== "true")
    await markup.click();
  await dialog
    .getByRole("button", { name: "Draw rectangle", exact: true })
    .click();
  const stage = await dialog
    .getByRole("region", { name: "Image viewport", exact: true })
    .boundingBox();
  if (!stage) throw new Error("Missing image viewport");
  await f.page.mouse.move(
    stage.x + stage.width * 0.4,
    stage.y + stage.height * 0.4,
  );
  await f.page.mouse.down();
  await f.page.mouse.move(
    stage.x + stage.width * 0.6,
    stage.y + stage.height * 0.6,
    { steps: 6 },
  );
  await f.page.mouse.up();
  await expect(dialog.locator(".visual-mark-list button")).toHaveCount(1);
}
const sample =
  "# Visual research\n\n![Research photo](/visual-fixture.jpg)\n\n![Another placement](/visual-fixture.jpg)\n\n```mermaid\ngraph LR\n  A[Hypothesis] --> B[Experiment]\n  B --> C[Evidence]\n```\n\nUnchanged conclusion.\n";
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Use isolated staging for visual-viewer acceptance.");
});
async function photo() {
  return sharp({
    create: {
      width: 960,
      height: 600,
      channels: 3,
      background: { r: 65, g: 113, b: 170 },
    },
  })
    .withExif({
      IFD0: { Make: "Axiom", Model: "ResearchCam" },
      IFD2: { DateTimeOriginal: "2026:09:13 10:20:30" },
    })
    .jpeg()
    .toBuffer();
}
async function ready(f: Awaited<ReturnType<typeof fixture>>) {
  f.page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /same key|unique.*key/i.test(message.text())
    )
      f.errors.push(message.text());
  });
  const image = await photo();
  await f.page.route("**/visual-fixture.jpg", (r) =>
    r.fulfill({ body: image, contentType: "image/jpeg" }),
  );
  await f.page.reload();
  await expect(f.page.locator(".axiom-image img").first()).toBeVisible();
  await expect(f.page.locator(".ws-document-status")).toContainText(
    "Saved on server",
  );
}
test("image double click, zoom, metadata, comparison, export and caret return", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    await ready(f);
    const image = f.page.locator(".axiom-image img").first();
    await image.dblclick({ position: { x: 100, y: 80 } });
    const dialog = f.page.getByRole("dialog", {
      name: "Research photo",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".visual-sheet>img")).toBeVisible();
    await dialog.getByRole("button", { name: "1:1", exact: true }).click();
    await expect(dialog.getByLabel("Zoom percentage")).toHaveValue("100");
    await dialog
      .getByRole("button", { name: "Zoom in (+)", exact: true })
      .click();
    await expect(dialog.getByLabel("Zoom percentage")).toHaveValue("125");
    await dialog
      .getByRole("button", {
        name: "Image or diagram information",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText("ResearchCam", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Compare images or diagrams", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Another placement", exact: true })
      .click();
    await expect(
      dialog.getByRole("region", { name: "Comparison viewport" }),
    ).toBeVisible();
    const sheets = dialog.locator(".visual-sheet");
    await expect(sheets).toHaveCount(2);
    const transforms = () =>
      sheets.evaluateAll((elements) =>
        elements.map((el) => (el as HTMLElement).style.transform),
      );
    await expect
      .poll(async () => {
        const [a, b] = await transforms();
        return a === b;
      })
      .toBe(true);
    await dialog
      .getByRole("button", { name: "Linked views", exact: true })
      .click();
    const independent = (await transforms())[1];
    await dialog
      .getByRole("button", { name: "Zoom in (+)", exact: true })
      .click();
    expect((await transforms())[1]).toBe(independent);
    await dialog
      .getByRole("button", { name: "Independent views", exact: true })
      .click();
    await expect
      .poll(async () => {
        const [a, b] = await transforms();
        return a === b;
      })
      .toBe(true);
    await dialog.getByRole("button", { name: "Fit", exact: true }).click();
    await expect
      .poll(async () => {
        const [a, b] = await transforms();
        return a === b;
      })
      .toBe(true);
    await dialog
      .getByRole("button", { name: "Export image", exact: true })
      .click();
    const download = f.page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Download copy", exact: true })
      .click();
    expect((await download).suggestedFilename()).toMatch(/\.png$/);
    await f.page.screenshot({ path: info.outputPath("visual-viewer.png") });
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).toBeHidden();
    expect(await f.source()).toBe(sample);
  } finally {
    await f.close();
  }
});
test("markup is private, persists, shares explicitly and remains separate by placement", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    await ready(f);
    await f.page
      .locator(".axiom-image img")
      .first()
      .dblclick({ position: { x: 100, y: 80 } });
    const dialog = f.page.getByRole("dialog", {
      name: "Research photo",
      exact: true,
    });
    await expect(dialog.locator(".visual-sheet>img")).toBeVisible();
    await dialog
      .getByRole("button", { name: "Annotations and markup", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Draw rectangle", exact: true })
      .click();
    const stage = await dialog
      .getByRole("region", { name: "Image viewport", exact: true })
      .boundingBox();
    if (!stage) throw new Error("No viewport");
    await f.page.mouse.move(
      stage.x + stage.width * 0.35,
      stage.y + stage.height * 0.35,
    );
    await f.page.mouse.down();
    await f.page.mouse.move(
      stage.x + stage.width * 0.6,
      stage.y + stage.height * 0.6,
      { steps: 5 },
    );
    await f.page.mouse.up();
    await expect(dialog.locator(".visual-mark-list button")).toHaveCount(1);
    const endpoint = `/api/v1/resources/${f.note.id}/visual-annotations`;
    await expect
      .poll(
        async () =>
          (await (await f.member.request.get(endpoint)).json()).length,
      )
      .toBe(1);
    expect(await (await f.owner.request.get(endpoint)).json()).toEqual([]);
    await dialog
      .getByRole("button", { name: "Next visual (→)", exact: true })
      .click();
    await expect(dialog.locator(".visual-mark-list button")).toHaveCount(0);
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "Previous visual (←)", exact: true })
      .click();
    await expect(dialog.locator(".visual-mark-list button")).toHaveCount(1);
    await dialog.locator(".visual-mark-list button").click();
    await dialog
      .getByRole("button", { name: "Share annotation", exact: true })
      .click();
    await expect
      .poll(
        async () => (await (await f.owner.request.get(endpoint)).json()).length,
      )
      .toBe(1);
    await expect(dialog.locator(".annotation-editor-toolbar")).toHaveCount(2);
    await f.page.screenshot({ path: info.outputPath("visual-markup.png") });
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await f.page.reload();
    await f.page
      .locator(".axiom-image img")
      .first()
      .dblclick({ position: { x: 100, y: 80 } });
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "Annotations and markup", exact: true })
      .click();
    await expect(f.page.locator(".visual-mark-list button")).toHaveCount(1);
    expect(await f.source()).toBe(sample);
  } finally {
    await f.close();
  }
});
test("Mermaid opens from reading mode and exports vectors without changing source", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    await ready(f);
    await f.page.getByRole("button", { name: "Read", exact: true }).click();
    const diagram = f.page.locator(
      ".read-mount:not(.print-only) [data-mermaid]",
    );
    await expect(diagram.locator("svg").first()).toBeVisible();
    await diagram.dblclick({ position: { x: 80, y: 50 } });
    const dialog = f.page.getByRole("dialog", {
      name: "Mermaid diagram",
      exact: true,
    });
    await expect(dialog.locator(".visual-sheet>img")).toBeVisible();
    await dialog
      .getByRole("button", {
        name: "Image or diagram information",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText("EXIF does not apply to diagrams.", { exact: false }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Export image", exact: true })
      .click();
    await dialog.getByLabel("Format", { exact: true }).selectOption("svg");
    const download = f.page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Download copy", exact: true })
      .click();
    expect((await download).suggestedFilename()).toMatch(/\.svg$/);
    await f.page.screenshot({ path: info.outputPath("mermaid-viewer.png") });
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    expect(await f.source()).toBe(sample);
  } finally {
    await f.close();
  }
});

test("visual annotation API enforces privacy, versions, reply ownership and moderation", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  try {
    const path = `resources/${f.note.id}/visual-annotations`;
    const input: VisualWrite = {
      id: randomUUID(),
      version: 0,
      mutationId: randomUUID(),
      placement: { resourceId: f.note.id, path: [], from: 19, to: 62 },
      source: {
        kind: "image",
        fingerprint: "test-snapshot",
        width: 960,
        height: 600,
        label: "Research photo",
        verified: false,
      },
      shape: {
        kind: "rectangle",
        points: [
          [0.2, 0.2],
          [0.4, 0.4],
        ],
        color: "#d14b59",
        stroke: 2,
        text: "",
      },
      body: "Private hypothesis.",
      parentId: null,
      visibility: "private",
      resolved: false,
      deleted: false,
    };
    const created: VisualAnnotation = await api(f, path, input);
    expect(created.version).toBe(1);
    expect((await api(f, path, input)).version).toBe(1);
    expect(await (await f.owner.request.get(`/api/v1/${path}`)).json()).toEqual(
      [],
    );
    const denied = await f.owner.request.patch(
      `/api/v1/visual-annotations/${created.id}`,
      { headers: { origin }, data: { ...payload(created), body: "Not mine" } },
    );
    expect(denied.status()).toBe(404);
    const conflict = await f.member.request.patch(
      `/api/v1/visual-annotations/${created.id}`,
      { headers: { origin }, data: { ...payload(created), version: 0 } },
    );
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).current.version).toBe(1);
    const bounds = await f.member.request.post(`/api/v1/${path}`, {
      headers: { origin },
      data: {
        ...input,
        id: randomUUID(),
        shape: {
          ...input.shape,
          points: [
            [1.01, 0],
            [0.5, 0.5],
          ],
        },
      },
    });
    expect(bounds.status()).toBe(400);
    const shared: VisualAnnotation = await api(
      f,
      `visual-annotations/${created.id}`,
      { ...payload(created), visibility: "shared" },
      "PATCH",
    );
    const otherEdit = await f.owner.request.patch(
      `/api/v1/visual-annotations/${shared.id}`,
      {
        headers: { origin },
        data: { ...payload(shared), body: "Still not mine" },
      },
    );
    expect(otherEdit.status()).toBe(403);
    const reply = await f.owner.request.post(`/api/v1/${path}`, {
      headers: { origin },
      data: {
        ...payload(shared),
        id: randomUUID(),
        version: 0,
        parentId: shared.id,
        shape: null,
        body: "Independent $x^2$ review.",
      },
    });
    expect(reply.ok(), await reply.text()).toBe(true);
    expect(await api(f, path)).toHaveLength(2);
    const unshare = await f.member.request.patch(
      `/api/v1/visual-annotations/${shared.id}`,
      {
        headers: { origin },
        data: { ...payload(shared), visibility: "private" },
      },
    );
    expect(unshare.status()).toBe(409);
    const badVersion = await f.member.request.post(`/api/v1/${path}`, {
      headers: { origin },
      data: {
        ...input,
        id: randomUUID(),
        placement: { ...input.placement, versionId: randomUUID() },
      },
    });
    expect(badVersion.status()).toBe(404);
    const removed = await f.owner.request.delete(
      `/api/v1/visual-annotations/${shared.id}`,
      { headers: { origin }, data: payload(shared) },
    );
    expect(removed.ok(), await removed.text()).toBe(true);
    expect(await removed.json()).toMatchObject({
      deleted: true,
      shape: null,
      body: "",
    });
    expect(await f.source()).toBe(sample);
  } finally {
    await f.close();
  }
});

test("offline markup and rich notes recover after closing the viewer; undo never changes Markdown", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  try {
    await ready(f);
    await f.page
      .locator(".axiom-image img")
      .first()
      .dblclick({ position: { x: 100, y: 80 } });
    const dialog = f.page.getByRole("dialog");
    await expect(dialog.locator(".visual-sheet>img")).toBeVisible();
    await f.member.setOffline(true);
    await rectangle(f);
    const editor = dialog.getByTestId("annotation-editor");
    await editor.click();
    await f.page.keyboard.insertText("Offline region note with $x^2$.");
    await expect(
      dialog.getByText("Saved locally · awaiting server", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await f.member.setOffline(false);
    const path = `resources/${f.note.id}/visual-annotations`;
    await expect
      .poll(async () => (await api(f, path))[0]?.body)
      .toBe("Offline region note with $x^2$.");
    await f.page.reload();
    await f.page
      .locator(".axiom-image img")
      .first()
      .dblclick({ position: { x: 100, y: 80 } });
    await dialog
      .getByRole("button", { name: "Annotations and markup", exact: true })
      .click();
    await expect(dialog.locator(".visual-mark-list button")).toHaveCount(1);
    await dialog.locator(".visual-mark-list button").click();
    await expect(dialog.getByTestId("annotation-editor")).toContainText(
      "Offline region note",
    );
    await dialog.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(dialog.locator(".visual-mark-list button")).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Undo markup", exact: true })
      .click();
    await expect(dialog.locator(".visual-mark-list button")).toHaveCount(1);
    await dialog
      .getByRole("button", { name: "Redo markup", exact: true })
      .click();
    await expect(dialog.locator(".visual-mark-list button")).toHaveCount(0);
    expect(await f.source()).toBe(sample);
  } finally {
    await f.member.setOffline(false);
    await f.close();
  }
});

test("Mermaid vector export includes editable vector markup, while original source stays intact", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  try {
    await ready(f);
    const diagram = f.page.locator(".editor-mount [data-mermaid]");
    await expect(diagram.locator("svg").first()).toBeVisible();
    await diagram.dblclick({ position: { x: 80, y: 45 } });
    const dialog = f.page.getByRole("dialog");
    await rectangle(f);
    await dialog
      .getByRole("button", { name: "Export image", exact: true })
      .click();
    await dialog.getByLabel("Format", { exact: true }).selectOption("svg");
    await dialog.getByLabel("Include visible markup", { exact: true }).check();
    const pending = f.page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Download copy", exact: true })
      .click();
    const output = await pending;
    const content = await readFile((await output.path())!, "utf8");
    expect(content).toContain('data-axiom-markup="true"');
    expect(content).toContain("<rect");
    expect(content).not.toContain("<script");
    expect(content).not.toContain("<image");
    expect(await f.source()).toBe(sample);
  } finally {
    await f.close();
  }
});

test("canvas image gestures open the viewer and keep card identity and document source", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    await ready(f);
    const source = JSON.stringify({
      nodes: [
        {
          id: "visual-card-a",
          type: "text",
          text: "![Canvas photo](/visual-fixture.jpg)",
          x: 0,
          y: 0,
          width: 440,
          height: 340,
        },
        {
          id: "visual-card-b",
          type: "text",
          text: "![Other card](/visual-fixture.jpg)",
          x: 500,
          y: 0,
          width: 440,
          height: 340,
        },
      ],
      edges: [],
    });
    const created = await api(f, "files/new", {
      type: "canvas",
      name: "Visual canvas",
      spaceId: (await api(f, `resources/${f.note.id}`)).space_id,
      source,
      mutationId: randomUUID(),
    });
    await f.page.goto(`/workbench/notes/${created.id}`);
    await expect(f.page.locator(".canvas-world .canvas-card")).toHaveCount(2);
    const img = f.page
      .locator('.canvas-card[data-canvas-node="visual-card-a"] img')
      .first();
    await expect(img).toBeVisible();
    await img.dblclick({ position: { x: 100, y: 70 } });
    const dialog = f.page.getByRole("dialog");
    await expect(dialog.locator(".visual-sheet>img")).toBeVisible();
    await rectangle(f);
    const path = `resources/${created.id}/visual-annotations`;
    await expect.poll(async () => (await api(f, path)).length).toBe(1);
    const [mark] = await api(f, path);
    expect(mark.placement.path).toEqual(["visual-card-a"]);
    expect(mark.placement.anchor).toBeTruthy();
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(f.page.locator(".canvas-world .canvas-card")).toHaveCount(2);
    await f.page.reload();
    await f.page
      .locator('.canvas-card[data-canvas-node="visual-card-a"] img')
      .first()
      .dblclick({ position: { x: 100, y: 70 } });
    await dialog
      .getByRole("button", { name: "Annotations and markup", exact: true })
      .click();
    await expect(dialog.locator(".visual-mark-list button")).toHaveCount(1);
    await f.page.screenshot({
      path: info.outputPath("canvas-image-viewer.png"),
    });
    expect(
      JSON.parse((await api(f, `notes/${created.id}`)).body).nodes.map(
        (n: any) => n.text,
      ),
    ).toEqual(JSON.parse(source).nodes.map((n: any) => n.text));
  } finally {
    await f.close();
  }
});

test("stored image preview uses the same viewer and rechecks access on deletion", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    const resource = await api(f, `resources/${f.note.id}`);
    const id = randomUUID(),
      content = await photo();
    await api(f, "uploads", {
      id,
      spaceId: resource.space_id,
      name: "Image-viewer-fixture.jpg",
      bytes: content.length,
    });
    const chunk = await f.member.request.put(`/api/v1/uploads/${id}/chunks/1`, {
      headers: { origin, "content-type": "application/octet-stream" },
      data: content,
    });
    expect(chunk.ok(), await chunk.text()).toBe(true);
    await api(f, `uploads/${id}/complete`, {});
    await expect
      .poll(async () => (await api(f, `uploads/${id}`)).status, {
        timeout: 30000,
      })
      .toBe("complete");
    const upload = await api(f, `uploads/${id}`),
      file: Resource = await api(f, `resources/${upload.resourceId}`);
    await f.page.goto(`/workbench/notes/${file.id}`);
    await expect(
      f.page.locator(".visual-file-preview .visual-sheet>img"),
    ).toBeVisible();
    await f.page
      .locator(".visual-file-preview .visual-sheet>img")
      .dblclick({ position: { x: 150, y: 100 } });
    const dialog = f.page.getByRole("dialog");
    await expect(dialog.locator(".visual-sheet>img")).toBeVisible();
    await rectangle(f);
    await expect
      .poll(
        async () =>
          (await api(f, `resources/${file.id}/visual-annotations`)).length,
      )
      .toBe(1);
    await f.page.screenshot({
      path: info.outputPath("stored-image-viewer.png"),
    });
    await api(f, `resources/${file.id}/trash`, { version: file.version });
    await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(dialog).toBeHidden();
    const denied = await f.member.request.get(
      `/api/v1/resources/${file.id}/visual-annotations`,
    );
    expect(denied.status()).toBe(404);
  } finally {
    await f.close();
  }
});

test("dark viewer keeps source-safe context menus, keyboard access and compact inspector geometry", async ({
  browser,
}, info) => {
  const f = await fixture(browser, sample);
  try {
    const bundle = await api(f, "me/preferences-bundle");
    await api(
      f,
      "me/preferences-bundle",
      {
        appearance: {
          version: bundle.appearance.version,
          preferences: {
            ...bundle.appearance.preferences,
            mode: "dark",
            radius: 0,
            shadows: "none",
          },
        },
        editor: bundle.editor,
        mutationId: randomUUID(),
      },
      "PATCH",
    );
    await ready(f);
    const img = f.page.locator(".axiom-image img").first();
    await img.hover();
    await expect(f.page.locator(".axiom-image-source-text")).toHaveCount(0);
    await img.click({ button: "right" });
    await expect(f.page.locator(".axiom-image-source-text")).toHaveCount(0);
    await f.page.getByRole("menuitem", { name: /^View larger/ }).click();
    const dialog = f.page.getByRole("dialog");
    await rectangle(f);
    await dialog.getByTestId("annotation-editor").click();
    await f.page.keyboard.insertText(
      "Inspect the plotted region; retain $x^2$ in the note.",
    );
    expect(
      await dialog.evaluate((el) => ({
        radius: getComputedStyle(el).borderRadius,
        shadow: getComputedStyle(el).boxShadow,
      })),
    ).toEqual({ radius: "0px", shadow: "none" });
    const viewport = await dialog.boundingBox(),
      footer = await dialog.locator(".visual-footer").boundingBox();
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(
      viewport!.y + viewport!.height,
    );
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await f.page.screenshot({
      path: info.outputPath("dark-visual-viewer.png"),
    });
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).toBeHidden();
    // Let the dialog's source-caret restoration finish before moving focus to
    // a new atom. This is a frame boundary, not a timing-based readiness guess.
    await f.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await f.page.locator(".axiom-image").first().focus();
    await f.page.keyboard.press("Alt+Enter");
    await expect(dialog).toBeVisible();
    await f.page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await img.click({ position: { x: 100, y: 80 } });
    await expect(f.page.locator(".axiom-image-source-text")).toBeVisible();
    await expect(img).toBeVisible();
    expect(await f.source()).toBe(sample);
  } finally {
    await f.close();
  }
});

test("a retained private draft does not silently publish after another device changes sharing", async ({
  browser,
}) => {
  const f = await fixture(browser, sample);
  try {
    await ready(f);
    await f.page
      .locator(".axiom-image img")
      .first()
      .dblclick({ position: { x: 100, y: 80 } });
    await rectangle(f);
    const path = `resources/${f.note.id}/visual-annotations`;
    await expect.poll(async () => (await api(f, path)).length).toBe(1);
    const [record] = await api(f, path);
    await f.member.setOffline(true);
    await f.page.getByTestId("annotation-editor").click();
    await f.page.keyboard.insertText("Do not publish this private revision.");
    await expect(
      f.page.getByText("Saved locally · awaiting server", { exact: true }),
    ).toBeVisible();
    await api(
      f,
      `visual-annotations/${record.id}`,
      { ...payload(record), visibility: "shared" },
      "PATCH",
    );
    await f.member.setOffline(false);
    await expect(
      f.page.getByText("This annotation changed. Your draft was retained.", {
        exact: true,
      }),
    ).toBeVisible();
    expect((await api(f, path))[0]).toMatchObject({
      visibility: "shared",
      body: "",
    });
    await f.page
      .getByRole("button", { name: "Reapply my draft", exact: true })
      .click();
    await expect(
      f.page
        .getByRole("alert")
        .filter({ hasText: "Sharing changed on another device" }),
    ).toBeVisible();
    expect((await api(f, path))[0].body).toBe("");
    expect(await f.source()).toBe(sample);
  } finally {
    await f.member.setOffline(false);
    await f.close();
  }
});

for (const kind of ["image", "mermaid"] as const)
  test(`${kind} fullscreen uses a valid surface, retains controls and exits without closing the viewer`, async ({
    browser,
  }, info) => {
    const f = await fixture(browser, sample);
    try {
      await ready(f);
      if (kind === "image")
        await f.page
          .locator(".axiom-image img")
          .first()
          .dblclick({ position: { x: 100, y: 80 } });
      else {
        await f.page.getByRole("button", { name: "Read", exact: true }).click();
        const diagram = f.page.locator(
          ".read-mount:not(.print-only) [data-mermaid]",
        );
        await expect(diagram.locator("svg").first()).toBeVisible();
        await diagram.dblclick();
      }
      const dialog = f.page.getByRole("dialog"),
        surface = dialog.locator(":scope > .dialog-surface");
      await expect(dialog.locator(".visual-sheet>img")).toBeVisible();
      const native = await f.page.evaluate(
        () =>
          document.fullscreenEnabled &&
          typeof Element.prototype.requestFullscreen === "function",
      );
      const enter = dialog.getByRole("button", {
        name: "Enter fullscreen",
        exact: true,
      });
      await enter.click();
      const exit = dialog.getByRole("button", {
        name: native ? "Exit fullscreen" : "Exit expanded view",
        exact: true,
      });
      await expect(exit).toBeVisible();
      if (native) {
        await expect
          .poll(() =>
            surface.evaluate((el) => document.fullscreenElement === el),
          )
          .toBe(true);
        expect(await surface.evaluate((el) => el.tagName)).toBe("DIV");
      } else await expect(dialog).toHaveAttribute("data-expanded", "true");
      await expect(
        dialog.getByRole("heading", {
          name: kind === "image" ? "Research photo" : "Mermaid diagram",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Close dialog" }),
      ).toBeVisible();
      const geometry = await surface.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          vw: innerWidth,
          vh: innerHeight,
        };
      });
      expect(Math.abs(geometry.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.w - geometry.vw)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.h - geometry.vh)).toBeLessThanOrEqual(1);
      await dialog.getByRole("button", { name: "1:1", exact: true }).click();
      await expect(dialog.getByLabel("Zoom percentage")).toHaveValue("100");
      await f.page.screenshot({
        path: info.outputPath(`${kind}-fullscreen.png`),
      });
      await exit.click();
      await expect(enter).toBeVisible();
      expect(
        await f.page.evaluate(() => document.fullscreenElement === null),
      ).toBe(true);
      await enter.click();
      await expect(exit).toBeVisible();
      await f.page.keyboard.press("Escape");
      await expect(enter).toBeVisible();
      await expect(dialog).toBeVisible();
      await enter.click();
      await expect(exit).toBeVisible();
      await dialog.getByRole("button", { name: "Close dialog" }).click();
      await expect(dialog).toBeHidden();
      await expect
        .poll(() => f.page.evaluate(() => document.fullscreenElement === null))
        .toBe(true);
      expect(await f.source()).toBe(sample);
    } finally {
      await f.close();
    }
  });

for (const failure of ["unavailable", "denied"] as const)
  test(`fullscreen ${failure} falls back to a reversible expanded window`, async ({
    browser,
  }) => {
    const f = await fixture(browser, sample);
    try {
      await ready(f);
      await f.page
        .locator(".axiom-image img")
        .first()
        .dblclick({ position: { x: 100, y: 80 } });
      const dialog = f.page.getByRole("dialog");
      await expect(dialog.locator(".visual-sheet>img")).toBeVisible();
      await dialog
        .locator(":scope > .dialog-surface")
        .evaluate((el, reason) => {
          Object.defineProperty(el, "requestFullscreen", {
            configurable: true,
            value:
              reason === "unavailable"
                ? undefined
                : () =>
                    Promise.reject(
                      new TypeError("Fullscreen denied by browser policy."),
                    ),
          });
        }, failure);
      await dialog
        .getByRole("button", { name: "Enter fullscreen", exact: true })
        .click();
      await expect(dialog).toHaveAttribute("data-expanded", "true");
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      const box = await dialog.boundingBox();
      const viewport = f.page.viewportSize()!;
      expect(box).toMatchObject({
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height,
      });
      await dialog
        .getByRole("button", { name: "Exit expanded view", exact: true })
        .click();
      await expect(dialog).not.toHaveAttribute("data-expanded", "true");
      await dialog
        .getByRole("button", { name: "Enter fullscreen", exact: true })
        .click();
      await expect(dialog).toHaveAttribute("data-expanded", "true");
      await dialog.getByRole("button", { name: "Close dialog" }).focus();
      await f.page.keyboard.press("Escape");
      await expect(dialog).not.toHaveAttribute("data-expanded", "true");
      await expect(dialog).toBeVisible();
      await f.page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      expect(await f.source()).toBe(sample);
    } finally {
      await f.close();
    }
  });
