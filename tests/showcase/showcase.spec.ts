import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const { PDFDocument }: typeof import("pdf-lib") = createRequire(
  import.meta.url,
)("pdf-lib");
const JSZip: typeof import("jszip") = createRequire(import.meta.url)("jszip");
const errors = new WeakMap<Page, string[]>(),
  requests = new WeakMap<Page, string[]>();
const paperId = "3f000000-0000-4000-8000-000000000001",
  canvasId = "3f000000-0000-4000-8000-000000000002";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWPIbp/xHwAFdQKKQ+u0CwAAAABJRU5ErkJggg==",
  "base64",
);
test.beforeEach(async ({ page, baseURL }) => {
  errors.set(page, []);
  requests.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (
      /^https?:/.test(url) &&
      (!url.startsWith(new URL(baseURL!).origin) ||
        /\/api\/|\/sync(?:\b|\/)|\.env/.test(url))
    )
      requests.get(page)!.push(url);
  });
  page.on("websocket", (socket) => requests.get(page)!.push(socket.url()));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.get(page)!.push(`${response.status()} ${response.url()}`);
  });
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  expect(requests.get(page)).toEqual([]);
});
async function start(page: Page, destination = "editor", id = paperId) {
  await page.goto(`./#${destination}&note=${id}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.locator(destination === "canvas" ? ".canvas-board" : ".axiom-editor"),
  ).toBeVisible();
}
async function savedSource(page: Page, id = paperId): Promise<string> {
  return page.evaluate(
    (id) =>
      new Promise<string>((resolve, reject) => {
        const opening = indexedDB.open("axiom-showcase-v1", 1);
        opening.onsuccess = () => {
          const db = opening.result,
            req = db
              .transaction("documents", "readonly")
              .objectStore("documents")
              .get(id);
          req.onsuccess = () => {
            resolve(req.result?.source ?? "");
            db.close();
          };
          req.onerror = () => reject(req.error);
        };
        opening.onerror = () => reject(opening.error);
      }),
    id,
  );
}
async function setSource(page: Page, value: string) {
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const cm = page.locator(".demo-document-scroll .cm-content");
  await cm.click();
  await page.keyboard.press("ControlOrMeta+a");
  if (value) await page.keyboard.insertText(value);
  else await page.keyboard.press("Backspace");
  await expect.poll(() => savedSource(page)).toBe(value);
}

test("tour, cold hash routes and shared appearance stay contained under the repository prefix", async ({
  page,
}, info) => {
  await page.goto("./", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "From a question to a clearer idea." }),
  ).toBeVisible();
  await expect(page.locator(".demo-hero-image img")).toBeVisible();
  expect(
    await page
      .locator(".demo-hero-image img")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "dark", exact: true }).click();
  await dialog.getByRole("button", { name: /Technical Slate/ }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-pack",
    "technical-slate",
  );
  await page.getByRole("button", { name: "Start writing" }).click();
  await expect(page.locator(".axiom-editor")).toHaveAttribute(
    "data-engine",
    "milkdown",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".axiom-editor")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: info.outputPath("editor-dark.png") });
  await page.getByRole("link", { name: "Canvas", exact: true }).click();
  await expect(page.locator(".canvas-board .canvas-card")).toHaveCount(4);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".canvas-board .canvas-card")).toHaveCount(4);
});

test("Write, Source and Read share exact persisted Markdown, undo and keyboard mode toggling", async ({
  page,
}) => {
  await start(page);
  const source =
    "# A local observation\n\n- first\n  - nested\n- [ ] reproduce\n\n> Keep the assumption.\n\n$$\nE=mc^2\n$$\n\nAfter";
  await setSource(page, source);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(page.locator(".demo-document-scroll h1")).toContainText(
    "A local observation",
  );
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.locator(".demo-document-scroll .prose h1")).toHaveText(
    "A local observation",
  );
  await expect(
    page.locator(".demo-document-scroll .prose input[type=checkbox]"),
  ).toBeDisabled();
  expect(await savedSource(page)).toBe(source);
  await page.reload();
  await expect(page.locator(".demo-document-scroll h1")).toContainText(
    "A local observation",
  );
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.locator(".demo-document-scroll .cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" retained");
  await expect.poll(() => savedSource(page)).toBe(source + " retained");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => savedSource(page)).toBe(source);
  await page.locator(".demo-document-scroll .cm-content").click();
  await page.keyboard.press("ControlOrMeta+/");
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("equations, images, Mermaid, footnotes and local note links render with no server", async ({
  page,
}) => {
  await start(page);
  await page
    .locator(".demo-document-scroll [data-math-request]")
    .first()
    .scrollIntoViewIfNeeded();
  await expect(
    page.locator(".demo-document-scroll [data-math-state=ready]"),
  ).toHaveCount(1);
  const image = page.locator(".demo-document-scroll img").first();
  await image.scrollIntoViewIfNeeded();
  expect(
    await image.evaluate((el: HTMLImageElement) => el.naturalWidth),
  ).toBeGreaterThan(0);
  await image.dblclick();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toContainText("Image viewer");
  await expect(viewer.locator(".visual-stage img")).toBeVisible();
  await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
  await viewer
    .getByRole("button", { name: "Image information", exact: true })
    .click();
  await expect(viewer).toContainText("900 × 360");
  await viewer
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const diagram = page.locator(
    ".demo-document-scroll [data-mermaid] svg.flowchart",
  );
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram).toBeVisible();
  await diagram.hover();
  await page
    .getByRole("button", { name: "View diagram larger", exact: true })
    .click();
  await expect(viewer.locator(".visual-stage img")).toBeVisible();
  await viewer
    .getByRole("button", { name: "Fullscreen viewer", exact: true })
    .click();
  await expect(
    viewer.getByRole("button", { name: "Exit fullscreen", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.fullscreenElement?.tagName ?? "DIV"),
  ).toBe("DIV");
  await viewer
    .getByRole("button", { name: "Exit fullscreen", exact: true })
    .click();
  await viewer
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const footnote = page
    .locator(".demo-document-scroll [data-footnote-key]")
    .first();
  await footnote.scrollIntoViewIfNeeded();
  await footnote.hover();
  await expect(page.getByRole("tooltip")).toContainText("Record seeds");
  const link = page.locator(".demo-document-scroll a.wiki-link");
  await link.click({
    modifiers: [process.platform === "darwin" ? "Meta" : "Control"],
  });
  await expect(page.locator(".demo-document-scroll h1")).toContainText(
    "Mathematical notebook",
  );
});

test("a slow math-worker download does not interrupt editing or consume the equation watchdog", async ({
  page,
}) => {
  await page.route("**/math.worker-*.js", async (route) => {
    // Deliberately exceed the former combined 15-second startup/job deadline.
    await new Promise((resolve) => setTimeout(resolve, 16500));
    await route.continue();
  });
  await start(page);
  await page
    .locator(".demo-document-scroll [data-math-request]")
    .first()
    .scrollIntoViewIfNeeded();
  const source =
    "# Startup acceptance\n\n$$\nE=mc^2\n$$\n\nStill writing while the renderer loads.";
  await setSource(page, source);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(page.locator(".demo-document-scroll")).toContainText(
    "Still writing while the renderer loads.",
  );
  await expect(
    page.locator('.demo-document-scroll [data-math-state="ready"]'),
  ).toHaveCount(1, { timeout: 90000 });
  await expect(page.locator(".demo-document-scroll .math-error")).toHaveCount(
    0,
  );
  expect(await savedSource(page)).toBe(source);
});

test("table edge operations, folding and minimap work without changing modes unexpectedly", async ({
  page,
}, info) => {
  await start(page);
  await page
    .getByLabel("Choose a notebook")
    .selectOption("3f000000-0000-4000-8000-000000000005");
  await expect(page.locator(".axiom-table-shell")).toBeVisible();
  const before = await savedSource(
    page,
    "3f000000-0000-4000-8000-000000000005",
  );
  await page.locator(".axiom-table-shell").hover();
  await page
    .locator(".axiom-table-shell")
    .getByRole("button", { name: "Add row at bottom" })
    .focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() => savedSource(page, "3f000000-0000-4000-8000-000000000005"))
    .not.toBe(before);
  await page
    .getByRole("button", { name: "Toggle minimap", exact: true })
    .click();
  await expect(page.locator(".document-minimap")).toBeVisible();
  const scroller = page.locator(".demo-document-scroll");
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator(".document-minimap")).toBeVisible();
  const separator = page.getByRole("separator", { name: "Outline width" });
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "238");
  await page.screenshot({ path: info.outputPath("table-minimap.png") });
});

test("slash image picker imports into canonical source and keeps the preview after reload", async ({
  page,
}) => {
  await start(page);
  await setSource(page, "");
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await page.locator(".axiom-prose").click();
  await page.keyboard.type("/image");
  await page.getByRole("option", { name: "Image", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Insert a local file" });
  await expect(dialog).toBeVisible();
  await page.locator('.demo-editor-shell input[type="file"]').setInputFiles({
    name: "local-pixel.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => savedSource(page))
    .toMatch(/!\[local-pixel.png\]\(assets\/[\da-f-]{36}\/local-pixel.png\)/);
  expect(await savedSource(page)).not.toContain("blob:");
  await page.reload();
  await expect(
    page.locator('.demo-document-scroll img[alt="local-pixel.png"]'),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.demo-document-scroll img[alt="local-pixel.png"]')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1);
});

test("Canvas editing, drag, connection ports, undo and reload preserve the board", async ({
  page,
}, info) => {
  await start(page, "canvas", canvasId);
  await expect(
    page.locator('[data-canvas-node="model"] [data-math-state="ready"]'),
  ).toBeVisible();
  const question = page.locator('[data-canvas-node="question"]');
  await expect(question).toContainText("What survives a change?");
  await question.locator(".canvas-card-body").dblclick();
  await expect(page.getByLabel("Card Markdown", { exact: true })).toBeVisible();
  expect(await page.locator(".canvas-board .canvas-card").count()).toBe(4);
  await question.getByRole("button", { name: "Source", exact: true }).click();
  await question.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("## My hypothesis\n\nA **testable** result.");
  await page.keyboard.press("Escape");
  await expect(question).toContainText("My hypothesis");
  const before = (await question.boundingBox())!;
  await page.mouse.move(before.x + 55, before.y + 16);
  await page.mouse.down();
  await page.mouse.move(before.x - 60, before.y - 16, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await question.boundingBox())!.x)
    .toBeLessThan(before.x - 50);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(async () => (await question.boundingBox())!.x)
    .toBeCloseTo(before.x, 0);
  const model = page.locator('[data-canvas-node="model"]');
  await model.hover();
  const from = (await model
      .getByRole("button", { name: "Connect from right", exact: true })
      .boundingBox())!,
    to = (await question
      .getByRole("button", { name: "Connect from right", exact: true })
      .boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect
    .poll(
      async () => JSON.parse(await savedSource(page, canvasId)).edges.length,
    )
    .toBe(4);
  await page.reload();
  await expect(page.locator('[data-canvas-node="question"]')).toContainText(
    "My hypothesis",
  );
  await page.screenshot({ path: info.outputPath("canvas-local.png") });
});

test("local images, PDFs and audio become working file cards and survive reload", async ({
  page,
}) => {
  await start(page, "canvas", canvasId);
  await page
    .getByRole("button", { name: "Add file card", exact: true })
    .click();
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Local research PDF");
  const wav = Buffer.alloc(844);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(836, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(800, 40);
  await page
    .locator(
      '.canvas-file-picker input[type="file"], .dialog input[type="file"]',
    )
    .setInputFiles([
      { name: "field.png", mimeType: "image/png", buffer: png },
      {
        name: "paper.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await pdf.save()),
      },
      { name: "observation.wav", mimeType: "audio/wav", buffer: wav },
    ]);
  await expect(page.getByRole("button", { name: /field.png/ })).toBeVisible();
  await page.getByRole("button", { name: /field.png/ }).click();
  await expect
    .poll(() => page.locator(".canvas-board .canvas-card").count())
    .toBe(5);
  await page
    .getByRole("button", { name: "Add file card", exact: true })
    .click();
  await page.getByRole("button", { name: /paper.pdf/ }).click();
  await expect(
    page.locator('.canvas-board canvas[aria-label="PDF page 1"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add file card", exact: true })
    .click();
  await page.getByRole("button", { name: /observation.wav/ }).click();
  const audioCard = page
    .locator(".canvas-card")
    .filter({ hasText: "observation.wav" });
  await audioCard.hover();
  await audioCard
    .getByRole("button", { name: "Interact with preview", exact: true })
    .click();
  await expect(page.locator(".canvas-board audio")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await expect
    .poll(
      async () => JSON.parse(await savedSource(page, canvasId)).nodes.length,
    )
    .toBe(7);
  await page.reload();
  await expect(page.locator(".canvas-board .canvas-card")).toHaveCount(7);
  await expect(page.locator(".canvas-media-poster")).toContainText(
    "Activate to play audio",
  );
});

test("portable JSON Canvas and ZIP downloads contain stable asset paths and restore additively", async ({
  page,
}) => {
  await start(page, "canvas", canvasId);
  await page
    .getByRole("button", { name: "Export canvas", exact: true })
    .click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloading;
  const data = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(
    data.nodes.find((n: { id: string }) => n.id === "notebook").file,
  ).toMatch(/^notes\/.*\.md$/);
  expect(JSON.stringify(data)).not.toContain("blob:");
  await page.getByLabel("Canvas export format").selectOption("zip");
  const bundled = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const zipDownload = await bundled,
    buffer = await readFile((await zipDownload.path())!);
  const zip = await JSZip.loadAsync(buffer);
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  expect(manifest.documents.length).toBe(5);
  for (const asset of manifest.assets)
    expect(zip.file(asset.path)).not.toBeNull();
  const paper = manifest.documents.find(
    (d: { id: string }) => d.id === paperId,
  );
  expect(await zip.file(paper.path)!.async("string")).toContain(
    "](" + "../../assets/",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Local files", exact: true }).click();
  await page
    .locator('.showcase-app > input[type="file"]')
    .setInputFiles({ name: "backup.zip", mimeType: "application/zip", buffer });
  await expect
    .poll(() => page.getByLabel("Choose a notebook").locator("option").count())
    .toBe(8);
  expect(await savedSource(page, paperId)).toContain("Spectral graph methods");
});

test("Canvas image and PDF exports contain the rendered board", async ({
  page,
}) => {
  test.setTimeout(Math.max(test.info().timeout, 120000));
  await start(page, "canvas", canvasId);
  await page
    .getByRole("button", { name: "Export canvas", exact: true })
    .click();
  for (const format of ["svg", "png", "pdf"]) {
    await page.getByLabel("Canvas export format").selectOption(format);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const download = await downloading;
    const bytes = await readFile((await download.path())!);
    expect(bytes.length).toBeGreaterThan(1000);
    if (format === "svg") {
      const svg = bytes.toString("utf8");
      expect(svg).toContain("<svg");
      expect(svg).not.toMatch(/(?:src|href)="blob:|\/api\//);
    } else if (format === "png")
      expect([...bytes.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
    else expect(bytes.toString("utf8", 0, 4)).toBe("%PDF");
  }
});

test("quota refusal and external-image isolation preserve existing local drafts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate: async () => ({ quota: 1, usage: 1 }) },
    });
  });
  await start(page);
  const before = await savedSource(page);
  await page.getByRole("button", { name: "Local files", exact: true }).click();
  await page.locator('.showcase-app > input[type="file"]').setInputFiles({
    name: "no-room.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    page.getByRole("status").filter({ hasText: "Not enough browser storage" }),
  ).toBeVisible();
  expect(await savedSource(page)).toBe(before);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await setSource(
    page,
    "![Not imported](https://example.com/private-image.png)",
  );
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    page.locator('.demo-document-scroll img[src^="https:"]'),
  ).toHaveCount(0);
  expect(await savedSource(page)).toContain(
    "https://example.com/private-image.png",
  );
});

test("styled HTML export embeds local images, math and fonts instead of cloud URLs", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("button", { name: "Export document", exact: true })
    .click();
  const exporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Styled HTML" }).click();
  const download = await exporting,
    html = await readFile((await download.path())!, "utf8");
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("mjx-container");
  expect(html).toContain("data:image/svg+xml;base64,");
  expect(html).toContain("@font-face");
  expect(html).not.toMatch(/src="blob:|<script\b|\/api\//);
});

test("unavailable IndexedDB reports session-only editing and still allows export", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      get: () => {
        throw new Error("Storage denied for acceptance");
      },
    });
  });
  await start(page);
  await expect(page.getByRole("alert")).toContainText(
    "Browser storage is unavailable",
  );
  await page
    .getByRole("button", { name: "Export document", exact: true })
    .click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Markdown/ }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("Spectral graph methods.md");
});

test("reading and editing settings apply to the real engine, persist and use a pane-edge scrollport", async ({
  page,
}, info) => {
  await start(page);
  const original = await savedSource(page);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const settings = page.getByRole("dialog");
  await settings.getByRole("tab", { name: "Typography", exact: true }).click();
  await settings
    .getByLabel("Reading font", { exact: true })
    .selectOption("sourceSans");
  await settings
    .getByLabel("Heading font", { exact: true })
    .selectOption("sourceSerif");
  await settings.getByRole("tab", { name: "Page", exact: true }).click();
  await settings.getByLabel("Typewriter scrolling").check();
  await settings.getByLabel("Use the full page width").check();
  await settings
    .getByRole("tab", { name: "Code & tables", exact: true })
    .click();
  await settings.getByLabel("Indentation", { exact: true }).selectOption("2");
  await settings
    .getByLabel("Default code language", { exact: true })
    .fill("julia");
  await settings.getByLabel("Code line numbers", { exact: true }).check();
  await settings
    .getByRole("tab", { name: "Typing & math", exact: true })
    .click();
  await settings.getByLabel("Slash commands", { exact: true }).uncheck();
  await settings
    .getByLabel("Math symbol completion", { exact: true })
    .uncheck();
  await settings.getByRole("tab", { name: "Minimap", exact: true }).click();
  await settings.getByLabel("Document minimap", { exact: true }).check();
  await settings
    .getByLabel("Minimap side", { exact: true })
    .selectOption("left");
  await page.screenshot({ path: info.outputPath("reading-settings.png") });
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".axiom-editor")).toHaveAttribute(
    "data-typewriter",
    "true",
  );
  await expect(page.locator(".document-minimap")).toBeVisible();
  expect(await savedSource(page)).toBe(original);
  const scroll = await page
    .locator(".demo-document-scroll")
    .evaluate((element) => ({
      overflow: getComputedStyle(element.querySelector(".axiom-editor")!)
        .overflow,
      height: element.clientHeight,
      content: element.scrollHeight,
    }));
  expect(scroll.overflow).toBe("visible");
  expect(scroll.content).toBeGreaterThan(scroll.height + 100);
  await page.reload();
  await expect(page.locator(".axiom-editor")).toHaveAttribute(
    "data-typewriter",
    "true",
  );
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await settings
    .getByRole("tab", { name: "Code & tables", exact: true })
    .click();
  await expect(settings.getByLabel("Indentation", { exact: true })).toHaveValue(
    "2",
  );
  await expect(
    settings.getByLabel("Default code language", { exact: true }),
  ).toHaveValue("julia");
  await settings
    .getByRole("tab", { name: "Typing & math", exact: true })
    .click();
  await expect(
    settings.getByLabel("Slash commands", { exact: true }),
  ).not.toBeChecked();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await setSource(page, "");
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await page.locator(".axiom-prose").click();
  await page.keyboard.type("/table");
  await expect.poll(() => savedSource(page)).toBe("/table");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("settings use one keyboard-accessible rail, stable panes and category-only resets", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await start(page);
  await expect
    .poll(() => savedSource(page))
    .toContain("Spectral graph methods");
  const original = await savedSource(page);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Appearance & editor" });
  await expect(settings.getByRole("tab")).toHaveCount(7);
  const theme = settings.getByRole("tab", { name: "Theme & interface" }),
    typography = settings.getByRole("tab", { name: "Typography", exact: true });
  await theme.focus();
  await page.keyboard.press("ArrowDown");
  await expect(typography).toBeFocused();
  await expect(typography).toHaveAttribute("aria-selected", "true");
  await settings
    .getByLabel("Reading font", { exact: true })
    .selectOption("sourceSans");
  const size = settings.getByLabel("Reading font size", { exact: true });
  await size.focus();
  await page.keyboard.press("End");
  await expect(size).toHaveValue("30");
  await expect(settings.locator(".demo-settings-preview .prose")).toHaveCSS(
    "font-size",
    "30px",
  );
  await settings
    .getByRole("tab", { name: "Typing & math", exact: true })
    .click();
  await settings
    .getByRole("switch", { name: "Slash commands", exact: true })
    .uncheck();
  await typography.click();
  await settings
    .getByRole("button", { name: "Reset Typography settings" })
    .click();
  await expect(
    settings.getByLabel("Reading font", { exact: true }),
  ).toHaveValue("latinModern");
  await expect(size).toHaveValue("18");
  await settings
    .getByRole("tab", { name: "Typing & math", exact: true })
    .click();
  await expect(
    settings.getByRole("switch", { name: "Slash commands", exact: true }),
  ).not.toBeChecked();
  await settings.getByRole("tab", { name: "Page", exact: true }).click();
  await settings
    .getByRole("switch", { name: "Use the full page width" })
    .check();
  await expect(
    settings.getByLabel("Reading width", { exact: true }),
  ).toBeDisabled();
  await settings
    .getByRole("tab", { name: "Code & tables", exact: true })
    .click();
  const fields = settings.locator(".demo-settings-fields");
  const layout = () =>
    settings.evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect(),
        fixed = [
          ".dialog-heading",
          ".demo-settings-navigation",
          ".demo-settings-panel-heading",
          ".demo-settings-preview",
          ".dialog-footer",
        ].map((selector) => {
          const rect = dialog.querySelector(selector)!.getBoundingClientRect();
          return [rect.top, rect.bottom];
        });
      return {
        left: bounds.left,
        right: bounds.right,
        bottom: bounds.bottom,
        viewport: [innerWidth, innerHeight],
        overflow: dialog.scrollWidth - dialog.clientWidth,
        bodyScroll: dialog.querySelector(".dialog-body")!.scrollTop,
        fixed,
      };
    });
  const before = await layout();
  await fields.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => fields.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(100);
  const after = await layout();
  expect(after.fixed).toEqual(before.fixed);
  expect(after.bodyScroll).toBe(0);
  expect(after.overflow).toBeLessThanOrEqual(1);
  expect(after.left).toBeGreaterThanOrEqual(0);
  expect(after.right).toBeLessThanOrEqual(after.viewport[0]);
  expect(after.bottom).toBeLessThanOrEqual(after.viewport[1]);
  await page.screenshot({ path: info.outputPath("settings-light.png") });
  await settings.getByRole("tab", { name: "Theme & interface" }).click();
  await settings.getByRole("button", { name: "dark", exact: true }).click();
  await settings.getByLabel("Interface design").selectOption("fluent");
  await page.setViewportSize({ width: 1120, height: 760 });
  const compact = await layout();
  expect(compact.overflow).toBeLessThanOrEqual(1);
  expect(compact.left).toBeGreaterThanOrEqual(0);
  expect(compact.right).toBeLessThanOrEqual(compact.viewport[0]);
  await expect(
    settings.getByRole("complementary", { name: "Live appearance preview" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("settings-dark.png") });
  await settings.getByRole("tab", { name: "Local data" }).focus();
  await page.keyboard.press("Home");
  await expect(theme).toBeFocused();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  expect(await savedSource(page)).toBe(original);
});

test("Local data backs up drafts, cancels safely, imports additively and clears only the guest store", async ({
  page,
}) => {
  await start(page);
  const source = "# My local research draft\n\nA preserved observation.";
  await setSource(page, source);
  await page.evaluate(async () => {
    localStorage.setItem("unrelated-workbench-preference", "keep");
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open("axiom-acceptance-unrelated", 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore("proof");
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result,
          transaction = db.transaction("proof", "readwrite");
        transaction.objectStore("proof").put("keep", "sentinel");
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Appearance & editor" });
  await settings.getByRole("tab", { name: "Local data" }).click();
  const downloading = page.waitForEvent("download");
  await settings
    .getByRole("button", { name: "Download backup", exact: true })
    .click();
  const download = await downloading,
    zip = await JSZip.loadAsync(await readFile((await download.path())!)),
    manifest = JSON.parse(await zip.file("manifest.json")!.async("string")),
    paper = manifest.documents.find(
      (document: { id: string }) => document.id === paperId,
    );
  expect(download.suggestedFilename()).toBe("axiom-showcase-backup.zip");
  expect(await zip.file(paper.path)!.async("string")).toBe(source);
  expect(manifest.assets.length).toBeGreaterThan(0);
  await settings
    .getByRole("button", { name: "Clear local demo", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Clear local demo data?",
    exact: true,
  });
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(settings).toBeVisible();
  expect(await savedSource(page)).toBe(source);
  const choosing = page.waitForEvent("filechooser");
  await settings
    .getByRole("button", { name: "Import backup or files" })
    .click();
  await (
    await choosing
  ).setFiles({
    name: "Additional note.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# An additive import"),
  });
  await expect(settings).toHaveCount(0);
  await expect(page.locator(".demo-document-scroll h1")).toContainText(
    "An additive import",
  );
  expect(await savedSource(page)).toBe(source);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await settings.getByRole("tab", { name: "Local data" }).click();
  await settings
    .getByRole("button", { name: "Clear local demo", exact: true })
    .click();
  await confirm
    .getByRole("button", { name: "Clear & restore examples" })
    .click();
  await expect(
    page.getByRole("heading", { name: "From a question to a clearer idea." }),
  ).toBeVisible();
  await expect
    .poll(() => savedSource(page))
    .toContain("Spectral graph methods");
  expect(await savedSource(page)).not.toBe(source);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("unrelated-workbench-preference"),
    ),
  ).toBe("keep");
  expect(
    await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const opening = indexedDB.open("axiom-acceptance-unrelated", 1);
          opening.onerror = () => reject(opening.error);
          opening.onsuccess = () => {
            const db = opening.result,
              reading = db
                .transaction("proof", "readonly")
                .objectStore("proof")
                .get("sentinel");
            reading.onsuccess = () => {
              resolve(reading.result);
              db.close();
            };
            reading.onerror = () => reject(reading.error);
          };
        }),
    ),
  ).toBe("keep");
});

test("Write, Source and Read scroll the document pane without moving the toolbar or footer", async ({
  page,
}) => {
  await start(page);
  await setSource(
    page,
    "# Scroll acceptance\n\n" +
      Array.from(
        { length: 90 },
        (_, index) =>
          `Observation ${index + 1}. A long research notebook should scroll at the pane edge, not beside its text.`,
      ).join("\n\n"),
  );
  for (const mode of ["Write", "Source", "Read"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    const pane = page.locator(".demo-document-scroll");
    await expect
      .poll(() => pane.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(1000);
    const fixed = await page.evaluate(() => ({
      toolbar: document
        .querySelector(".demo-document-toolbar")!
        .getBoundingClientRect().top,
      footer: document
        .querySelector(".demo-document-status")!
        .getBoundingClientRect().top,
    }));
    await pane.evaluate((el) => {
      el.scrollTop = 0;
    });
    await pane.hover({ position: { x: 100, y: 100 } });
    await page.mouse.wheel(0, 700);
    await expect
      .poll(() => pane.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(300);
    const layout = await page.evaluate(() => {
      const pane = document.querySelector(".demo-document-scroll")!,
        editor = pane.querySelector(".axiom-editor")!,
        scroller = pane.querySelector(".cm-scroller"),
        row = pane.parentElement!,
        minimap = row.querySelector(".minimap-slot")!;
      return {
        innerOverflow: getComputedStyle(editor).overflowY,
        innerScroll: editor.scrollTop,
        sourceOverflow: scroller && getComputedStyle(scroller).overflowY,
        pageScroll: document.scrollingElement!.scrollTop,
        paneRight: pane.getBoundingClientRect().right,
        rowRight: row.getBoundingClientRect().right,
        mapWidth: minimap.getBoundingClientRect().width,
        toolbar: document
          .querySelector(".demo-document-toolbar")!
          .getBoundingClientRect().top,
        footer: document
          .querySelector(".demo-document-status")!
          .getBoundingClientRect().top,
      };
    });
    expect(layout.innerOverflow).toBe("visible");
    expect(layout.innerScroll).toBe(0);
    if (mode === "Source") expect(layout.sourceOverflow).toBe("visible");
    expect(layout.pageScroll).toBe(0);
    expect(layout.paneRight + layout.mapWidth).toBeCloseTo(layout.rowRight, 0);
    expect(layout.toolbar).toBe(fixed.toolbar);
    expect(layout.footer).toBe(fixed.footer);
  }
});
