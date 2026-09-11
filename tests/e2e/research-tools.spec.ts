import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fixture, origin } from "./native-editor-helpers";
import {
  appearanceVariables,
  defaults,
} from "../../packages/shared/src/appearance";
// Node 22's mixed ESM/CJS loader can instantiate JSZip twice through ExcelJS.
const require = createRequire(import.meta.url);
const ExcelJS: typeof import("exceljs") = require("exceljs");
const JSZip: typeof import("jszip") = require("jszip");
let f: Awaited<ReturnType<typeof fixture>>, spaceId: string;
test.use({ actionTimeout: 15000 });
const call = async (
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) => {
  const r = await request.fetch("/api/v1/" + path, {
    method,
    data,
    headers: { origin },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
};
test.beforeAll(async ({ browser }) => {
  test.setTimeout(90000);
  if (!["http://localhost:3002", "http://localhost:3004"].includes(origin))
    throw new Error(
      "Research tools tests must use isolated 3002 or 3004 storage/database.",
    );
  f = await fixture(
    browser,
    "# Unchanged research note\n\nOriginal source stays intact.\n",
  );
  const spaces = await call(f.member.request, "spaces");
  spaceId = spaces.find(
    (s: any) => s.group_id === f.group.id && s.kind === "team",
  ).id;
});
test.afterAll(async () => {
  await f?.close();
});
test("Math Studio preserves mode-switch source, edits live, exports, and isolates local undo", async ({}, info) => {
  test.setTimeout(90000);
  const project = await call(f.member.request, "tools", {
    kind: "math",
    name: "Collaborative equation " + randomUUID().slice(0, 5),
    spaceId,
    source: "\\frac{x}{2} + y^2",
    mutationId: randomUUID(),
  });
  const a = f.page,
    b = await f.owner.newPage(),
    errors: string[] = [];
  b.on("pageerror", (e) => errors.push(e.message));
  await a.goto(`/workbench/tools/math/${project.id}`);
  await b.goto(`/workbench/tools/math/${project.id}`);
  await expect(a.locator(".studio-status")).toContainText("Saved on server");
  await expect(b.locator(".studio-status")).toContainText("Saved on server");
  await expect(
    a.locator('.math-publication [data-math-state="ready"]'),
  ).toBeVisible();
  await expect(
    a.locator(".math-symbol-grid .math-symbol-icon svg").first(),
  ).toBeVisible();
  const source = async () =>
    (await call(f.member.request, `notes/${project.id}`)).body;
  const before = await source();
  await a.getByRole("button", { name: "Visual", exact: true }).click();
  await expect(a.locator("math-field")).toBeVisible();
  await a.getByRole("button", { name: "Source", exact: true }).click();
  expect(await source()).toBe(before);
  await a.getByRole("button", { name: "Visual", exact: true }).click();
  await a.locator("math-field").click();
  await a.keyboard.press("End");
  await a.keyboard.type("+q");
  await expect.poll(source).toContain("q");
  await a.getByRole("button", { name: "Source", exact: true }).click();
  const editor = a.getByLabel("LaTeX source");
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await a.keyboard.insertText(" + z");
  await expect(b.getByLabel("LaTeX source")).toContainText("+ z");
  await expect(a.locator(".studio-status")).toContainText("Saved on server");
  await b.getByLabel("LaTeX source").click();
  await b.getByLabel("LaTeX source").press("ControlOrMeta+End");
  await b.keyboard.insertText(" = 1");
  await expect(a.getByLabel("LaTeX source")).toContainText("= 1");
  await a.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(b.getByLabel("LaTeX source")).toContainText("= 1");
  await expect(b.getByLabel("LaTeX source")).not.toContainText("+ z");
  await a.getByRole("button", { name: "Checkpoint", exact: true }).click();
  await expect(a.locator(".ws-notice")).toContainText("checkpoint");
  await a.getByRole("button", { name: "Export", exact: true }).click();
  const download = a.waitForEvent("download");
  await a.getByRole("button", { name: "DOCX", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.docx$/);
  await a.keyboard.press("Escape");
  await a.screenshot({ path: info.outputPath("math-studio-light.png") });
  await a.getByRole("button", { name: "Project discussion" }).click();
  await a.getByLabel("Write a comment").fill("Check the boundary conditions.");
  await a.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(a.getByText("Check the boundary conditions.")).toBeVisible();
  await a.keyboard.press("Escape");
  await a.getByRole("button", { name: "OCR and math assistant" }).click();
  await expect(a.getByText(/No compatible provider is enabled/)).toBeVisible();
  await expect(
    a.getByRole("button", { name: "Submit explicitly" }),
  ).toBeDisabled();
  await a.screenshot({
    path: info.outputPath("math-assistant-explicit-consent.png"),
  });
  await a.keyboard.press("Escape");
  await a.getByRole("button", { name: "Visual", exact: true }).click();
  await a.locator("math-field").click();
  await b.getByLabel("LaTeX source").click();
  await b.getByLabel("LaTeX source").press("ControlOrMeta+End");
  await b.keyboard.insertText(" + r");
  await expect(a.locator(".math-visual .tool-recovery")).toBeVisible();
  await a.locator("math-field").click();
  await a.keyboard.type("w");
  await expect(a.locator(".math-visual .tool-recovery pre")).toContainText("w");
  await expect.poll(source).toContain("+ r");
  expect(await source()).not.toContain("w");
  await a.getByRole("button", { name: "Source", exact: true }).click();
  expect(errors).toEqual([]);
  await b.close();
});
test("Math Studio source completes LaTeX, keeps snippet fields editable and rebases peer changes", async ({}, info) => {
  test.setTimeout(90000);
  const project = await call(f.member.request, "tools", {
    kind: "math",
    name: "Source completion",
    spaceId,
    source: "",
    mutationId: randomUUID(),
  });
  const page = f.page,
    peer = await f.owner.newPage(),
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/workbench/tools/math/${project.id}`);
  await peer.goto(`/workbench/tools/math/${project.id}`);
  await expect(page.locator(".studio-status")).toContainText("Saved on server");
  await expect(peer.locator(".studio-status")).toContainText("Saved on server");
  const source = page.getByRole("textbox", {
    name: "LaTeX source",
    exact: true,
  });
  const popup = page.locator(".studio-math-completions");
  const text = (target: typeof source) =>
    target.evaluate((element) => {
      const clone = element.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll(".axiom-peer-caret")
        .forEach((caret) => caret.remove());
      return Array.from(
        clone.querySelectorAll(".cm-line"),
        (line) => line.textContent,
      ).join("\n");
    });
  const reset = async (value = "") => {
    await source.click();
    await source.press("ControlOrMeta+a");
    await source.press("Backspace");
    if (value) await page.keyboard.insertText(value);
  };
  await source.click();
  await page.keyboard.type("\\fr");
  await expect(popup.getByRole("option").first()).toContainText("\\frac");
  await expect(popup.locator('[data-math-symbol="frac"] svg')).toBeVisible();
  await page.screenshot({
    path: info.outputPath("math-source-autocomplete.png"),
  });
  await source.press("Tab");
  await page.keyboard.type("2");
  await expect(source).toHaveText("\\frac{2}{denominator}");
  await source.press("Tab");
  await page.keyboard.type("3");
  await source.press("Shift+Tab");
  await page.keyboard.type("4");
  await source.press("Tab");
  await source.press("Tab");
  await page.keyboard.type(" + ");
  await expect(source).toHaveText("\\frac{4}{3} + ");
  await page.keyboard.type("\\alp");
  await expect(popup.getByRole("option").first()).toContainText("\\alpha");
  await source.press("Enter");
  await expect(source).toHaveText("\\frac{4}{3} + \\alpha");
  await source.press("Enter");
  await page.keyboard.type("x");
  await expect(source.locator(".cm-line")).toHaveCount(2);
  await reset();
  await page.keyboard.type("\\beg");
  await expect(popup).toBeHidden();
  await page.keyboard.type("in{pm");
  await expect(popup.getByRole("option").first()).toContainText(
    "\\begin{pmatrix}",
  );
  await source.press("Enter");
  await expect(source).toContainText("\\end{pmatrix}");
  await page.keyboard.type("7");
  await expect(source).toContainText("7 & b");
  await reset();
  await page.keyboard.type("\\alp");
  await expect(popup).toBeVisible();
  await source.press("Escape");
  await expect(popup).toBeHidden();
  await source.press("Enter");
  await expect(source.locator(".cm-line")).toHaveCount(2);
  await reset("% comment ");
  await page.keyboard.type("\\fr");
  await source.press("Control+Space");
  await expect(popup).toBeHidden();
  await reset();
  await page.keyboard.type("\\fr");
  await expect(popup).toBeVisible();
  const other = peer.getByRole("textbox", {
    name: "LaTeX source",
    exact: true,
  });
  await expect.poll(() => text(other)).toBe("\\fr");
  await other.click();
  await other.press("ControlOrMeta+Home");
  await peer.keyboard.insertText("p + ");
  await expect.poll(() => text(source)).toBe("p + \\fr");
  await source.press("Control+Space");
  await expect(popup).toBeVisible();
  await source.press("Tab");
  await expect
    .poll(() => text(source))
    .toBe("p + \\frac{numerator}{denominator}");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => text(source)).toBe("p + \\fr");
  await expect.poll(() => text(other)).toBe("p + \\fr");
  expect(errors).toEqual([]);
  await peer.close();
});
test("Math library searches rendered templates, saves symbols and inserts at the source caret", async ({}, info) => {
  const project = await call(f.member.request, "tools", {
    kind: "math",
    name: "Math library",
    spaceId,
    source: "x + ",
    mutationId: randomUUID(),
  });
  const page = f.page;
  await page.goto(`/workbench/tools/math/${project.id}`);
  await expect(page.locator(".studio-status")).toContainText("Saved on server");
  const source = page.getByRole("textbox", {
      name: "LaTeX source",
      exact: true,
    }),
    library = page.getByRole("complementary", { name: "Math library" }),
    search = library.getByRole("textbox", { name: "Search math library" });
  await library.getByRole("tab", { name: "Saved", exact: true }).click();
  await expect(library.getByText("Save your go-to symbols")).toBeVisible();
  await search.fill("alpha");
  await expect(library.locator(".math-symbol-insert")).toHaveCount(0);
  await library.getByRole("tab", { name: "Symbols", exact: true }).click();
  await expect(library.locator(".math-symbol-insert")).toHaveCount(1);
  await library
    .getByRole("button", { name: "Save alpha", exact: true })
    .click();
  await library.getByRole("tab", { name: "Saved", exact: true }).click();
  await expect(
    library.getByRole("button", { name: "alpha", exact: true }),
  ).toBeVisible();
  await source.click();
  await source.press("ControlOrMeta+End");
  await library.getByRole("button", { name: "alpha", exact: true }).click();
  await expect(source).toBeFocused();
  await page.keyboard.type(" + z");
  await expect(source).toHaveText("x + \\alpha + z");
  await library.getByRole("tab", { name: "Templates", exact: true }).click();
  await search.fill("bayes");
  await expect(library.locator(".math-template")).toHaveCount(1);
  await expect(
    library.locator('.math-template-preview [data-math-state="ready"] svg'),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("math-library-template-search.png"),
  });
  await library
    .getByRole("button", { name: "Insert Bayes' theorem", exact: true })
    .click();
  await expect(source).toBeFocused();
  await expect(source).toContainText("x + \\alpha + zP(A \\mid B)");
  await page.keyboard.type(" + q");
  await expect(source).toContainText(" + q");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).toHaveText("x + \\alpha + z");
  await search.fill("");
  await expect(library.locator(".math-template")).toHaveCount(10);
  await library.locator(".math-library-results").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: info.outputPath("math-library-templates.png"),
  });
  await library.getByRole("tab", { name: "Symbols", exact: true }).click();
  await library.getByLabel("Symbol category").selectOption("Greek");
  await page.screenshot({ path: info.outputPath("math-library-symbols.png") });
  // Preview a dark token set in this disposable fixture only, without saving preferences.
  const paperBefore = await library.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await page.evaluate(
    (variables) => {
      document.documentElement.dataset.theme = "dark";
      for (const [key, value] of Object.entries(variables))
        document.documentElement.style.setProperty(key, value);
    },
    appearanceVariables(defaults, true),
  );
  await expect
    .poll(() =>
      library.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .not.toBe(paperBefore);
  await expect(library.locator(".math-symbol-insert").first()).toHaveCSS(
    "background-color",
    await library.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  );
  await page.screenshot({
    path: info.outputPath("math-library-symbols-dark.png"),
    animations: "disabled",
  });
  await library.getByRole("tab", { name: "Templates", exact: true }).click();
  await expect(
    library
      .locator('.math-template-preview [data-math-state="ready"] svg')
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("math-library-templates-dark.png"),
    animations: "disabled",
  });
});
test("Math Studio returns equations through guarded CRDT anchors without overwriting peer changes", async ({}, info) => {
  test.setTimeout(120000);
  const note = await call(f.member.request, "notes", {
    groupId: f.group.id,
    title: "Equation round trip",
    body: "# Linking tools\n\n> $$\n> x^2\n> $$\n\nUnchanged paragraph.\n",
  });
  const page = f.page,
    peer = await f.owner.newPage();
  const body = async () =>
    (await call(f.member.request, `notes/${note.id}`)).body as string;
  await page.goto(`/workbench/notes/${note.id}`);
  await peer.goto(`/workbench/notes/${note.id}`);
  await expect(page.locator(".ws-document-status")).toContainText(
    "Saved on server",
  );
  await page
    .getByRole("button", { name: "equations panel", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open in Math Studio", exact: true })
    .click();
  await expect(page.locator(".studio-status")).toContainText("Saved on server");
  await page.getByLabel("LaTeX source").click();
  await page.getByLabel("LaTeX source").press("ControlOrMeta+End");
  await page.keyboard.insertText(" + c");
  await peer.getByRole("button", { name: "Source", exact: true }).click();
  const editor = peer.getByRole("textbox", {
    name: "Markdown source",
    exact: true,
  });
  await editor.click();
  await editor.press("ControlOrMeta+Home");
  await peer.keyboard.insertText("Peer introduction.\n\n");
  await expect.poll(body).toContain("Peer introduction");
  await page
    .getByRole("button", { name: "Review in note", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review equation from Math Studio",
  });
  await expect(review).toBeVisible();
  await review
    .getByRole("button", { name: "Apply to original equation", exact: true })
    .click();
  await expect.poll(body).toContain("> x^2 + c\n> $$");
  expect(await body()).toContain("Peer introduction");
  await expect(review).not.toBeVisible();
  await page
    .getByRole("button", { name: "Open in Math Studio", exact: true })
    .click();
  await expect(page.locator(".studio-status")).toContainText("Saved on server");
  await page.getByLabel("LaTeX source").click();
  await page.getByLabel("LaTeX source").press("ControlOrMeta+End");
  await page.keyboard.insertText(" + d");
  const replacement = (await body()).replace("x^2 + c", "y^3");
  await editor.click();
  await editor.press("ControlOrMeta+a");
  await peer.keyboard.insertText(replacement);
  await expect.poll(body).toBe(replacement);
  await page
    .getByRole("button", { name: "Review in note", exact: true })
    .click();
  await review
    .getByRole("button", { name: "Apply to original equation", exact: true })
    .click();
  await expect(review).toContainText("Nothing was overwritten");
  expect(await body()).toBe(replacement);
  await page.screenshot({
    path: info.outputPath("equation-stale-return-protected.png"),
  });
  await review.getByRole("button", { name: "Keep note unchanged" }).click();
  await peer.close();
});
test("media, text, CSV, XLSX and private Office previews use one version-bound viewer", async ({}, info) => {
  test.setTimeout(120000);
  const upload = async (name: string, bytes: Buffer) => {
    const id = randomUUID();
    await call(f.member.request, "uploads", {
      id,
      spaceId,
      name,
      bytes: bytes.length,
    });
    const chunk = await f.member.request.put(`/api/v1/uploads/${id}/chunks/1`, {
      headers: { origin, "content-type": "application/octet-stream" },
      data: bytes,
    });
    expect(chunk.ok(), await chunk.text()).toBeTruthy();
    await call(f.member.request, `uploads/${id}/complete`, {});
    await expect
      .poll(
        async () => (await call(f.member.request, `uploads/${id}`)).status,
        { timeout: 30000 },
      )
      .toBe("complete");
    return (await call(f.member.request, `uploads/${id}`)).resourceId as string;
  };
  const text = await upload(
    "research-log.txt",
    Buffer.from("alpha\nbeta target\ngamma\n"),
  );
  await f.page.goto(`/workbench/files/${text}`);
  await expect(f.page.locator(".text-preview-lines")).toContainText(
    "beta target",
  );
  await f.page.getByLabel("Search file").fill("target");
  await expect(f.page.locator(".text-preview-lines")).toContainText(
    "1 matching lines",
  );
  const csv = await upload(
    "observations.csv",
    Buffer.from('x,y\n1,"a,b"\n2,3\n'),
  );
  await f.page.goto(`/workbench/files/${csv}`);
  await expect(
    f.page.getByRole("cell", { name: "a,b", exact: true }),
  ).toBeVisible();
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("Results");
  sheet.addRow(["Mass", "Energy"]);
  sheet.addRow([2, { formula: "A2*3", result: 6 }]);
  const xlsx = await upload(
    "results.xlsx",
    Buffer.from(await workbook.xlsx.writeBuffer()),
  );
  expect((await call(f.member.request, `files/${xlsx}/preview`)).kind).toBe(
    "workbook",
  );
  await f.page.goto(`/workbench/files/${xlsx}`);
  await expect(
    f.page.getByLabel("Workbook sheet", { exact: true }),
  ).toContainText("Results");
  await expect(
    f.page.getByRole("cell", { name: "6", exact: true }),
  ).toBeVisible();
  await expect(f.page.locator(".tool-controls label").first()).toHaveCSS(
    "flex-direction",
    "row",
  );
  const rowHeader = await f.page
    .locator(".data-preview thead th")
    .first()
    .boundingBox();
  expect(rowHeader!.width).toBeGreaterThanOrEqual(48);
  expect(rowHeader!.width).toBeLessThanOrEqual(52);
  await f.page.screenshot({ path: info.outputPath("xlsx-cached-values.png") });
  const audio = Buffer.alloc(8044);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(8000, 28);
  audio.writeUInt16LE(1, 32);
  audio.writeUInt16LE(8, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(8000, 40);
  audio.fill(128, 44);
  const wav = await upload("recording.wav", audio);
  expect((await call(f.member.request, `files/${wav}/preview`)).kind).toBe(
    "audio",
  );
  await f.page.goto(`/workbench/files/${wav}`);
  await expect(f.page.locator("audio")).toBeVisible();
  await f.page.getByLabel("Speed").selectOption("1.5");
  expect(
    await f.page
      .locator("audio")
      .evaluate((a: HTMLAudioElement) => a.playbackRate),
  ).toBe(1.5);
  await f.page.getByLabel("Loop", { exact: true }).check();
  await expect(f.page.locator("audio")).toHaveJSProperty("loop", true);
  await f.page.screenshot({ path: info.outputPath("audio-viewer.png") });
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
  );
  const docx = await upload(
    "document.docx",
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  const manifest = await call(f.member.request, `files/${docx}/preview`);
  expect(manifest.kind).toBe("office");
  await f.page.goto(`/workbench/files/${docx}`);
  await expect(
    f.page.getByRole("button", { name: "Generate private preview" }),
  ).toBeVisible();
  const response = await f.member.request.post(
    `/api/v1/files/${docx}/preview-convert`,
    { headers: { origin }, data: {} },
  );
  expect([202, 503]).toContain(response.status());
  if (response.status() === 503)
    expect(await response.text()).toContain("not been configured");
  const wrong = await f.member.request.get(
    `/api/v1/files/${text}/preview?version=${(await call(f.member.request, `files/${csv}/versions`))[0].id}`,
  );
  expect(wrong.status()).toBe(404);
  await f.page.goto("/workbench/tools/viewer");
  await f.page.getByLabel("Find a file to preview").fill("observations.csv");
  await f.page.getByRole("button", { name: /observations.csv/ }).click();
  await expect(
    f.page.getByRole("cell", { name: "a,b", exact: true }),
  ).toBeVisible();
  await f.page.screenshot({ path: info.outputPath("unified-file-viewer.png") });
});
test("Image Studio paints, undoes, persists immutable versions and fences another editor", async ({}, info) => {
  test.setTimeout(90000);
  const project = await call(f.member.request, "tools", {
    kind: "image",
    name: "Layered figure " + randomUUID().slice(0, 5),
    spaceId,
    mutationId: randomUUID(),
  });
  const page = f.page;
  await page.goto(`/workbench/tools/image/${project.id}`);
  await expect(page.locator(".studio-status")).toContainText(
    /lease acquired|Draft saved/,
  );
  const paint = page.getByRole("button", { name: "Brush (B)", exact: true });
  await paint.click();
  const canvas = page.locator(".image-overlay"),
    box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 90, { steps: 6 });
  await page.mouse.up();
  const alpha = () =>
    page
      .locator('canvas[aria-label="Image canvas"]')
      .evaluate((c: HTMLCanvasElement) =>
        c
          .getContext("2d")!
          .getImageData(0, 0, c.width, c.height)
          .data.reduce((sum, v, i) => sum + (i % 4 === 3 ? v : 0), 0),
      );
  expect(await alpha()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await alpha()).toBe(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect(await alpha()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Save version", exact: true }).click();
  await expect(page.locator(".studio-status")).toContainText(
    "Saved as a new cloud version",
  );
  const saved = await call(f.member.request, `tools/${project.id}`);
  expect(saved.current_version_id).toBeTruthy();
  expect(
    (await call(f.member.request, `files/${project.id}/preview`)).kind,
  ).toBe("image");
  const contender = await f.owner.request.post(
    `/api/v1/tools/${project.id}/lease`,
    { headers: { origin }, data: {} },
  );
  expect(contender.status()).toBe(409);
  await page.getByRole("button", { name: "Add layer", exact: true }).click();
  await expect(page.locator(".image-layer")).toHaveCount(2);
  await page.getByRole("button", { name: "Save version", exact: true }).click();
  await expect(page.locator(".studio-status")).toContainText(
    "Saved as a new cloud version",
  );
  const versions = await call(f.member.request, `files/${project.id}/versions`);
  // Every new drawing now has an immediately downloadable blank version,
  // followed by the two immutable saves performed above.
  expect(versions).toHaveLength(3);
  expect(versions.at(-1).ordinal).toBe(1);
  expect(versions[0].id).not.toBe(versions[1].id);
  await page.locator(".image-layer").first().click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Layer actions" })).toBeVisible();
  await expect(page.getByRole("menu").getByRole("separator")).toHaveCount(2);
  await page.screenshot({
    path: info.outputPath("image-studio-layer-menu.png"),
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PSD", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.psd$/);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: info.outputPath("image-studio-light.png") });
  await page.getByRole("button", { name: "Add layer", exact: true }).click();
  await page.getByRole("link", { name: "Back to tools" }).click();
  const guard = page.getByRole("dialog", {
    name: "Keep your image draft before leaving",
  });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Keep draft & leave" }).click();
  await expect(page).toHaveURL(/\/workbench\/tools$/);
  await page.goto(`/workbench/tools/image/${project.id}`);
  const recovery = page.getByRole("dialog", {
    name: "Restore local image draft?",
  });
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  await expect(page.locator(".image-layer")).toHaveCount(3);
  expect(
    await call(f.member.request, `files/${project.id}/versions`),
  ).toHaveLength(3);
  await page.getByRole("button", { name: "Save version", exact: true }).click();
  await expect(page.locator(".studio-status")).toContainText(
    "Saved as a new cloud version",
  );
  await page.goto(`/workbench/files/${project.id}`);
  await expect(page.locator(".image-preview-stage img")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Image Studio" }),
  ).toBeVisible();
  const original = await f.member.request.get(
    `/api/v1/files/${project.id}/content?version=${saved.current_version_id}`,
  );
  const bundle = (await original.body()).toString("base64");
  const acquired = await call(f.owner.request, `tools/${project.id}/lease`, {});
  const stale = await f.owner.request.post(`/api/v1/tools/${project.id}/save`, {
    headers: { origin },
    data: {
      token: acquired.token,
      fence: acquired.fence,
      expectedVersion: saved.current_version_id,
      mutationId: randomUUID(),
      bundle,
    },
  });
  expect(stale.status()).toBe(409);
  await call(f.owner.request, `tools/${project.id}/lease`, {
    token: acquired.token,
    release: true,
  });
  const replaced = await call(f.owner.request, `tools/${project.id}/lease`, {});
  expect(replaced.fence).toBeGreaterThan(acquired.fence);
  const expired = await f.owner.request.post(
    `/api/v1/tools/${project.id}/save`,
    {
      headers: { origin },
      data: {
        token: acquired.token,
        fence: acquired.fence,
        expectedVersion: (await call(f.owner.request, `tools/${project.id}`))
          .current_version_id,
        mutationId: randomUUID(),
        bundle,
      },
    },
  );
  expect(expired.status()).toBe(409);
  expect(
    await call(f.member.request, `files/${project.id}/versions`),
  ).toHaveLength(4);
  await call(f.owner.request, `tools/${project.id}/lease`, {
    token: replaced.token,
    release: true,
  });
  const originalResource = await call(
    f.member.request,
    `resources/${project.id}`,
  );
  const copy = await call(f.member.request, `resources/${project.id}/copy`, {
    version: originalResource.version,
    destinationSpaceId: spaceId,
    mutationId: randomUUID(),
  });
  expect((await call(f.member.request, `tools/${copy.id}`)).kind).toBe("image");
  expect((await call(f.member.request, `files/${copy.id}/preview`)).kind).toBe(
    "image",
  );
  expect(await call(f.member.request, `tools/${copy.id}/lease`)).toBeNull();
});
test("Tool access, no-consent jobs and private preview requests enforce boundaries", async () => {
  const own = await call(f.owner.request, "spaces"),
    personal = own.find((s: any) => s.kind === "personal");
  const privateProject = await call(f.owner.request, "tools", {
    kind: "math",
    name: "Private math",
    spaceId: personal.id,
    source: "private",
    mutationId: randomUUID(),
  });
  expect(
    (await f.member.request.get(`/api/v1/tools/${privateProject.id}`)).status(),
  ).toBe(404);
  const input = {
    kind: "math",
    name: "Exactly once",
    spaceId,
    source: "x",
    mutationId: randomUUID(),
  };
  const first = await call(f.member.request, "tools", input);
  expect((await call(f.member.request, "tools", input)).id).toBe(first.id);
  const resource = await call(f.member.request, `resources/${first.id}`);
  const copy = await call(f.member.request, `resources/${first.id}/copy`, {
    version: resource.version,
    destinationSpaceId: spaceId,
    mutationId: randomUUID(),
  });
  expect((await call(f.member.request, `tools/${copy.id}`)).kind).toBe("math");
  const copiedNote = await call(f.member.request, `notes/${copy.id}`);
  expect(copiedNote.source_format).toBe("latex");
  expect(copiedNote.body).toBe("x");
  const noConsent = await f.member.request.post("/api/v1/tool-jobs", {
    headers: { origin },
    data: {
      resourceId: first.id,
      providerId: randomUUID(),
      kind: "generate",
      source: "x",
      prompt: "test",
    },
  });
  expect(noConsent.status()).toBe(400);
  const provider = await f.member.request.post(
    `/api/v1/group-admin/${f.group.id}/providers`,
    { headers: { origin }, data: {} },
  );
  expect(provider.status()).toBe(403);
  const state = await call(
    f.owner.request,
    `group-admin/${f.group.id}/providers`,
  );
  expect(JSON.stringify(state)).not.toMatch(/credential|Bearer/);
});
