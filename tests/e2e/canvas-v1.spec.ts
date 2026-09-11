import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fixture, origin } from "./native-editor-helpers";
const JSZip: typeof import("jszip") = createRequire(import.meta.url)("jszip");
const sharp: typeof import("sharp").default = createRequire(import.meta.url)(
  "sharp",
);
let f: Awaited<ReturnType<typeof fixture>>, spaceId: string;
const call = async (
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) => {
  const response = await request.fetch(`/api/v1/${path}`, {
    method,
    data,
    headers: { origin },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
};
const create = async (type: string, name: string, source = "") => {
  const resource = await call(f.member.request, "files/new", {
    type,
    name,
    source,
    spaceId,
    mutationId: randomUUID(),
  });
  return { ...resource, name: resource.name ?? name };
};
const readCanvas = async (id: string) =>
  JSON.parse((await call(f.member.request, `notes/${id}`)).body);
const textCard = (id: string, x = 0, text = "A **research** observation.") => ({
  id,
  type: "text",
  title: id,
  text,
  x,
  y: 0,
  width: 340,
  height: 220,
  heightMode: "manual",
});
test.beforeAll(async ({ browser }) => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Canvas v1 acceptance only runs against its isolated port-3004 database.",
    );
  f = await fixture(browser, "# Canvas v1 acceptance\n");
  spaceId = (await call(f.member.request, "spaces")).find(
    (s: any) => s.kind === "team" && s.group_id === f.group.id,
  ).id;
});
test.afterAll(async () => {
  await f?.close();
});

test("named cards, right-to-right connections, lock, properties and card links", async ({}, info) => {
  const created = await create(
      "canvas",
      "Card operations",
      JSON.stringify({
        nodes: [textCard("left"), textCard("right", 620)],
        edges: [],
      }),
    ),
    page = f.page;
  await page.goto(`/workbench/tools/canvas/${created.id}`);
  await expect(page.locator(".canvas-status")).toContainText("Saved on server");
  const right = page.locator('[data-canvas-node="right"]'),
    left = page.locator('[data-canvas-node="left"]');
  await right.hover();
  const from = (await right
      .getByRole("button", { name: "Connect from right", exact: true })
      .boundingBox())!,
    to = (await left
      .getByRole("button", { name: "Connect from right", exact: true })
      .boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await expect(left).toHaveClass(/is-connection-target/);
  await page.mouse.up();
  await expect
    .poll(async () => (await readCanvas(created.id)).edges.length)
    .toBe(1);
  expect((await readCanvas(created.id)).edges[0]).toMatchObject({
    fromNode: "right",
    fromSide: "right",
    toNode: "left",
    toSide: "right",
  });
  await left.locator(".canvas-card-name").click();
  await page.keyboard.press("F2");
  await left.getByLabel("Card name").fill("Boundary conditions");
  await left.getByLabel("Card name").press("Enter");
  await expect(left.locator(".canvas-card-name")).toHaveText(
    "Boundary conditions",
  );
  await left.click({ button: "right", position: { x: 30, y: 15 } });
  await page.getByRole("menuitem", { name: "Properties", exact: true }).click();
  const properties = page.locator(".canvas-properties");
  await properties.getByLabel("Card tags").fill("physics, theory");
  await properties.getByLabel("Card tags").press("Enter");
  await properties.getByLabel("Lock position and size").check();
  const before = (await left.boundingBox())!;
  await page.mouse.move(before.x + 40, before.y + 14);
  await page.mouse.down();
  await page.mouse.move(before.x + 130, before.y + 70, { steps: 8 });
  await page.mouse.up();
  expect((await left.boundingBox())!.x).toBeCloseTo(before.x, 0);
  await page.getByRole("button", { name: "Find cards", exact: true }).click();
  await page.getByLabel("Search cards").fill("theory");
  await expect(page.locator(".canvas-card-result")).toHaveCount(1);
  await page.goto(`/workbench/tools/canvas/${created.id}#card=right`);
  await expect(page.locator('[data-canvas-node="right"]')).toHaveClass(
    /is-selected/,
  );
  await page.screenshot({
    path: info.outputPath("canvas-card-controls.png"),
    fullPage: true,
  });
});

test("auto height is independent of zoom and manual resize opts out", async ({}, info) => {
  const created = await create(
      "canvas",
      "Measured research",
      JSON.stringify({
        nodes: [
          {
            ...textCard(
              "auto",
              0,
              Array.from(
                { length: 6 },
                (_, i) =>
                  `Paragraph ${i + 1}: a longer research observation about a measurable physical process.`,
              ).join("\n\n"),
            ),
            heightMode: "auto",
            height: 120,
          },
        ],
        edges: [],
      }),
    ),
    page = f.page;
  await page.goto(`/workbench/tools/canvas/${created.id}`);
  await expect
    .poll(async () => (await readCanvas(created.id)).nodes[0].height)
    .toBeGreaterThan(300);
  const first = (await readCanvas(created.id)).nodes[0];
  expect(first.width).toBe(340);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await page.waitForTimeout(700);
  expect((await readCanvas(created.id)).nodes[0].height).toBe(first.height);
  await page.getByRole("button", { name: "Zoom to fit", exact: true }).click();
  const card = page.locator('[data-canvas-node="auto"]');
  await card.locator(".canvas-card-name").click();
  const grip = (await card
    .getByRole("button", { name: "Resize card" })
    .boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 50, grip.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await readCanvas(created.id)).nodes[0].heightMode)
    .toBe("manual");
  await card.click({ button: "right", position: { x: 30, y: 15 } });
  await page
    .getByRole("menuitem", { name: "Restore automatic height" })
    .click();
  await expect
    .poll(async () => (await readCanvas(created.id)).nodes[0].heightMode)
    .toBe("auto");
  await page.screenshot({
    path: info.outputPath("canvas-auto-height.png"),
    fullPage: true,
  });
});

