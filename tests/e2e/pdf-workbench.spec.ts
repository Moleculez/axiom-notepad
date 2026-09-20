import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fixture, origin } from "./native-editor-helpers";
const { PDFDocument, StandardFonts, PDFName } = createRequire(import.meta.url)(
  "pdf-lib",
) as typeof import("pdf-lib");
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Use isolated PDF staging on port 3004.");
});
async function call(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const response = await request.fetch(`/api/v1/${path}`, {
    method,
    data,
    headers: { origin },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function pdfBytes(pages = 2) {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = pdf.addPage(n % 3 === 0 ? [420, 600] : [500, 700]);
    page.drawText(`Research evidence ${n}`, { x: 40, y: 500, size: 16, font });
  }
  if (pages >= 801) {
    const link = pdf.context.register(
      pdf.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [40, 640, 220, 675],
        Dest: [pdf.getPage(800).ref, PDFName.of("Fit")],
        Border: [0, 0, 0],
      }),
    );
    pdf.getPage(0).node.set(PDFName.of("Annots"), pdf.context.obj([link]));
  }
  return Buffer.from(await pdf.save());
}
async function upload(
  request: APIRequestContext,
  spaceId: string,
  bytes: Buffer,
  extra: Record<string, unknown> = {},
) {
  const id = randomUUID();
  await call(request, "uploads", {
    id,
    spaceId,
    name: "workbench-paper.pdf",
    bytes: bytes.length,
    ...extra,
  });
  const r = await request.put(`/api/v1/uploads/${id}/chunks/1`, {
    headers: { origin, "content-type": "application/octet-stream" },
    data: bytes,
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return id;
}
async function finish(
  request: APIRequestContext,
  id: string,
  status = "complete",
) {
  await call(request, `uploads/${id}/complete`, {});
  let result: any;
  await expect
    .poll(
      async () => {
        result = await call(request, `uploads/${id}`);
        return result.status;
      },
      { timeout: 90000 },
    )
    .toBe(status);
  return result;
}
test("replacement fences, recovery, annotation privacy, threads and atomic mapped copies", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = await fixture(browser, "# PDF safety\n");
  try {
    const space = (await call(f.member.request, "spaces")).find(
      (s: any) => s.group_id === f.group.id && s.kind === "team",
    );
    const bytes = await pdfBytes(),
      initial = await finish(
        f.member.request,
        await upload(f.member.request, space.id, bytes),
      ),
      file = await call(f.member.request, `resources/${initial.resourceId}`),
      hash = createHash("sha256").update(bytes).digest("hex");
    const markId = randomUUID(),
      markData = {
        kind: "area",
        page: 1,
        sha256: hash,
        rects: [[0.1, 0.2, 0.3, 0.4]],
        body: "Private evidence",
      };
    let mark = await call(
      f.member.request,
      `attachments/${file.current_version_id}/annotations/${markId}`,
      {
        id: markId,
        version: 0,
        mutation_id: randomUUID(),
        data: markData,
        shared: false,
      },
      "PUT",
    );
    expect(
      (await f.owner.request.get(`/api/v1/paper-threads/${markId}`)).status(),
    ).toBe(404);
    mark = await call(
      f.member.request,
      `attachments/${file.current_version_id}/annotations/${markId}`,
      {
        id: markId,
        version: mark.version,
        mutation_id: randomUUID(),
        data: markData,
        shared: true,
      },
      "PUT",
    );
    const reply = {
      action: "reply",
      id: randomUUID(),
      version: 0,
      mutationId: randomUUID(),
      body: "Peer observation",
    };
    expect(
      (await call(f.owner.request, `paper-threads/${markId}`, reply)).replies,
    ).toHaveLength(1);
    expect(
      (await call(f.owner.request, `paper-threads/${markId}`, reply)).replies,
    ).toHaveLength(1);
    expect(
      (
        await f.member.request.post(`/api/v1/paper-threads/${markId}`, {
          headers: { origin },
          data: {
            ...reply,
            version: 1,
            mutationId: randomUUID(),
            body: "Not my reply",
          },
        })
      ).status(),
    ).toBe(403);
    await call(
      f.member.request,
      `attachments/${file.current_version_id}/annotations/${markId}`,
      {
        id: markId,
        version: mark.version,
        mutation_id: randomUUID(),
        data: markData,
        shared: false,
      },
      "PUT",
    );
    expect(
      (await f.owner.request.get(`/api/v1/paper-threads/${markId}`)).status(),
    ).toBe(404);
    const current = (
      await call(
        f.member.request,
        `attachments/${file.current_version_id}/annotations`,
      )
    )[0];
    const copy = await finish(
      f.member.request,
      await upload(f.member.request, space.id, bytes, {
        provenance: {
          operation: "organize",
          sourceVersionId: file.current_version_id,
          sourceSha256: hash,
          pages: [
            { source: 0, page: 1, rotation: 0 },
            { source: 0, page: 2, rotation: 0 },
          ],
          annotations: [{ id: markId, version: current.version }],
        },
      }),
    );
    const copied = await call(f.member.request, `resources/${copy.resourceId}`),
      marks = await call(
        f.member.request,
        `attachments/${copied.current_version_id}/annotations`,
      );
    expect(marks).toHaveLength(1);
    expect(marks[0].shared).toBe(false);
    expect(marks[0].data.imported.sourceId).toContain(markId);
    expect(
      (await call(f.member.request, `paper-threads/${marks[0].id}`)).replies,
    ).toHaveLength(0);
    const replace = {
      resourceId: file.id,
      expectedVersionId: file.current_version_id,
      expectedResourceVersion: file.version,
    };
    const a = await upload(f.member.request, space.id, bytes, replace),
      b = await upload(f.member.request, space.id, bytes, replace);
    await finish(f.member.request, a);
    await finish(f.member.request, b, "failed");
    expect(
      await call(f.member.request, `files/${file.id}/versions`),
    ).toHaveLength(2);
    await call(f.member.request, `uploads/${b}/save-copy`, {
      name: "Recovered.pdf",
    });
    await expect
      .poll(async () => (await call(f.member.request, `uploads/${b}`)).status)
      .toBe("complete");
    expect(
      await call(f.member.request, `files/${file.id}/versions`),
    ).toHaveLength(2);
    const denied = await f.member.request.post("/api/v1/uploads", {
      headers: { origin },
      data: {
        id: randomUUID(),
        spaceId: space.id,
        name: "bad.pdf",
        bytes: bytes.length,
        resourceId: file.id,
      },
    });
    expect(denied.ok()).toBe(false);
  } finally {
    await f.close();
  }
});
test("1000-page virtualization, drawing, discussion, compare and saved copy UI", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const f = await fixture(browser, "# PDF interface\n");
  try {
    const space = (await call(f.member.request, "spaces")).find(
      (s: any) => s.group_id === f.group.id && s.kind === "team",
    );
    const initial = await finish(
        f.member.request,
        await upload(f.member.request, space.id, await pdfBytes(1000)),
      ),
      file = await call(f.member.request, `resources/${initial.resourceId}`);
    await f.page.goto(
      `/workbench/pdf/${file.id}?version=${file.current_version_id}`,
    );
    const reader = f.page.getByRole("region", { name: "Paper reader" });
    await expect(
      reader.locator('[data-pdf-page="1"] .paper-page'),
    ).toHaveAttribute("data-rendered", "true");
    expect(await reader.locator(".pdf-page-slot").count()).toBeLessThan(20);
    await reader.getByRole("button", { name: "Go to linked section" }).click();
    await expect(
      reader.locator('[data-pdf-page="801"] .paper-page'),
    ).toHaveAttribute("data-rendered", "true");
    await reader.getByLabel("Go to PDF page", { exact: true }).fill("801");
    await reader.getByLabel("Go to PDF page", { exact: true }).press("Enter");
    await expect(
      reader.locator('[data-pdf-page="801"] .paper-page'),
    ).toHaveAttribute("data-rendered", "true");
    expect(await reader.locator(".pdf-page-slot").count()).toBeLessThan(20);
    await reader.getByLabel("Drawing tool").selectOption("arrow");
    const layer = reader.locator('[data-pdf-page="801"] .pdf-drawing-layer'),
      box = (await layer.boundingBox())!;
    await f.page.mouse.move(box.x + 60, box.y + 60);
    await f.page.mouse.down();
    await f.page.mouse.move(box.x + 160, box.y + 110, { steps: 10 });
    await f.page.mouse.up();
    await expect
      .poll(
        async () =>
          (
            await call(
              f.member.request,
              `attachments/${file.current_version_id}/annotations`,
            )
          ).filter((a: any) => a.data.kind === "arrow").length,
      )
      .toBe(1);
    await reader.getByLabel("Drawing tool").selectOption("");
    await reader.getByRole("button", { name: "Discuss", exact: true }).click();
    const thread = f.page.getByRole("dialog", {
      name: "Annotation discussion",
    });
    await thread
      .getByRole("textbox", { name: "Reply" })
      .fill("Check boundary conditions.");
    await thread
      .getByRole("button", { name: "Add reply", exact: true })
      .click();
    await expect(
      thread.getByText("Check boundary conditions.", { exact: true }),
    ).toBeVisible();
    await thread.getByRole("button", { name: "Edit", exact: true }).click();
    await thread
      .getByRole("textbox", { name: "Edit reply" })
      .fill("Reviewed boundary conditions.");
    await thread
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      thread.getByText("Reviewed boundary conditions.", { exact: true }),
    ).toBeVisible();
    await thread.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(
      thread.getByText("Reviewed boundary conditions.", { exact: true }),
    ).toHaveCount(0);
    await f.page.keyboard.press("Escape");
    await reader
      .getByRole("button", {
        name: "Reader view and file actions",
        exact: true,
      })
      .click();
    await reader
      .getByRole("button", { name: "Compare PDFs…", exact: true })
      .click();
    const compare = f.page.getByRole("dialog", {
      name: "Compare PDFs",
      exact: true,
    });
    await expect(
      compare.locator('.pdf-page-slot[data-pdf-page="1"]'),
    ).toHaveCount(2);
    await compare.getByLabel("Comparison page").fill("2");
    await expect(compare.getByLabel("Original page")).toHaveValue("2");
    for (const surface of await compare
      .locator('[data-pdf-page="2"] .paper-page')
      .all())
      await expect(surface).toHaveAttribute("data-rendered", "true");
    await f.page.screenshot({ path: info.outputPath("comparison.png") });
    await f.page.keyboard.press("Escape");
    await reader
      .getByRole("button", {
        name: "Reader view and file actions",
        exact: true,
      })
      .click();
    await reader
      .getByRole("button", { name: "Organize pages", exact: true })
      .click();
    const organizer = f.page.getByRole("dialog", {
      name: "Organize PDF pages",
    });
    await organizer.getByLabel("Select page range").fill("800-802");
    await organizer
      .getByRole("button", { name: "Select", exact: true })
      .click();
    await organizer
      .getByRole("button", { name: "Keep selected", exact: true })
      .click();
    await organizer
      .getByRole("button", { name: "Save to workspace…", exact: true })
      .click();
    const save = f.page.getByRole("dialog", { name: "Save PDF", exact: true });
    await save.getByLabel("File name").fill("Mapped reader copy.pdf");
    await save.getByLabel(/Copy 1 visible annotations/).check();
    const uploadAttempts = new Set<string>();
    let loseResponse = true;
    await f.page.route("**/api/v1/uploads", async (route) => {
      if (route.request().method() === "POST")
        uploadAttempts.add(route.request().postDataJSON().id);
      await route.continue();
    });
    await f.page.route("**/api/v1/uploads/*/complete", async (route) => {
      if (!loseResponse) return route.continue();
      loseResponse = false;
      await route.fetch(); // The server accepts it; deliberately lose the acknowledgement.
      await route.abort("failed");
    });
    await save.getByRole("button", { name: "Save PDF", exact: true }).click();
    await expect(save.getByRole("alert")).toBeVisible();
    await save
      .getByRole("button", { name: "Retry / check save", exact: true })
      .click();
    await expect(
      save.getByRole("link", { name: "Open saved PDF" }),
    ).toBeVisible();
    expect(uploadAttempts.size).toBe(1);
    await f.page.screenshot({ path: info.outputPath("saved-copy.png") });
  } finally {
    await f.close();
  }
});

