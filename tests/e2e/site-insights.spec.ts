import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fixture, origin } from "./native-editor-helpers";
import {
  defaultSiteConfig,
  siteEntrySchema,
} from "../../packages/shared/src/sites";
import { siteThemes } from "../../packages/shared/src/site-design";
const JSZip = createRequire(import.meta.url)("jszip") as typeof import("jszip");
test.use({ trace: "off", actionTimeout: 15000 });
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Use the isolated staging database and service on port 3004.",
    );
});
async function call(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const response = await request.fetch(`/api/v1/${path}`, {
    method,
    headers: { origin },
    data:
      data === undefined
        ? undefined
        : { mutationId: randomUUID(), ...(data as object) },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test("website themes, discovery, analytics privacy and static exports", async ({
  browser,
}, info) => {
  test.setTimeout(360000);
  const f = await fixture(
    browser,
    "# Introduction\n\nA careful research argument.[^note]\n\n### Model\n\n$$\nE=mc^2\n$$\n\n" +
      Array.from(
        { length: 14 },
        (_, i) =>
          `## Evidence ${i + 1}\n\nMeasured observations and reproducible results support our conclusion.\n\n`,
      ).join("") +
      "```python\ndef energy(x):\n    return x ** 2 # a model\n```\n\n[^note]: This is an explanatory footnote.\n",
  );
  const visitor = await browser.newContext({
    baseURL: origin,
    serviceWorkers: "block",
    viewport: { width: 1600, height: 1000 },
    userAgent: "Mozilla/5.0 Research acceptance browser",
  });
  const ownerPage = await f.owner.newPage();
  try {
    const spaces = await call(f.owner.request, "spaces"),
      space = spaces.find(
        (s: any) => s.group_id === f.group.id && s.kind === "team",
      ),
      root = `spaces/${space.id}/site`,
      slug = "insights-" + randomUUID().slice(0, 8);
    const note = await call(f.owner.request, `notes/${f.note.id}`),
      resourceId = note.resourceId ?? note.resource_id ?? note.id;
    const config = defaultSiteConfig("Clarity Research", false),
      author = randomUUID();
    config.authors = [
      {
        id: author,
        name: "Ada Researcher",
        bio: "Open methods.",
        affiliation: "Research Lab",
        url: "",
        orcid: "",
      },
    ];
    config.entries = [
      siteEntrySchema.parse({
        id: randomUUID(),
        resourceId,
        title: "A careful argument",
        slug: "argument",
        kind: "paper",
        tags: ["Physics", "Methods"],
        authorIds: [author],
      }),
      siteEntrySchema.parse({
        id: randomUUID(),
        resourceId,
        title: "Earlier evidence",
        slug: "earlier",
        kind: "post",
        date: "2025-03-12",
        tags: ["Methods"],
        authorIds: [author],
      }),
      siteEntrySchema.parse({
        id: randomUUID(),
        resourceId,
        title: "About the lab",
        slug: "about",
        kind: "page",
      }),
    ];
    await call(f.owner.request, root, { slug, config });
    await ownerPage.goto(`/workbench/workspaces/${space.id}/website`);
    await ownerPage
      .getByRole("button", { name: "Design", exact: true })
      .click();
    const frame = ownerPage.frameLocator(
      'iframe[title="Website design specimen"]',
    );
    for (const theme of siteThemes) {
      await ownerPage.locator(`.website-theme-card.theme-${theme.id}`).click();
      try {
        await expect(frame.locator("html")).toHaveAttribute(
          "data-site-theme",
          theme.id,
          { timeout: 15000 },
        );
      } catch (error) {
        console.info("Theme specimen diagnostic", {
          theme: theme.id,
          selected: await ownerPage
            .locator('.website-theme-card[aria-pressed="true"]')
            .innerText(),
          sourceTheme: (
            await ownerPage
              .locator('iframe[title="Website design specimen"]')
              .getAttribute("srcdoc")
          )?.match(/data-site-theme="([^"]+)"/)?.[1],
          errors: await ownerPage.locator('[role="alert"]').allTextContents(),
          frames: ownerPage.frames().map((f) => f.url()),
        });
        await ownerPage.screenshot({
          path: info.outputPath("specimen-error.png"),
          fullPage: true,
        });
        throw error;
      }
      await expect(
        frame.getByRole("heading", {
          name: "On clarity, structure and discovery",
          exact: true,
        }),
      ).toBeVisible();
      await expect(frame.locator("mjx-container svg").first()).toBeVisible();
    }
    await ownerPage.locator(".website-theme-card.theme-latex-paper").click();
    await ownerPage.getByLabel(/Text size/).fill("19");
    await expect(frame.locator("html")).toHaveAttribute(
      "data-site-theme",
      "latex-paper",
    );
    await ownerPage.screenshot({
      path: info.outputPath("theme-designer.png"),
      fullPage: true,
    });
    await ownerPage
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(
      ownerPage.getByText("Unsaved website draft", { exact: true }),
    ).toHaveCount(0);
    const current = (await call(f.owner.request, root)).site;
    const queued = await call(f.owner.request, `${root}/review`, {
      version: current.version,
    });
    let release: any;
    await expect
      .poll(
        async () => {
          release = await call(
            f.owner.request,
            `${root}/releases/${queued.id}`,
          );
          return release.status === "failed" ? release.error : release.status;
        },
        { timeout: 120000 },
      )
      .toBe("ready");
    await call(f.owner.request, `${root}/publish`, {
      releaseId: release.id,
      fingerprint: release.fingerprint,
      consent: true,
    });
    const page = await visitor.newPage(),
      errors: string[] = [],
      googleRequests: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await visitor.route(
      /https:\/\/[^/]*(?:google|googletagmanager)[^/]*/,
      (route) => {
        googleRequests.push(route.request().url());
        return route.fulfill({
          status: 200,
          contentType: "text/javascript",
          body: "/* consent test: no external traffic */",
        });
      },
    );
    const publicRoot = `/sites/${slug}/`;
    await page.goto(publicRoot + "papers/argument/");
    await expect(page.locator(".article-reading-stats")).toContainText("words");
    await expect(
      page.locator(".site-outline nav > ol > li > details > ol").first(),
    ).toBeVisible();
    await expect(page.locator(".site-outline a[aria-current]")).toHaveCount(1);
    expect(
      await page
        .locator("main")
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Publication Latin");
    await page.screenshot({
      path: info.outputPath("latex-paper.png"),
      fullPage: true,
    });
    const keyword = page.locator(".site-article-body .hljs-keyword").first();
    await expect(keyword).toBeVisible();
    const lightColor = await keyword.evaluate(
      (el) => getComputedStyle(el).color,
    );
    expect(lightColor).not.toBe(
      await keyword.evaluate(
        (el) => getComputedStyle(el.closest("code")!).color,
      ),
    );
    await page.getByRole("button", { name: "Switch color mode" }).click();
    await expect
      .poll(() => keyword.evaluate((el) => getComputedStyle(el).color))
      .not.toBe(lightColor);
    await page.getByRole("button", { name: "Switch color mode" }).click();
    await page
      .getByRole("heading", { name: /Evidence 14/ })
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await expect(page.locator(".site-outline a[aria-current]")).toHaveText(
      "Evidence 14",
    );
    const report = () => call(f.owner.request, `${root}/analytics`);
    expect((await report()).current.views).toBe(0);
    await page.goto(publicRoot + "archive/?tag=Methods");
    await expect(page.locator("[data-archive-count]")).toHaveText(
      "2 publications",
    );
    await expect(page.locator('[data-kind="page"]')).toBeHidden();
    await page.getByLabel("Search", { exact: true }).fill("Earlier");
    await expect(page.locator("[data-archive-count]")).toHaveText(
      "1 publication",
    );
    await expect(page).toHaveURL(/q=Earlier/);
    await page.screenshot({
      path: info.outputPath("archive-timeline.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByLabel("Content", { exact: true }).selectOption("all");
    await expect(page.locator("[data-archive-count]")).toHaveText(
      "3 publications",
    );
    await page.goto(publicRoot + "tags/");
    await expect(
      page.getByRole("link", { name: "Methods 2 publications" }),
    ).toBeVisible();
    const settings = {
      enabled: true,
      publicViews: true,
      publicDownloads: true,
      publicSiteTotals: true,
      googleMeasurementId: "G-TEST123456",
    };
    expect(
      (
        await f.member.request.patch(`/api/v1/${root}/analytics/settings`, {
          headers: { origin },
          data: { mutationId: randomUUID(), version: 0, settings },
        })
      ).status(),
    ).toBe(403);
    await call(
      f.owner.request,
      `${root}/analytics/settings`,
      { version: 0, settings },
      "PATCH",
    );
    const preview = await f.owner.request.get(
      `/api/v1/${root}/releases/${release.id}/preview/papers/argument/`,
    );
    expect(await preview.text()).not.toContain("axiom-site-runtime");
    await page.goto(publicRoot + "papers/argument/");
    await expect(
      page.getByRole("dialog", { name: "Website privacy settings" }),
    ).toBeVisible();
    expect(googleRequests).toHaveLength(0);
    await page
      .getByRole("button", { name: "Reject external analytics", exact: true })
      .click();
    await expect.poll(async () => (await report()).current.views).toBe(1);
    // Cumulative event retries/out-of-order writes cannot inflate totals.
    const payload = {
      releaseId: release.id,
      visitId: randomUUID(),
      page: "papers/argument/index.html",
      seconds: 0,
      depth: 80,
      downloads: 1,
      citations: 1,
      outbound: 1,
      referrer: "methods.example.org",
    };
    const send = (data: object, headers: Record<string, string> = {}) =>
      visitor.request.post(publicRoot + "_site/analytics/events", {
        headers: {
          origin,
          "user-agent": "Research acceptance browser",
          ...headers,
        },
        data,
      });
    await Promise.all([send(payload), send(payload), send(payload)]);
    expect((await report()).current.views).toBe(2);
    expect((await report()).current.downloads).toBe(1);
    await send({
      ...payload,
      visitId: randomUUID(),
      page: "not-a-public-page",
    });
    await send({ ...payload, visitId: randomUUID() }, { dnt: "1" });
    await send({ ...payload, visitId: randomUUID() }, { "sec-gpc": "1" });
    expect(
      (
        await send(
          { ...payload, visitId: randomUUID() },
          { origin: "https://unrelated.example" },
        )
      ).status(),
    ).toBe(403);
    expect((await report()).current.views).toBe(2);
    await page
      .getByRole("button", { name: "Privacy settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Accept external analytics", exact: true })
      .click();
    await expect.poll(() => googleRequests.length).toBe(1);
    await page
      .getByRole("button", { name: "Privacy settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Reject external analytics", exact: true })
      .click();
    expect(
      await page.evaluate(() =>
        Boolean((window as any)["ga-disable-G-TEST123456"]),
      ),
    ).toBe(true);
    await expect
      .poll(async () => (await report()).current.engaged, { timeout: 25000 })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () => (await report()).current.completed, { timeout: 25000 })
      .toBeGreaterThanOrEqual(1);
    await ownerPage
      .getByRole("button", { name: "Analytics", exact: true })
      .click();
    await expect(
      ownerPage.getByRole("heading", { name: "Research & readership" }),
    ).toBeVisible();
    await expect(
      ownerPage
        .locator(".site-insights-metrics section")
        .first()
        .locator("strong"),
    ).toHaveText("2");
    await ownerPage.screenshot({
      path: info.outputPath("author-analytics.png"),
      fullPage: true,
    });
    const csv = await f.owner.request.get(
      `/api/v1/${root}/analytics?format=csv`,
    );
    expect(await csv.text()).toContain('"A careful argument"');
    const archive = await visitor.request.get(publicRoot + "archive/");
    expect(await archive.text()).not.toContain("Not yet published");
    const exportUrl = `/api/v1/${root}/releases/${release.id}/export?baseUrl=https%3A%2F%2Fstatic.example.org%2Flab`;
    const zip = await JSZip.loadAsync(
      await (await f.owner.request.get(exportUrl)).body(),
    );
    const staticHtml = await zip
      .file("papers/argument/index.html")!
      .async("string");
    expect(staticHtml).not.toContain("axiom-site-runtime");
    expect(zip.file("_site/LM-regular.woff2")).not.toBeNull();
    expect(staticHtml).toContain('class="hljs-keyword"');
    expect(await zip.file("_site/site.css")!.async("string")).toContain(
      "--code-keyword",
    );
    const googleZip = await JSZip.loadAsync(
      await (await f.owner.request.get(exportUrl + "&includeGoogle=1")).body(),
    );
    const googleHtml = await googleZip.file("index.html")!.async("string");
    expect(googleHtml).toContain('"static":true');
    expect(googleHtml).toContain("G-TEST123456");
    await call(
      f.owner.request,
      `${root}/analytics/settings`,
      {
        version: 1,
        settings: { ...settings, enabled: false, googleMeasurementId: "" },
      },
      "PATCH",
    );
    const before = (await report()).current.views;
    await send({ ...payload, visitId: randomUUID() });
    expect((await report()).current.views).toBe(before);
    await page.reload();
    await expect(page.locator('[data-public-totals="article"]')).toContainText(
      "views",
    );
    expect(errors).toEqual([]);
  } finally {
    await ownerPage.close();
    await visitor.close();
    await f.close();
  }
});
