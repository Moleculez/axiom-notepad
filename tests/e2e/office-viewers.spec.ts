import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const ExcelJS = createRequire(import.meta.url)(
  "exceljs",
) as typeof import("exceljs");
import { fixture, origin } from "./native-editor-helpers";
import { wordFixture, slidesFixture } from "../helpers/office-fixtures";
let f: Awaited<ReturnType<typeof fixture>>, spaceId: string;
test.beforeAll(async ({ browser }) => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Office acceptance requires isolated staging on port 3004.",
    );
  f = await fixture(browser, "# Office acceptance\n");
  const spaces = await (await f.member.request.get("/api/v1/spaces")).json();
  spaceId = spaces.find(
    (s: { group_id: string; kind: string }) =>
      s.group_id === f.group.id && s.kind === "team",
  ).id;
});
test.afterAll(async () => {
  await f?.close();
});
async function upload(name: string, bytes: Buffer) {
  const id = randomUUID();
  const post = async (path: string, data: unknown) => {
    const r = await f.member.request.post(`/api/v1/${path}`, {
      headers: { origin },
      data,
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  await post("uploads", { id, spaceId, name, bytes: bytes.length });
  const r = await f.member.request.put(`/api/v1/uploads/${id}/chunks/1`, {
    headers: { origin, "content-type": "application/octet-stream" },
    data: bytes,
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  await post(`uploads/${id}/complete`, {});
  const status = async () =>
    (await f.member.request.get(`/api/v1/uploads/${id}`)).json();
  await expect
    .poll(async () => (await status()).status, { timeout: 30000 })
    .toBe("complete");
  return (await status()).resourceId as string;
}
test("Excel styles, formula inspection, range keyboard selection, sorting, merges and virtual scrolling", async ({}, info) => {
  test.setTimeout(120000);
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Measurements"),
    merged = book.addWorksheet("Merged summary");
  sheet.addRow([
    "Mass",
    "Energy",
    ...Array.from({ length: 28 }, (_, i) => `Channel ${i + 1}`),
  ]);
  for (let i = 1; i <= 1000; i++)
    sheet.addRow([
      i,
      { formula: `A${i + 1}*3`, result: i * 3 },
      ...Array.from({ length: 28 }, (_, j) => `S${i}-${j + 1}`),
    ]);
  sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 1 }];
  sheet.getCell("A1").font = { bold: true, color: { argb: "FF123456" } };
  sheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEEF4FA" },
  };
  merged.addRows([
    ["Merged experiment", "", "Control"],
    ["Trial", 2, 3],
  ]);
  merged.mergeCells("A1:B1");
  const id = await upload(
    "measurements.xlsx",
    Buffer.from(await book.xlsx.writeBuffer()),
  );
  const p = f.page;
  await p.goto(`/workbench/files/${id}`);
  const grid = p.getByRole("grid", { name: "Spreadsheet data" }),
    cell = (name: string) => grid.getByRole("gridcell", { name, exact: true });
  await expect(cell("A1")).toHaveText("Mass");
  await expect(cell("A1")).toHaveCSS("color", "rgb(18, 52, 86)");
  await cell("B2").click();
  await expect(p.getByLabel("Cell formula or value")).toHaveText("=A2*3");
  await grid.press("Shift+ArrowDown");
  await expect(p.locator(".workbook-status")).toContainText("Sum 9");
  await p
    .getByRole("button", {
      name: "Sort selected column descending",
      exact: true,
    })
    .click();
  await expect(cell("A1001")).toHaveText("1000");
  await p
    .getByRole("button", { name: "Clear worksheet sorting", exact: true })
    .click();
  await p.getByLabel("Go to cell", { exact: true }).fill("AD1001");
  await p.getByLabel("Go to cell", { exact: true }).press("Enter");
  await expect(cell("AD1001")).toBeInViewport();
  expect(await grid.getByRole("gridcell").count()).toBeLessThan(400);
  await expect(cell("AD1001")).toHaveAttribute("aria-selected", "true");
  await p
    .getByLabel("Workbook sheet", { exact: true })
    .selectOption({ label: "Merged summary" });
  await expect(cell("A1")).toHaveAttribute("aria-colspan", "2");
  await cell("A1").click();
  await grid.press("ArrowRight");
  await expect(p.getByLabel("Go to cell", { exact: true })).toHaveValue("C1");
  await grid.press("ArrowLeft");
  await expect(p.getByLabel("Go to cell", { exact: true })).toHaveValue("A1");
  await expect(
    p.getByRole("button", {
      name: "Sort selected column ascending",
      exact: true,
    }),
  ).toBeDisabled();
  await p
    .getByLabel("Workbook sheet", { exact: true })
    .selectOption({ label: "Measurements" });
  await p.getByLabel("Filter worksheet rows").fill("S987-1");
  await expect(cell("A988")).toHaveText("987");
  await expect(p.locator(".workbook-status")).toContainText("1 rows");
  await p.getByLabel("Filter worksheet rows").fill("");
  await p.screenshot({ path: info.outputPath("workbook-styled-grid.png") });
  const manifest = await (
    await f.member.request.get(`/api/v1/files/${id}/preview`)
  ).json();
  await p.goto(
    `/workbench/files/${id}?version=${manifest.versionId}#sheet=Merged+summary&cell=B1`,
  );
  await expect(p.getByLabel("Workbook sheet", { exact: true })).toHaveValue(
    "1",
  );
  await expect(p.getByLabel("Go to cell", { exact: true })).toHaveValue("A1");
  await expect(cell("A1")).toHaveAttribute("aria-selected", "true");
});
test("Word outline, inert text, table, comments and text export work without conversion", async ({}, info) => {
  const id = await upload(
      "research-report.docx",
      await (await wordFixture()).generateAsync({ type: "nodebuffer" }),
    ),
    p = f.page;
  const requests: string[] = [];
  const watch = (r: { url: () => string }) => {
    if (r.url().includes("invalid.example")) requests.push(r.url());
  };
  p.on("request", watch);
  await p.goto(`/workbench/files/${id}`);
  const reading = p.getByLabel("Document text", { exact: true });
  await expect(
    reading.getByRole("heading", { name: "Energy & evidence", exact: true }),
  ).toBeVisible();
  await expect(
    reading.getByRole("cell", { name: "Mass", exact: true }),
  ).toBeVisible();
  await p
    .getByRole("navigation", { name: "Document navigator" })
    .getByRole("button", { name: "Limitations", exact: true })
    .click();
  await expect(
    reading.getByRole("heading", { name: "Limitations", exact: true }),
  ).toBeFocused();
  await p.getByLabel("Search document text").fill("uncertainty");
  await expect(p.locator(".office-navigator mark")).toHaveText("uncertainty");
  await p.getByLabel("Search document text").fill("");
  await p.getByText("Original document comments (1)", { exact: true }).click();
  await expect(
    reading.getByText("Check calibration", { exact: true }),
  ).toBeVisible();
  await expect(reading).toContainText("<script> remains inert");
  expect(await reading.locator("script").count()).toBe(0);
  const download = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export text", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("research-report-text.txt");
  await p.screenshot({ path: info.outputPath("word-reading-view.png") });
  await p.getByRole("button", { name: "Pages", exact: true }).click();
  await expect(
    p.getByRole("button", { name: "Generate private preview", exact: true }),
  ).toBeVisible();
  expect(requests).toEqual([]);
  p.off("request", watch);
});
test("PowerPoint follows slide order, shows hidden-slide labels and speaker notes", async ({}, info) => {
  const id = await upload(
      "research-deck.pptx",
      await (await slidesFixture()).generateAsync({ type: "nodebuffer" }),
    ),
    p = f.page;
  await p.goto(`/workbench/files/${id}`);
  const reading = p.getByLabel("Slide text", { exact: true });
  await expect(reading).toContainText("Research results");
  await expect(
    reading.getByRole("heading", { name: "Speaker notes" }),
  ).toBeVisible();
  await expect(reading).toContainText("Explain the calibration uncertainty.");
  await p.getByRole("button", { name: "Next slide", exact: true }).click();
  await expect(reading).toContainText("Appendix");
  await expect(p.locator(".office-slide-controls")).toContainText(
    "hidden in original",
  );
  await p.getByLabel("Search document text").fill("calibration");
  await p
    .getByRole("navigation", { name: "Document navigator" })
    .getByRole("button")
    .click();
  await expect(reading.locator("mark")).toHaveText("calibration");
  await p.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(p.locator("html")).toHaveAttribute("data-theme", "dark");
  await p.screenshot({
    path: info.outputPath("slides-notes-dark.png"),
    animations: "disabled",
  });
  await p.emulateMedia({ colorScheme: "light" });
});