test("OCR review interface retains corrections, previews equations and creates a private note", async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  const f = await fixture(browser, "# OCR interface\n");
  try {
    const space = (await call(f.member.request, "spaces")).find(
      (s: any) => s.group_id === f.group.id && s.kind === "team",
    );
    const uploaded = await finish(
      f.member.request,
      await upload(f.member.request, space.id, await pdfBytes()),
    );
    const file = await call(
      f.member.request,
      `resources/${uploaded.resourceId}`,
    );
    const id = randomUUID();
    const job = {
      id,
      version_id: file.current_version_id,
      status: "complete",
      settings: {
        pages: [1, 2],
        language: "eng",
        research: true,
        searchable: false,
      },
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      completed_pages: 2,
      output_bytes: 0,
      pages: [1, 2].map((page) => ({
        page,
        text: "Machine guess $$E=mc^2$$",
        reviewed_text: null as string | null,
        reviewed: false,
        native: false,
        version: 1,
      })),
    };
    // UI transport fixture only. Real queue/ACL/checkpoints have their own DB rehearsal.
    await f.page.route("**/api/v1/pdf-ocr**", async (route) => {
      const url = new URL(route.request().url());
      let result: unknown = job;
      if (url.pathname.endsWith("capabilities"))
        result = { available: true, research: true, languages: ["eng"] };
      else if (url.pathname.endsWith("/pages")) {
        const input = route.request().postDataJSON();
        const page = job.pages.find((p) => p.page === input.page)!;
        page.reviewed_text = input.text;
        page.reviewed = true;
        page.version++;
        result = page;
      } else if (url.search) result = [job];
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(result),
      });
    });
    await f.page.goto(
      `/workbench/pdf/${file.id}?version=${file.current_version_id}`,
    );
    const reader = f.page.getByRole("region", { name: "Paper reader" });
    await reader
      .getByRole("button", {
        name: "Reader view and file actions",
        exact: true,
      })
      .click();
    await reader
      .getByRole("button", { name: "Batch OCR…", exact: true })
      .click();
    const panel = f.page.getByRole("dialog", {
      name: "Batch OCR & research text",
      exact: true,
    });
    await panel.getByLabel("OCR job").selectOption(id);
    await expect(panel.getByLabel("OCR research text")).toHaveValue(
      "Machine guess $$E=mc^2$$",
    );
    await panel
      .getByLabel("OCR research text")
      .fill("Reviewed energy\n\n$$E=mc^2$$");
    await expect(panel.getByLabel("Review page")).toBeDisabled();
    await panel.getByRole("button", { name: "Preview equations" }).click();
    await expect(panel.locator(".pdf-ocr-equations mjx-container")).toHaveCount(
      1,
    );
    await panel.getByRole("button", { name: "Save & mark reviewed" }).click();
    await expect(panel.getByLabel("Review page")).toBeEnabled();
    await panel
      .getByRole("button", {
        name: "Create private research note",
        exact: true,
      })
      .click();
    const note = panel.getByRole("link", {
      name: "Open research note",
      exact: true,
    });
    await expect(note).toBeVisible();
    const noteId = (await note.getAttribute("href"))!.split("/").at(-1)!;
    const saved = await call(f.member.request, `notes/${noteId}`);
    expect(saved.visibility).toBe("private");
    expect((await f.owner.request.get(`/api/v1/notes/${noteId}`)).ok()).toBe(
      false,
    );
    await f.page.screenshot({
      path: info.outputPath("ocr-review-ui-mocked.png"),
    });
    await f.page.keyboard.press("Escape");
    const comparisonUpload = await finish(
      f.member.request,
      await upload(f.member.request, space.id, await pdfBytes(3)),
    );
    const comparisonFile = await call(
      f.member.request,
      `resources/${comparisonUpload.resourceId}`,
    );
    await reader
      .getByRole("button", {
        name: "Reader view and file actions",
        exact: true,
      })
      .click();
    await reader
      .getByRole("button", { name: "Compare PDFs…", exact: true })
      .click();
    const comparison = f.page.getByRole("dialog", {
      name: "Compare PDFs",
      exact: true,
    });
    await comparison
      .getByLabel("Comparison PDF", { exact: true })
      .selectOption(comparisonFile.id);
    await expect(comparison.getByLabel("Comparison version")).toHaveValue(
      comparisonFile.current_version_id,
    );
    await expect(
      comparison.getByRole("button", { name: "Compare text", exact: true }),
    ).toBeEnabled();
    await comparison
      .getByRole("button", { name: "Compare text", exact: true })
      .click();
    await expect(comparison.getByRole("status")).toContainText(
      "1 changed or unreadable page pairs",
      { timeout: 30000 },
    );
    await expect(
      comparison.getByText("Page added in comparison PDF.", { exact: true }),
    ).toBeVisible();
    await expect(comparison.getByLabel("Comparison page")).toHaveValue("3");
  } finally {
    await f.close();
  }
});