test("native file previews, nested canvas, no unsolicited webpages, and portable export", async ({}, info) => {
  test.setTimeout(120000);
  const math = await create(
      "math",
      "Field equation",
      "\\nabla\\cdot\\mathbf{E}=\\rho/\\varepsilon_0",
    ),
    md = await create(
      "markdown",
      "Method",
      "# Preview method\n\n**Measured** evidence.",
    ),
    text = await create("text", "Raw log", "sample=42\nvoltage=3.3"),
    nested = await create(
      "canvas",
      "Nested study",
      JSON.stringify({
        nodes: [textCard("inside", 0, "# Inside nested canvas")],
        edges: [],
      }),
    ),
    image = await create("image", "Figure project");
  const refs = [math, md, text, nested, image],
    nodes = refs.map((r: any, i: number) => ({
      id: `ref-${i}`,
      type: "file",
      file: r.name,
      resourceId: r.id,
      x: (i % 3) * 390,
      y: Math.floor(i / 3) * 360,
      width: 350,
      height: 300,
      heightMode: "manual",
    }));
  const created = await create(
      "canvas",
      "Research previews",
      JSON.stringify({
        nodes: [
          ...nodes,
          {
            id: "web",
            type: "link",
            url: "https://example.org/",
            x: 780,
            y: 360,
            width: 350,
            height: 300,
          },
        ],
        edges: [],
      }),
    ),
    page = f.page;
  const outgoing: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://example.org"))
      outgoing.push(request.url());
  });
  await page.goto(`/workbench/tools/canvas/${created.id}`);
  await expect(
    page.locator('[data-canvas-node="ref-0"] [data-math-state="ready"]'),
  ).toBeVisible();
  expect(
    (await page.locator('[data-canvas-node="ref-0"] .sr-only').boundingBox())!
      .width,
  ).toBeLessThan(2);
  await expect(
    page.locator('[data-canvas-node="ref-1"] .reading-view'),
  ).toContainText("Measured evidence.");
  await expect(page.locator('[data-canvas-node="ref-2"]')).toContainText(
    "sample=42",
  );
  await expect(
    page.locator('[data-canvas-node="ref-3"] .canvas-nested-stage'),
  ).toContainText("Inside nested canvas");
  await expect(page.locator('[data-canvas-node="ref-4"] img')).toBeVisible();
  expect(outgoing).toEqual([]);
  const cardPreview = await call(
    f.member.request,
    `resources/${math.id}/card-preview`,
  );
  expect(cardPreview).toMatchObject({
    kind: "document",
    format: "latex",
    source: "\\nabla\\cdot\\mathbf{E}=\\rho/\\varepsilon_0",
  });
  await page.screenshot({
    path: info.outputPath("canvas-linked-previews.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Export canvas", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Export format").selectOption("zip");
  await dialog.getByRole("button", { name: "Prepare bundle" }).click();
  await expect(
    dialog.getByRole("link", { name: "Download portable bundle" }),
  ).toBeVisible({ timeout: 30000 });
  const download = await f.member.request.get(
    (await dialog
      .getByRole("link", { name: "Download portable bundle" })
      .getAttribute("href"))!,
  );
  expect(download.ok()).toBe(true);
  const zip = await JSZip.loadAsync(await download.body()),
    manifest = JSON.parse(
      await zip.file("canvas-manifest.json")!.async("string"),
    );
  expect(manifest.format).toBe("axiom-canvas-bundle");
  expect(
    manifest.entries.some(
      (e: any) => e.resourceId === math.id && e.sourceFormat === "latex",
    ),
  ).toBe(true);
  expect(
    manifest.omissions.some((e: any) => e.reference === "https://example.org/"),
  ).toBe(true);
  for (const entry of manifest.entries)
    expect(
      createHash("sha256")
        .update(await zip.file(entry.path)!.async("nodebuffer"))
        .digest("hex"),
    ).toBe(entry.sha256);
  const portable = JSON.parse(
    await zip.file("Research previews.canvas")!.async("string"),
  );
  expect(portable.nodes.find((n: any) => n.id === "ref-0").file).toMatch(
    /^sources\//,
  );
  expect(portable.nodes.find((n: any) => n.id === "ref-4").file).toMatch(
    /^assets\//,
  );
});

test("visual exports produce actual PNG, JPG, SVG and PDF files", async ({}, info) => {
  test.setTimeout(120000);
  const created = await create(
      "canvas",
      "Export specimen",
      JSON.stringify({
        nodes: [
          textCard("equation", 0, "# Energy\n\n$$E=mc^2$$"),
          textCard("method", 450, "A **bold** observation."),
        ],
        edges: [
          { id: "e", fromNode: "equation", toNode: "method", label: "implies" },
        ],
      }),
    ),
    page = f.page;
  await page.goto(`/workbench/tools/canvas/${created.id}`);
  await expect(page.locator(".canvas-status")).toContainText("Saved on server");
  await page
    .getByRole("button", { name: "Export canvas", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Export resolution").selectOption("1");
  for (const format of ["png", "jpeg", "svg", "pdf"]) {
    await dialog.getByLabel("Export format").selectOption(format);
    const pending = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    const download = await pending;
    const path = info.outputPath(
      `visual-export.${format === "jpeg" ? "jpg" : format}`,
    );
    await download.saveAs(path);
    const bytes = await readFile(path);
    expect(bytes.length).toBeGreaterThan(1000);
    if (format === "png") expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    if (format === "jpeg") expect(bytes[0]).toBe(255);
    if (format === "pdf") expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    if (format === "svg") {
      expect(bytes.toString()).toContain("data:image/png;base64,");
      expect(bytes.toString()).toContain("marker-end");
      const images = [
        ...bytes.toString().matchAll(/href="data:image\/png;base64,([^"]+)"/g),
      ];
      expect(images).toHaveLength(2);
      for (const [, encoded] of images) {
        const stats = await sharp(Buffer.from(encoded, "base64")).stats();
        expect(
          stats.channels[3].mean,
          "Every card must contain visible pixels, including cards away from the origin",
        ).toBeGreaterThan(200);
        expect(
          stats.channels[0].stdev,
          "A card must retain its rendered text",
        ).toBeGreaterThan(5);
      }
    }
    await expect(
      dialog.getByRole("button", { name: "Export", exact: true }),
    ).toBeEnabled();
  }
  await page.screenshot({
    path: info.outputPath("canvas-export-dialog.png"),
    fullPage: true,
  });
});

test("theme packs preview without discarding custom typography and cancel restores the saved look", async ({}, info) => {
  const page = f.page;
  await page.goto("/workbench/settings/appearance/theme");
  await expect(page.getByLabel("Theme pack", { exact: true })).toBeVisible();
  const previous = await page.locator("html").getAttribute("data-theme-pack");
  await page
    .getByLabel("Theme pack", { exact: true })
    .selectOption("paper-research");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-pack",
    "paper-research",
  );
  await page.getByRole("button", { name: "Interface", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Theme workbench" }),
  ).toBeVisible();
  await page.getByLabel("Specimen search").fill("Spectral decomposition");
  await page.getByRole("button", { name: "Specimen actions" }).click();
  await expect(
    page.getByRole("group", { name: "Sample action menu" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("paper-research-workbench.png"),
    fullPage: true,
  });
  await page
    .getByLabel("Theme pack", { exact: true })
    .selectOption("technical-slate");
  await page.getByLabel("Color mode", { exact: true }).selectOption("dark");
  // Capture the settled semantic colors, not a light/dark transition frame.
  await expect
    .poll(() =>
      page.getByLabel("Specimen search").evaluate((input) => {
        const style = getComputedStyle(input),
          probe = document.createElement("span");
        probe.style.color = "var(--text)";
        probe.style.backgroundColor = "var(--surface)";
        document.body.append(probe);
        const expected = getComputedStyle(probe),
          settled =
            style.color === expected.color &&
            style.backgroundColor === expected.backgroundColor;
        probe.remove();
        return settled;
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: info.outputPath("technical-slate-workbench.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-pack",
    previous ?? "default",
  );
});

test("card discussions validate anchors and an old dataset cannot mutate the new one", async () => {
  const created = await create(
      "canvas",
      "Anchored discussion",
      JSON.stringify({ nodes: [textCard("target")], edges: [] }),
    ),
    page = f.page;
  await call(f.member.request, `resource-comments/${created.id}`, {
    body: "Check this assumption.",
    anchor: { kind: "canvas-node", nodeId: "target" },
  });
  const invalid = await f.member.request.post(
    `/api/v1/resource-comments/${created.id}`,
    {
      headers: { origin },
      data: {
        body: "Missing",
        anchor: { kind: "canvas-node", nodeId: "not-here" },
      },
    },
  );
  expect(invalid.status()).toBe(409);
  await page.goto(`/workbench/tools/canvas/${created.id}`);
  await page
    .locator('[data-canvas-node="target"]')
    .click({ button: "right", position: { x: 25, y: 15 } });
  await page
    .getByRole("menuitem", { name: "Discuss card", exact: true })
    .click();
  await expect(page.locator(".resource-discussion")).toContainText(
    "Check this assumption.",
  );
  const stale = await f.member.request.post("/api/v1/resources", {
    headers: { origin, "X-Axiom-Dataset": randomUUID() },
    data: {
      spaceId,
      kind: "folder",
      name: "Must not exist",
      mutationId: randomUUID(),
    },
  });
  expect(stale.status()).toBe(409);
});
