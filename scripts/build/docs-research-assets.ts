import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect, type APIRequestContext } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";

const origin = process.env.DOCS_APP_URL ?? "http://localhost:3004";
if (origin !== "http://localhost:3004" || process.env.NODE_ENV === "production")
  throw new Error(
    "Capture only on isolated local staging port 3004, never a working instance.",
  );
const output = "docs/assets/showcase";
await mkdir(output, { recursive: true });
await mkdir("data/documentation-showcase", { recursive: true });
const browser = await chromium.launch();
const options = {
  baseURL: origin,
  viewport: { width: 1600, height: 1040 },
  deviceScaleFactor: 1,
  serviceWorkers: "block" as const,
  extraHTTPHeaders: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
};
async function api(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data ? "POST" : "GET",
) {
  const r = await request.fetch("/api/v1/" + path, {
    method,
    data,
    headers: { origin },
  });
  if (!r.ok())
    throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
  return r.json();
}
try {
  const owner = await browser.newContext(options);
  const login = await owner.request.post("/api/auth/sign-in/email", {
    headers: { origin },
    data: {
      email: process.env.TEST_OWNER_EMAIL ?? "researcher@axiom.local",
      password: process.env.TEST_OWNER_PASSWORD ?? "AxiomResearch2026!",
    },
  });
  if (!login.ok())
    throw new Error(
      "Configure credentials for the isolated staging owner; do not seed the working instance.",
    );
  const onboarding = await api(owner.request, "groups", {
    name: "Guide demonstration onboarding",
  });
  const invitation = await api(owner.request, "invitations", {
    groupId: onboarding.id,
    email: `${randomUUID()}@axiom.test`,
  });
  const member = await browser.newContext(options);
  await api(member.request, "register", {
    token: new URL(invitation.link).searchParams.get("invite"),
    name: "Mira Chen",
    password: randomUUID() + "Aa1!",
  });
  const group = await api(member.request, "groups", {
    name: "Spectral Lab",
    description: "Fictional demonstration of reading and evidence workflows.",
  });
  await api(member.request, `group-admin/${onboarding.id}/leave`, {});
  const spaces = await api(member.request, "spaces"),
    space = spaces.find(
      (s: any) => s.group_id === group.id && s.kind === "team",
    );
  const note = await api(member.request, "files/new", {
    type: "markdown",
    name: "Diffusion experiment notebook",
    spaceId: space.id,
    mutationId: randomUUID(),
    source:
      "# Diffusion experiment notebook\n\n## Assumptions\n\nCompare spectral stability under small graph perturbations.\n\n## Next experiment\n\nTest a second topology before interpreting transfer.\n",
  });
  const ref = await api(member.request, "references", {
    groupId: group.id,
    citeKey: "chen2026stability",
    title: "Spectral stability under graph perturbations",
    authors: "M. Chen and E. Ray",
    year: "2026",
  });
  await api(member.request, "references", {
    groupId: group.id,
    citeKey: "ray2026transfer",
    title: "Transfer across changing graph topologies",
    authors: "E. Ray",
    year: "2026",
  });
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const p = pdf.addPage([500, 700]);
    p.drawText("Spectral stability: research specimen", {
      x: 40,
      y: 630,
      size: 20,
      font,
    });
    p.drawText(`Fictional demonstration - page ${i}`, {
      x: 40,
      y: 595,
      size: 12,
      font,
    });
  }
  const bytes = Buffer.from(await pdf.save()),
    upload = randomUUID();
  await api(member.request, "uploads", {
    id: upload,
    spaceId: space.id,
    name: "Spectral stability — working paper.pdf",
    bytes: bytes.length,
  });
  const chunk = await member.request.put(`/api/v1/uploads/${upload}/chunks/1`, {
    headers: { origin, "content-type": "application/octet-stream" },
    data: bytes,
  });
  expect(chunk.ok()).toBe(true);
  await api(member.request, `uploads/${upload}/complete`, {});
  await expect
    .poll(async () => (await api(member.request, `uploads/${upload}`)).status, {
      timeout: 90000,
    })
    .toBe("complete");
  const resource = await api(
      member.request,
      `resources/${(await api(member.request, `uploads/${upload}`)).resourceId}`,
    ),
    meta = await api(
      member.request,
      `attachments/${resource.current_version_id}/meta`,
    );
  await api(member.request, `references/${ref.id}/links`, {
    kind: "attachment",
    targetId: meta.id,
  });
  const reading = async (
    kind: string,
    target_type: string,
    target_id: string,
    data: object,
  ) =>
    api(
      member.request,
      "me/reading",
      {
        id: randomUUID(),
        group_id: group.id,
        kind,
        target_type,
        target_id,
        data,
        version: 0,
        mutation_id: randomUUID(),
      },
      "PUT",
    );
  await reading("reading", "reference", ref.id, {
    status: "reading",
    label: ref.title,
  });
  await reading("reading", "attachment", meta.id, {
    status: "reading",
    label: resource.name,
  });
  await reading("progress", "attachment", meta.id, {
    page: 2,
    fraction: 0.48,
    label: "Continue the stability argument",
  });
  await reading("bookmark", "note", note.id, {
    label: "Assumptions worth testing",
    quote: "Compare spectral stability under small graph perturbations.",
  });
  const annotation = await api(
    member.request,
    `attachments/${meta.id}/annotations`,
    {
      id: randomUUID(),
      version: 0,
      mutation_id: randomUUID(),
      shared: false,
      data: {
        kind: "note",
        page: 2,
        sha256: meta.sha256,
        rects: [],
        quote:
          "Local stability does not by itself establish transfer across a different graph topology.",
        body: "Check the spectral gap and compare a second topology before drawing a general conclusion.",
        color: "blue",
        tags: ["assumptions", "follow-up"],
      },
    },
    "PUT",
  );
  const page = await member.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const mode of ["light", "dark"] as const) {
    const bundle = await api(member.request, "me/preferences-bundle");
    await api(
      member.request,
      "me/preferences-bundle",
      {
        editor: bundle.editor,
        appearance: {
          version: bundle.appearance.version,
          preferences: {
            ...bundle.appearance.preferences,
            mode,
            themePack: "default",
            interfaceStyle: "axiom",
          },
        },
        mutationId: randomUUID(),
      },
      "PATCH",
    );
    await page.goto("/workbench/docs/editor/math");
    await expect(
      page.getByRole("heading", {
        name: "Mathematics & research callouts",
        exact: true,
      }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `${output}/docs-${mode}.png`,
      animations: "disabled",
    });
    await page.goto("/workbench/docs/canvas/basics");
    await page
      .getByRole("button", { name: "Open example", exact: true })
      .click();
    await expect(page.locator(".docs-canvas .canvas-card")).toHaveCount(2);
    await page.locator(".docs-playground").scrollIntoViewIfNeeded();
    await expect(
      page.locator(".docs-canvas mjx-container").first(),
    ).toBeVisible({ timeout: 20000 });
    await page.mouse.move(1550, 1000);
    await page.screenshot({
      path: `${output}/docs-playground-${mode}.png`,
      animations: "disabled",
    });
    await page.goto(`/workbench/research?groupId=${group.id}`);
    await expect(page.locator(".evidence-row")).toHaveCount(6);
    await page.screenshot({
      path: `${output}/research-${mode}.png`,
      animations: "disabled",
    });
    await page
      .getByRole("navigation", { name: "Research views" })
      .getByRole("button", { name: "Evidence", exact: true })
      .click();
    await page.getByLabel(`Select ${resource.name}`, { exact: true }).check();
    await page
      .getByRole("button", { name: "Create from evidence", exact: true })
      .click();
    await page
      .getByLabel("File name", { exact: true })
      .fill("What the stability evidence supports");
    await page
      .getByLabel("Destination workspace", { exact: true })
      .selectOption(space.id);
    await page
      .getByRole("button", { name: "Preview draft", exact: true })
      .click();
    await expect(page.locator(".synthesis-consent")).toBeVisible();
    await page
      .locator(".synthesis-preview")
      .evaluate((el) => (el.scrollTop = 240));
    await page.screenshot({
      path: `${output}/synthesis-${mode}.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  expect(errors).toEqual([]);
  await writeFile(
    "data/documentation-showcase/research-latest.json",
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        origin,
        group: group.id,
        note: note.id,
        annotation: annotation.id,
        filesCreatedBySynthesis: 0,
        aiRequests: 0,
      },
      null,
      2,
    ),
  );
  console.log(
    "Captured light/dark Docs, Canvas example, Research and synthesis previews using fictional content. No synthesis file or AI request was submitted.",
  );
} finally {
  await browser.close();
}
