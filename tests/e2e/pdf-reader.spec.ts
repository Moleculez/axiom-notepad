import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
const { PDFDocument, StandardFonts, PDFName, PDFString } = createRequire(
  import.meta.url,
)("pdf-lib") as typeof import("pdf-lib");
import { randomUUID } from "node:crypto";
import { signInOwner } from "./auth";
const origin = process.env.TEST_APP_URL;
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "PDF acceptance requires the isolated staging service on port 3004.",
    );
});
test("research reader navigation, search, private notes, bookmarks, split view and page-copy export", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const login = await signInOwner(context.request, origin!);
  expect(login.ok(), await login.text()).toBeTruthy();
  const post = async (path: string, data: unknown) => {
    const r = await context.request.post(`/api/v1/${path}`, {
      headers: { origin: origin! },
      data,
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const group = await post("groups", {
    name: `Paper lab ${randomUUID().slice(0, 6)}`,
  });
  const note = await post("notes", {
    groupId: group.id,
    title: "PDF fixture",
    body: "# Unchanged research\n",
  });
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 12; n++) {
    const page = doc.addPage([500, 700]);
    page.drawText(`Research paper - Page ${n}`, {
      x: 40,
      y: 630,
      font,
      size: 20,
    });
    page.drawText("Energy evidence. Energy assumptions.", {
      x: 40,
      y: 570,
      font,
      size: 14,
    });
  }
  const outlineRoot = doc.context.obj({ Type: "Outlines" });
  const outlineRef = doc.context.register(outlineRoot);
  const sections = [
    { title: "1 Introduction", page: 1, depth: 0 },
    { title: "2 Experimental methods", page: 4, depth: 0 },
    { title: "2.1 Measurement design", page: 4, depth: 1 },
    { title: "2.2 Instrument calibration and uncertainty", page: 5, depth: 1 },
    { title: "3 Results and limitations", page: 9, depth: 0 },
  ];
  const nodes = sections.map((s) =>
    doc.context.obj({
      Title: PDFString.of(s.title),
      Dest: [doc.getPage(s.page - 1).ref, "Fit"],
    }),
  );
  const refs = nodes.map((n) => doc.context.register(n));
  const connect = (
    indices: number[],
    parent: typeof outlineRoot,
    parentRef: typeof outlineRef,
  ) => {
    parent.set(PDFName.of("First"), refs[indices[0]]);
    parent.set(PDFName.of("Last"), refs[indices.at(-1)!]);
    parent.set(PDFName.of("Count"), doc.context.obj(indices.length));
    indices.forEach((n, i) => {
      nodes[n].set(PDFName.of("Parent"), parentRef);
      if (i) nodes[n].set(PDFName.of("Prev"), refs[indices[i - 1]]);
      if (i + 1 < indices.length)
        nodes[n].set(PDFName.of("Next"), refs[indices[i + 1]]);
    });
  };
  connect([0, 1, 4], outlineRoot, outlineRef);
  connect([2, 3], nodes[1], refs[1]);
  doc.catalog.set(PDFName.of("Outlines"), outlineRef);
  const bytes = await doc.save();
  const response = await context.request.post(
    `/api/v1/notes/${note.id}/attachments`,
    {
      headers: { origin: origin! },
      multipart: {
        file: {
          name: "reader-fixture.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(bytes),
        },
      },
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  const attachment = await response.json(),
    metaResponse = await context.request.get(
      `/api/v1/attachments/${attachment.id}/meta`,
    ),
    meta = await metaResponse.json();
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(
      `/workbench/pdf/${meta.resource_id}?version=${attachment.id}`,
    );
    const reader = page.getByRole("region", { name: "Paper reader" });
    await expect(
      reader.locator('[data-pdf-page="1"] .paper-page'),
    ).toHaveAttribute("data-rendered", "true");
    await expect(
      reader.getByRole("navigation", { name: "Reading navigator" }),
    ).toBeVisible();
    const selectWord = async () => {
      await reader
        .locator('[data-pdf-page="1"] .textLayer')
        .evaluate((layer) => {
          const text = [...layer.querySelectorAll("span")].find((el) =>
            el.textContent?.includes("Energy"),
          )!.firstChild!;
          const range = document.createRange();
          range.setStart(text, 0);
          range.setEnd(text, 6);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          layer.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        });
    };
    await selectWord();
    await expect(
      reader.getByRole("toolbar", { name: "Selected text actions" }),
    ).toBeVisible();
    await expect(
      reader.getByRole("region", { name: "Annotation editor" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("reader-selection.png"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(
      reader.getByRole("toolbar", { name: "Selected text actions" }),
    ).toHaveCount(0);
    await selectWord();
    await reader
      .getByRole("button", {
        name: "Add note to selected PDF text",
        exact: true,
      })
      .click();
    await expect(
      reader.getByRole("region", { name: "Annotation editor" }),
    ).toBeVisible();
    await reader
      .getByRole("button", { name: "Cancel annotation", exact: true })
      .click();
    await reader.getByRole("button", { name: "Outline", exact: true }).click();
    await selectWord();
    await reader
      .getByRole("button", {
        name: "Highlight privately in yellow",
        exact: true,
      })
      .click();
    await expect(
      reader.getByRole("toolbar", { name: "Selected text actions" }),
    ).toHaveCount(0);
    await expect(
      reader.getByRole("region", { name: "Annotation editor" }),
    ).toHaveCount(0);
    await expect(
      reader.getByRole("button", { name: "Outline", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const outline = reader.getByRole("region", {
      name: "Document outline",
      exact: true,
    });
    await expect(
      outline.getByRole("button", {
        name: "2.2 Instrument calibration and uncertainty",
      }),
    ).toBeVisible();
    await outline
      .getByRole("button", {
        name: "Collapse 2 Experimental methods",
        exact: true,
      })
      .click();
    await expect(
      outline.getByRole("button", {
        name: "2.2 Instrument calibration and uncertainty",
      }),
    ).toHaveCount(0);
    await outline
      .getByRole("button", {
        name: "Expand 2 Experimental methods",
        exact: true,
      })
      .click();
    await outline
      .getByRole("button", {
        name: "2.2 Instrument calibration and uncertainty",
      })
      .click();
    await expect(reader.locator(".pdf-statusbar")).toContainText(
      "Page 5 of 12",
    );
    await expect(outline.locator('[aria-current="location"]')).toContainText(
      "Instrument calibration",
    );
    await page.screenshot({
      path: info.outputPath("reader-outline.png"),
      fullPage: true,
    });
    await outline
      .getByRole("button", { name: "Filter outline", exact: true })
      .click();
    await outline.getByLabel("Search PDF outline").fill("calibration");
    await expect(
      outline.getByRole("button", { name: "1 Introduction" }),
    ).toHaveCount(0);
    await expect(
      outline
        .locator(".pdf-outline-link")
        .filter({ hasText: "2 Experimental methods" }),
    ).toBeVisible();
    await reader.getByLabel("Go to PDF page", { exact: true }).fill("6");
    await reader.getByLabel("Go to PDF page", { exact: true }).press("Enter");
    await expect(reader.locator(".pdf-statusbar")).toContainText(
      "Page 6 of 12",
    );
    await expect(
      reader.locator('[data-pdf-page="6"] .textLayer'),
    ).toContainText("Page 6");
    await reader
      .getByRole("button", { name: "Find in paper", exact: true })
      .click();
    await reader.getByLabel("Search PDF text", { exact: true }).fill("Energy");
    await reader.getByRole("button", { name: "Find", exact: true }).click();
    await expect(
      reader.getByRole("status").filter({ hasText: "24 results" }),
    ).toBeVisible();
    const selectedHit = reader.locator(
      '[data-pdf-page="1"] .pdf-search-overlays .is-current',
    );
    await expect(selectedHit).toHaveCount(1);
    const firstHit = await selectedHit.boundingBox();
    await reader
      .getByRole("button", { name: "Next search result", exact: true })
      .click();
    await expect
      .poll(async () => (await selectedHit.boundingBox())?.x ?? 0)
      .toBeGreaterThan(firstHit!.x + 10);
    await reader
      .getByRole("button", { name: "Page note", exact: true })
      .click();
    await reader
      .getByLabel("Annotation note", { exact: true })
      .fill("Check the measurement assumptions.");
    await reader
      .getByRole("button", { name: "Save privately", exact: true })
      .click();
    await expect(
      reader
        .locator(".annotation-card")
        .filter({ hasText: "Check the measurement assumptions." }),
    ).toContainText("Check the measurement assumptions.");
    await expect
      .poll(
        async () =>
          (
            await (
              await context.request.get(
                `/api/v1/attachments/${attachment.id}/annotations`,
              )
            ).json()
          ).length,
      )
      .toBe(2);
    await reader.getByRole("button", { name: "Bookmark", exact: true }).click();
    const label = reader.getByLabel("Bookmark label for page 1", {
      exact: true,
    });
    await label.fill("Key assumptions");
    await label.press("Tab");
    await expect(label).toHaveValue("Key assumptions");
    await reader
      .getByRole("button", { name: "Split reading view", exact: true })
      .click();
    await expect(reader.locator(".pdf-secondary-surface")).toBeVisible();
    await reader
      .getByRole("button", { name: "Next reference page", exact: true })
      .click();
    await expect(reader.locator(".pdf-secondary-toolbar")).toContainText(
      "2 / 12",
    );
    await reader
      .getByRole("button", { name: "Close split view", exact: true })
      .click();
    await reader
      .getByRole("button", {
        name: "Reader view and file actions",
        exact: true,
      })
      .click();
    await reader.getByLabel("PDF paper appearance").selectOption("warm");
    await reader.getByLabel("PDF page layout").selectOption("single");
    await reader
      .getByRole("button", { name: "Paper assistant", exact: true })
      .click();
    await expect(
      reader.getByRole("complementary", { name: "Paper assistant" }),
    ).toBeVisible();
    await reader
      .getByRole("button", { name: "Prepare context locally", exact: true })
      .click();
    await expect(reader.locator(".pdf-evidence")).toContainText(
      "Review before sending",
    );
    await expect(
      reader.getByRole("button", { name: "Submit once", exact: true }),
    ).toBeDisabled();
    await reader
      .getByRole("button", { name: "Close paper assistant", exact: true })
      .click();
    await page.screenshot({
      path: info.outputPath("reader-warm.png"),
      fullPage: true,
    });
    await reader
      .getByRole("button", { name: "Organize pages", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Organize PDF pages" });
    await dialog.getByLabel("Select page range").fill("2-3");
    await dialog.getByRole("button", { name: "Select", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Keep selected", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Rotate page 1", exact: true })
      .click();
    const completed = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Download arranged copy", exact: true })
      .click();
    const downloaded = await completed;
    const stream = await downloaded.createReadStream(),
      chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const exported = await PDFDocument.load(Buffer.concat(chunks));
    expect(exported.getPageCount()).toBe(2);
    expect(exported.getPage(0).getRotation().angle).toBe(90);
    expect(
      Buffer.from(
        await (
          await context.request.get(`/api/v1/attachments/${attachment.id}`)
        ).body(),
      ),
    ).toEqual(Buffer.from(bytes));
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
