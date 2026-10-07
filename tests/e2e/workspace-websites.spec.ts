import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const JSZip = createRequire(import.meta.url)("jszip") as typeof import("jszip");
import { fixture, origin, replaceSource } from "./native-editor-helpers";
import {
  defaultSiteConfig,
  siteEntrySchema,
} from "../../packages/shared/src/sites";
import { wordFixture, slidesFixture } from "../helpers/office-fixtures";
import { interfaceStyles } from "../../packages/shared/src/interface-styles";
import { settledInterfaceChrome } from "./interface-style-helpers";
const { PDFDocument } = createRequire(import.meta.url)(
  "pdf-lib",
) as typeof import("pdf-lib");
test.use({ trace: "off" });
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Website acceptance requires the isolated staging service on port 3004.",
    );
});
async function call(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const r = await request.fetch(`/api/v1/${path}`, {
    method,
    headers: { origin },
    data:
      data === undefined
        ? undefined
        : { mutationId: randomUUID(), ...(data as object) },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
async function review(request: APIRequestContext, root: string) {
  const { site } = await call(request, root);
  const queued = await call(request, `${root}/review`, {
    version: site.version,
  });
  let release: any;
  await expect
    .poll(
      async () => {
        release = await call(request, `${root}/releases/${queued.id}`);
        return release.status === "failed" ? release.error : release.status;
      },
      { timeout: 120000 },
    )
    .toBe("ready");
  return release;
}
async function publish(request: APIRequestContext, root: string, release: any) {
  await call(request, `${root}/publish`, {
    releaseId: release.id,
    fingerprint: release.fingerprint,
    consent: true,
  });
}
test("reviewed workspace website is private until manager approval and frozen after publication", async ({
  browser,
}, info) => {
  test.setTimeout(240000);
  const f = await fixture(
    browser,
    "# Reviewed evidence\n\nOriginal published content.\n\n## Methods\n\nA careful method.\n\n## Results\n\nA measured result.\n\n### Discussion\n\nMore research.\n\n$$\nE=mc^2\n$$\n",
  );
  const ownerPage = await f.owner.newPage(),
    visitor = await browser.newContext({
      baseURL: origin,
      serviceWorkers: "block",
    });
  try {
    const spaces = await call(f.owner.request, "spaces"),
      space = spaces.find(
        (s: any) => s.group_id === f.group.id && s.kind === "team",
      ),
      root = `spaces/${space.id}/site`,
      slug = "research-" + randomUUID().slice(0, 8);
    await ownerPage.goto(`/workbench/workspaces/${space.id}/website`);
    await ownerPage
      .getByLabel("Website title", { exact: true })
      .fill("Quantum Research Lab");
    await ownerPage
      .getByRole("textbox", { name: "Site address", exact: true })
      .fill(slug);
    await ownerPage
      .getByRole("button", { name: "Create private website draft" })
      .click();
    await expect(
      ownerPage.getByRole("heading", { name: "Quantum Research Lab" }),
    ).toBeVisible();
    await ownerPage
      .getByRole("button", { name: "Content", exact: true })
      .click();
    await ownerPage.getByRole("button", { name: "Add from workspace" }).click();
    await ownerPage.getByRole("dialog").getByRole("checkbox").first().check();
    await ownerPage
      .getByRole("button", { name: "Add selection", exact: true })
      .click();
    await ownerPage
      .getByRole("button", { name: "Design", exact: true })
      .click();
    for (const name of ["Scholar", "Notebook", "Journal", "Research Lab"]) {
      await ownerPage
        .locator(".website-template")
        .filter({ hasText: name })
        .click();
      await expect(
        ownerPage.locator(".website-template").filter({ hasText: name }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await ownerPage
      .getByRole("button", { name: "Add homepage section" })
      .click();
    await ownerPage
      .getByLabel("Heading", { exact: true })
      .fill("Open research");
    await ownerPage
      .getByLabel("Text (Markdown)", { exact: true })
      .fill("Evidence, reproducibility and collaborative discovery.");
    await ownerPage
      .getByRole("button", { name: "Move Open research up", exact: true })
      .click();
    await ownerPage.screenshot({
      path: info.outputPath("website-designer-current.png"),
      fullPage: true,
    });
    await ownerPage
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(
      ownerPage.getByText("Unsaved website draft", { exact: true }),
    ).toHaveCount(0);
    expect((await visitor.request.get(`/sites/${slug}/`)).status()).toBe(404);
    let site = (await call(f.member.request, root)).site;
    const queued = await call(f.member.request, `${root}/review`, {
      version: site.version,
    });
    let release: any;
    await expect
      .poll(
        async () => {
          release = await call(
            f.member.request,
            `${root}/releases/${queued.id}`,
          );
          return release.status === "failed" ? release.error : release.status;
        },
        { timeout: 120000 },
      )
      .toBe("ready");
    const unauthorized = await f.member.request.post(
      `/api/v1/${root}/publish`,
      {
        headers: { origin },
        data: {
          mutationId: randomUUID(),
          releaseId: release.id,
          fingerprint: release.fingerprint,
          consent: true,
        },
      },
    );
    expect([403, 404]).toContain(unauthorized.status());
    expect(
      (
        await visitor.request.get(
          `/api/v1/${root}/releases/${release.id}/preview/`,
        )
      ).status(),
    ).toBe(401);
    await ownerPage
      .getByRole("button", { name: "Review & publish", exact: true })
      .click();
    await expect(
      ownerPage.getByRole("button", { name: "Review", exact: true }).first(),
    ).toBeVisible();
    await ownerPage
      .getByRole("button", { name: "Review", exact: true })
      .first()
      .click();
    const dialog = ownerPage.getByRole("dialog", {
      name: "Review before publication",
      exact: true,
    });
    await expect(
      dialog
        .frameLocator("iframe")
        .getByRole("heading", { name: "Quantum Research Lab" }),
    ).toBeVisible();
    await ownerPage.screenshot({
      path: info.outputPath("website-review-current.png"),
      fullPage: true,
    });
    await dialog
      .getByRole("checkbox", { name: /I reviewed this preview/ })
      .check();
    await dialog.getByRole("button", { name: "Publish this release" }).click();
    await expect(dialog).toHaveCount(0);
    site = (await call(f.owner.request, root)).site;
    expect(site.enabled).toBe(true);
    const page = await visitor.newPage(),
      publicErrors: string[] = [];
    page.on("pageerror", (e) => publicErrors.push(e.message));
    await page.goto(`/sites/${slug}/`);
    await expect(
      page.getByRole("heading", { name: "Quantum Research Lab" }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Native editor study", exact: true })
      .click();
    await expect(
      page.getByText("Original published content.", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("mjx-container svg").first()).toBeVisible();
    await page.screenshot({
      path: info.outputPath("public-paper-current.png"),
      fullPage: true,
    });
    await replaceSource(
      f.page,
      "# Private working revision\n\nNEVER PUBLIC UNTIL NEW RELEASE\n",
    );
    await expect.poll(f.source).toContain("NEVER PUBLIC");
    await page.reload();
    await expect(
      page.getByText("Original published content.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("NEVER PUBLIC UNTIL NEW RELEASE")).toHaveCount(
      0,
    );
    const exported = await f.owner.request.get(
      `/api/v1/${root}/releases/${release.id}/export?baseUrl=${encodeURIComponent("https://static.example.org/lab")}`,
    );
    expect(
      exported.ok(),
      await exported.text().then((v) => v.slice(0, 100)),
    ).toBe(true);
    const zip = await JSZip.loadAsync(await exported.body());
    expect(zip.file("_site/reader.js")).not.toBeNull();
    expect(await zip.file("index.html")!.async("string")).toContain(
      "https://static.example.org/lab/",
    );
    expect(Object.keys(zip.files)).not.toContain("snapshot.json");
    await call(f.owner.request, `${root}/unpublish`, {});
    expect((await visitor.request.get(`/sites/${slug}/`)).status()).toBe(404);
    await call(f.owner.request, `${root}/rollback`, {
      releaseId: release.id,
      fingerprint: release.fingerprint,
      consent: true,
    });
    expect((await visitor.request.get(`/sites/${slug}/`)).ok()).toBe(true);
    // Deleting a private source must not silently retract or update approved
    // research. A subsequent review can retain its last published copy.
    const resource = await call(
      f.owner.request,
      `resources/${site.config.entries[0].resourceId}`,
    );
    await f.page.goto("/workbench");
    await call(f.owner.request, `resources/${resource.id}/trash`, {
      version: resource.version,
    });
    const retained = await review(f.owner.request, root);
    expect(retained.warnings.join(" ")).toContain(
      "private sources are unavailable",
    );
    await publish(f.owner.request, root, retained);
    await page.reload();
    await expect(
      page.getByText("Original published content.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("NEVER PUBLIC UNTIL NEW RELEASE")).toHaveCount(
      0,
    );
    // Workspace suspension is explicit and restoring it does not republish.
    for (const action of ["trash", "restore"]) {
      const current = (await call(f.owner.request, "spaces?manage=1")).find(
        (s: any) => s.id === space.id,
      );
      await call(f.owner.request, `spaces/${space.id}/${action}`, {
        version: current.version,
        confirmation: current.name,
      });
      expect((await visitor.request.get(`/sites/${slug}/`)).status()).toBe(404);
    }
    expect(publicErrors).toEqual([]);
  } finally {
    await ownerPage.close();
    await visitor.close();
    await f.close();
  }
});
test("settings rail, component styles and processing provider dialog remain coherent", async ({
  browser,
}, info) => {
  test.setTimeout(150000);
  const f = await fixture(browser, "# Settings review\n");
  try {
    await f.page.goto("/workbench/settings/appearance");
    await expect(f.page.locator(".settings-rail")).toBeVisible();
    await expect(f.page.locator(".ws-sidebar")).toHaveCount(0);
    await expect(
      f.page
        .locator(".settings-rail")
        .getByRole("heading", { name: "Appearance", exact: true }),
    ).toBeVisible();
    const general = await f.page
      .locator(".settings-rail")
      .getByRole("link", { name: "General", exact: true })
      .first()
      .boundingBox();
    const theme = await f.page
      .locator(".settings-rail")
      .getByRole("link", { name: "Theme", exact: true })
      .boundingBox();
    expect(general?.x).toBe(theme?.x);
    expect(theme!.width).toBeGreaterThan(180);
    for (const { id, name } of interfaceStyles) {
      await f.page.getByRole("radio", { name, exact: true }).check();
      await expect(f.page.locator("html")).toHaveAttribute(
        "data-interface-style",
        id,
      );
      await settledInterfaceChrome(f.page);
      await f.page.screenshot({
        path: info.outputPath(`settings-${id}-current.png`),
        fullPage: true,
      });
    }
    const appearanceFrame = await f.page
      .locator(".settings-stage")
      .boundingBox();
    await f.page.getByRole("button", { name: "Apply", exact: true }).click();
    await f.page
      .locator(".settings-rail")
      .getByRole("link", { name: "Profile", exact: true })
      .click();
    await expect(f.page.locator(".ws-settings-page")).toBeVisible();
    const profileFrame = await f.page
      .locator(".ws-settings-form")
      .boundingBox();
    expect(Math.abs(profileFrame!.width - appearanceFrame!.width)).toBeLessThan(
      2,
    );
    await f.page.screenshot({
      path: info.outputPath("settings-profile-current.png"),
      fullPage: true,
    });
    const space = (await call(f.owner.request, "spaces")).find(
      (s: any) => s.group_id === f.group.id && s.kind === "team",
    );
    const owner = await f.owner.newPage();
    await owner.goto(`/workbench/workspaces/${space.id}/integrations`);
    await expect(owner.locator(".ws-sidebar")).toBeVisible();
    await owner
      .getByRole("button", { name: "Add provider", exact: true })
      .click();
    const dialog = owner.getByRole("dialog", {
      name: "Add processing provider",
      exact: true,
    });
    await dialog
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Research inference");
    await expect(
      dialog.getByRole("group", { name: "Connection", exact: true }),
    ).toBeVisible();
    await owner.screenshot({
      path: info.outputPath("processing-provider-current.png"),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await owner
      .getByRole("dialog", { name: "Discard provider changes?" })
      .getByRole("button", { name: "Discard changes" })
      .click();
    await expect(dialog).toHaveCount(0);
    await owner
      .getByRole("button", { name: "Add provider", exact: true })
      .click();
    await expect(
      dialog.getByLabel("API credential", { exact: true }),
    ).toHaveValue("");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await owner.close();
  } finally {
    await f.close();
  }
});

test("public research readers load local PDF, Mermaid, Canvas and sanitized Office previews", async ({
  browser,
}, info) => {
  test.setTimeout(240000);
  const f = await fixture(
    browser,
    "# Diagram\n\n```mermaid\ngraph LR\nA[Observation] --> B[Evidence]\n```\n",
  );
  const visitor = await browser.newContext({
    baseURL: origin,
    serviceWorkers: "block",
  });
  try {
    const space = (await call(f.owner.request, "spaces")).find(
      (s: any) => s.group_id === f.group.id && s.kind === "team",
    );
    const upload = async (name: string, bytes: Buffer) => {
      const id = randomUUID();
      await call(f.owner.request, "uploads", {
        id,
        spaceId: space.id,
        name,
        bytes: bytes.length,
      });
      const chunk = await f.owner.request.put(
        `/api/v1/uploads/${id}/chunks/1`,
        {
          headers: { origin, "content-type": "application/octet-stream" },
          data: bytes,
        },
      );
      expect(chunk.ok(), await chunk.text()).toBe(true);
      await call(f.owner.request, `uploads/${id}/complete`, {});
      await expect
        .poll(
          async () => (await call(f.owner.request, `uploads/${id}`)).status,
          { timeout: 30000 },
        )
        .toBe("complete");
      return (await call(f.owner.request, `uploads/${id}`))
        .resourceId as string;
    };
    const pdf = await PDFDocument.create();
    const methods = pdf.addPage();
    methods.drawText("Reviewed methods", { x: 60, y: 740, size: 24 });
    methods.drawText(
      "Research publication fixture - explicitly selected and reviewed.",
      { x: 60, y: 700, size: 11 },
    );
    const evidence = pdf.addPage();
    evidence.drawText("Distinctive evidence", { x: 60, y: 740, size: 24 });
    evidence.drawText(
      "A second page verifies public text search and page navigation.",
      { x: 60, y: 700, size: 11 },
    );
    const pdfId = await upload("Methods.pdf", Buffer.from(await pdf.save()));
    const docId = await upload(
      "Study.docx",
      await (await wordFixture()).generateAsync({ type: "nodebuffer" }),
    );
    const slidesId = await upload(
      "Results.pptx",
      await (await slidesFixture()).generateAsync({ type: "nodebuffer" }),
    );
    const imageId = await upload(
      "Figure.svg",
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect x="20" y="20" width="100" height="60" fill="#2364aa"/></svg>',
      ),
    );
    const canvas = await call(f.owner.request, "files/new", {
      type: "canvas",
      name: "Evidence map",
      spaceId: space.id,
      source: JSON.stringify({
        nodes: [
          {
            id: "a",
            type: "text",
            x: 0,
            y: 0,
            width: 300,
            height: 200,
            text: "# Research card\n\nEvidence mapping.",
          },
        ],
        edges: [],
      }),
    });
    const note = await call(f.owner.request, `notes/${f.note.id}`);
    const config = defaultSiteConfig("Research formats", false);
    config.design.template = "journal";
    config.logoId = imageId;
    config.entries = [
      [note.resourceId ?? note.resource_id ?? note.id, "Diagram", "diagram"],
      [pdfId, "Methods", "methods"],
      [docId, "Study", "study"],
      [slidesId, "Slides", "slides"],
      [imageId, "Figure", "figure"],
      [canvas.resourceId ?? canvas.resource_id ?? canvas.id, "Map", "map"],
    ].map(([resourceId, title, slug]) =>
      siteEntrySchema.parse({
        id: randomUUID(),
        resourceId,
        title,
        slug,
        kind: "resource",
      }),
    );
    const root = `spaces/${space.id}/site`,
      slug = "formats-" + randomUUID().slice(0, 8);
    await call(f.owner.request, root, { slug, config });
    const release = await review(f.owner.request, root);
    await publish(f.owner.request, root, release);
    const page = await visitor.newPage(),
      errors: string[] = [],
      privateRequests: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/"))
        privateRequests.push(r.url());
    });
    const visit = (slugPart: string) =>
      page.goto(`/sites/${slug}/research/${slugPart}/`);
    await visit("diagram");
    await expect(page.locator("[data-mermaid] svg")).toBeVisible({
      timeout: 30000,
    });
    await visit("methods");
    await expect(page.locator("[data-pdf-status]")).toHaveText("Page 1 of 2", {
      timeout: 30000,
    });
    await page.getByLabel("Find in PDF").fill("Distinctive evidence");
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await expect(page.locator("[data-pdf-status]")).toContainText(
      "Found on page 2",
    );
    const pdfUrl = new URL(
      (await page.locator(".site-pdf").getAttribute("data-source"))!,
      page.url(),
    ).href;
    const range = await visitor.request.get(pdfUrl, {
      headers: { Range: "bytes=0-7" },
    });
    expect(range.status()).toBe(206);
    expect((await range.body()).length).toBe(8);
    expect(
      (
        await visitor.request.get(pdfUrl, {
          headers: { Range: "bytes=999999999-" },
        })
      ).status(),
    ).toBe(416);
    await page.screenshot({
      path: info.outputPath("public-pdf-current.png"),
      fullPage: true,
    });
    await visit("study");
    await expect(
      page.getByText("Energy & evidence", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Check calibration")).toHaveCount(0);
    await expect(page.getByText("Deleted claim")).toHaveCount(0);
    await visit("slides");
    await expect(
      page.getByRole("heading", { name: "Research results", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Evidence 1")).toHaveCount(0);
    await expect(
      page.getByText("Explain the calibration uncertainty."),
    ).toHaveCount(0);
    await visit("map");
    await expect(
      page.getByRole("heading", { name: "Research card" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await visit("figure");
    const figure = page.locator("main img").first();
    await expect(figure).toBeVisible();
    expect(
      await figure.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0,
      ),
    ).toBe(true);
    await figure.dblclick();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    for (const id of [imageId, docId, pdfId]) {
      const source = await call(f.owner.request, `resources/${id}`);
      await call(f.owner.request, `resources/${id}/trash`, {
        version: source.version,
      });
    }
    const retained = await review(f.owner.request, root);
    await publish(f.owner.request, root, retained);
    await visit("figure");
    await expect(figure).toBeVisible();
    await visit("study");
    await expect(
      page.getByText("Energy & evidence", { exact: true }),
    ).toBeVisible();
    await visit("methods");
    await expect(page.locator("[data-pdf-status]")).toHaveText("Page 1 of 2", {
      timeout: 30000,
    });
    // A malformed selected source must fail the new build without replacing the
    // ready public release. Draft cleanup must remain available afterwards.
    const brokenId = await upload(
      "Broken.svg",
      Buffer.from("This is not an SVG."),
    );
    const current = (await call(f.owner.request, root)).site;
    current.config.assetIds.push(brokenId);
    await call(
      f.owner.request,
      root,
      { version: current.version, config: current.config },
      "PATCH",
    );
    const queued = await call(f.owner.request, `${root}/review`, {
      version: current.version + 1,
    });
    await expect
      .poll(
        async () =>
          (await call(f.owner.request, `${root}/releases/${queued.id}`)).status,
        { timeout: 60000 },
      )
      .toBe("failed");
    expect((await call(f.owner.request, root)).site.live_release_id).toBe(
      retained.id,
    );
    expect((await visitor.request.get(`/sites/${slug}/`)).ok()).toBe(true);
    await call(f.owner.request, `${root}/releases/${queued.id}`, {}, "DELETE");
    expect(errors).toEqual([]);
    expect(privateRequests).toEqual([]);
  } finally {
    await visitor.close();
    await f.close();
  }
});
