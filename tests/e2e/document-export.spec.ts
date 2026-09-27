import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const JSZip = createRequire(import.meta.url)("jszip") as typeof import("jszip");
const sharp = createRequire(import.meta.url)(
  "sharp",
) as typeof import("sharp").default;
import { fixture, origin, replaceSource } from "./native-editor-helpers";
import { defaults } from "../../packages/shared/src/appearance";
import { defaultDocumentExportOptions } from "../../packages/shared/src/document-export";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Run export tests on an isolated staging database at localhost:3004, never the working notebook.",
    );
});
test.setTimeout(180_000);
const study = `# Research findings

A **precise** result with *explicit assumptions*. See the observation[^note].

## Conservation

$$
E = mc^2
$$

| Quantity | Estimate |
| :--- | ---: |
| Energy | $E$ |
| Mass | $m$ |

- [x] Check units
- [ ] Replicate experiment

> A useful research note with a nested observation.

\`\`\`python
energy = mass * c**2
print(energy)
\`\`\`

\`\`\`mermaid
flowchart LR
  Hypothesis --> Experiment --> Result
\`\`\`

[^note]: An independently checked observation.
`;

test("snapshot exports preserve research presentation, images and diagram SVG; print contains selectable text", async ({
  browser,
}, info) => {
  const f = await fixture(browser, study);
  try {
    const upload = await f.member.request.post(
      `/api/v1/notes/${f.note.id}/attachments`,
      {
        headers: { origin },
        multipart: {
          file: {
            name: "figure.png",
            mimeType: "image/png",
            buffer: await sharp(
              Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="#f3f5f7"/><path d="M15 12V65H225" fill="none" stroke="#929da5"/><path d="M15 60L50 56L80 48L115 50L150 34L185 22L220 14" fill="none" stroke="#335a70" stroke-width="2"/></svg>',
              ),
            )
              .png()
              .toBuffer(),
          },
        },
      },
    );
    expect(upload.ok(), await upload.text()).toBeTruthy();
    const image = await upload.json();
    await replaceSource(
      f.page,
      study +
        `\n![Local figure](/api/v1/attachments/${image.id})\n\n[Image source](/api/v1/attachments/${image.id})\n`,
    );
    await expect.poll(f.source).toContain(image.id);
    const before = await f.source();
    await f.page
      .getByRole("button", { name: "Export document", exact: true })
      .click();
    const dialog = f.page.getByRole("dialog", {
      name: "Export document",
      exact: true,
    });
    await expect(
      dialog.getByText("Preview ready", { exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    await dialog.getByLabel("Add table of contents").check();
    await expect(
      dialog.getByText("Preview ready", { exact: true }),
    ).toBeVisible();
    const preview = f.page.frameLocator(
      'iframe[title="Document export preview"]',
    );
    await expect(preview.locator(".diagram svg")).toHaveCount(1);
    await expect(preview.locator(".math-block svg")).toHaveCount(1);
    const imageLink = preview.getByRole("link", {
      name: "Image source",
      exact: true,
    });
    await expect(imageLink).toHaveCSS("pointer-events", "none");
    await expect(imageLink).toHaveAttribute("tabindex", "-1");
    await imageLink.scrollIntoViewIfNeeded();
    const linkBox = (await imageLink.boundingBox())!;
    await f.page.mouse.click(
      linkBox.x + linkBox.width / 2,
      linkBox.y + linkBox.height / 2,
    );
    await expect(preview.locator("main")).toContainText("Research findings");
    await expect(
      preview.locator('input[type="checkbox"]').first(),
    ).toBeDisabled();
    const downloaded = f.page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download", exact: true }).click();
    const download = await downloaded;
    const html = await readFile((await download.path())!, "utf8");
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('src="https:');
    expect(html).toContain('aria-label="Table of contents"');
    await f.page.screenshot({ path: info.outputPath("export-dialog.png") });

    await dialog.getByLabel("Format", { exact: true }).selectOption("pdf");
    await expect(
      dialog.getByText("Preview ready", { exact: true }),
    ).toBeVisible();
    const paper = await f.page
      .locator('iframe[title="Document export preview"]')
      .getAttribute("srcdoc");
    await preview.locator("body").evaluate(() => {
      window.print = () => {
        (window as any).__printed = true;
      };
    });
    await dialog
      .getByRole("button", { name: "Print / Save PDF", exact: true })
      .click();
    expect(
      await preview.locator("body").evaluate(() => (window as any).__printed),
    ).toBe(true);
    const printContext = await browser.newContext({ offline: true });
    const printPage = await printContext.newPage();
    await printPage.setContent(paper!);
    await printPage.evaluate(() => document.fonts.ready);
    if (browser.browserType().name() === "chromium")
      await printPage.pdf({
        path: info.outputPath("research-export.pdf"),
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
      });
    await printContext.close();
    expect(await f.source()).toBe(before);
    const peer = await f.owner.newPage();
    await peer.goto(`/workbench/notes/${f.note.id}`);
    await expect(peer.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await replaceSource(peer, before + "\nA newer peer observation.\n");
    await expect(
      dialog.getByText(
        "The document has changed. Refresh to include newer edits.",
      ),
    ).toBeVisible();
    await expect(preview.locator("body")).not.toContainText(
      "A newer peer observation.",
    );
    await dialog.getByRole("button", { name: "Refresh snapshot" }).click();
    await expect(preview.locator("body")).toContainText(
      "A newer peer observation.",
    );
    await peer.close();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  } finally {
    await f.close();
  }
});

test("Read mode has no title or formatting writes, keeps stable blocks and defers peer changes while text is selected", async ({
  browser,
}, info) => {
  const f = await fixture(browser, study);
  try {
    await f.page.getByRole("button", { name: "Read", exact: true }).click();
    const reader = f.page.locator(".read-mount:not(.print-only) .reading-view");
    await expect(reader.locator(".diagram > svg")).toBeVisible();
    await expect(f.page.locator(".ws-paper .document-title")).toHaveText(
      f.note.title,
    );
    await expect(f.page.locator(".ws-paper input.document-title")).toHaveCount(
      0,
    );
    await expect(f.page.locator(".ws-format-toolbar")).toHaveCount(0);
    await expect(
      reader.locator('input[type="checkbox"]').first(),
    ).toBeDisabled();
    await f.page.getByLabel("Reading text size", { exact: true }).fill("22");
    await f.page
      .getByLabel("Reading width", { exact: true })
      .selectOption("60");
    await reader
      .locator("pre")
      .filter({ has: f.page.locator("code") })
      .hover();
    await expect(
      reader.getByRole("button", { name: "Copy code" }),
    ).toBeVisible();
    expect(
      (await f.page
        .getByRole("group", { name: "Reading preferences" })
        .boundingBox())!.height,
    ).toBeLessThanOrEqual(60);
    await f.page.locator(".ws-document-scroll").evaluate((element) => {
      element.scrollTop = 0;
    });
    await f.page.screenshot({ path: info.outputPath("read-mode.png") });
    await reader
      .locator("p")
      .first()
      .evaluate((element) => {
        (window as any).__readingNode = element;
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
    const selected = await f.page.evaluate(() => getSelection()?.toString());
    const peer = await f.owner.newPage();
    await peer.goto(`/workbench/notes/${f.note.id}`);
    await expect(peer.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await replaceSource(peer, `New collaboration paragraph.\n\n${study}`);
    await expect(
      f.page.getByText("Updates are waiting while you select text.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await f.page.evaluate(() => getSelection()?.toString())).toBe(
      selected,
    );
    await f.page.evaluate(() => getSelection()?.removeAllRanges());
    await expect(reader).toContainText("New collaboration paragraph.");
    expect(
      await f.page.evaluate(() => (window as any).__readingNode.isConnected),
    ).toBe(true);
    await reader.locator(".diagram > svg").dblclick();
    await expect(f.page.getByRole("dialog")).toBeVisible();
    await f.page.keyboard.press("Escape");
    await peer.close();
  } finally {
    await f.close();
  }
});

test("preview is read-authorized and non-persisting; ZIP uses the same snapshot and rejects revoked downloads", async ({
  browser,
}) => {
  const f = await fixture(browser, "Original authoritative note.");
  const post = async (path: string, data: unknown) => {
    const response = await f.owner.request.post(`/api/v1/${path}`, {
      headers: { origin },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  try {
    const me = await (await f.member.request.get("/api/v1/me")).json();
    const project = await post("projects", {
      groupId: f.group.id,
      name: "Read-only export lab",
    });
    const space = await (
      await f.owner.request.get(`/api/v1/projects/${project.id}`)
    ).json();
    const resource = await post("resources", {
      spaceId: space.space_id,
      kind: "note",
      name: "Shared study",
      body: "Authoritative content.",
    });
    await post(`projects/${project.id}/members`, {
      userId: me.user.id,
      role: "viewer",
    });
    const note = await (
      await f.member.request.get(`/api/v1/notes/${resource.id}`)
    ).json();
    await f.page.goto(`/workbench/notes/${resource.id}`);
    await expect(
      f.page.getByRole("button", { name: "Write", exact: true }),
    ).toBeDisabled();
    await f.page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(f.page.locator(".cm-content").first()).toHaveAttribute(
      "contenteditable",
      "false",
    );
    const uploaded = await f.owner.request.post(
      `/api/v1/notes/${resource.id}/attachments`,
      {
        headers: { origin },
        multipart: {
          file: {
            name: "evidence.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("Immutable research evidence."),
          },
        },
      },
    );
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    const attached = await uploaded.json();
    const snapshot = {
      source: `# Snapshot only\n\nNot a persisted edit.\n\n[Evidence](/api/v1/attachments/${attached.id})`,
      title: note.title,
      generation: note.generation,
    };
    const input = {
      snapshot,
      options: defaultDocumentExportOptions,
      preferences: defaults,
    };
    const preview = await f.member.request.post(
      `/api/v1/notes/${resource.id}/export-preview`,
      { headers: { origin }, data: input },
    );
    expect(preview.ok(), await preview.text()).toBeTruthy();
    expect((await preview.json()).html).toContain("Not a persisted edit.");
    expect(
      (
        await (
          await f.member.request.get(`/api/v1/notes/${resource.id}`)
        ).json()
      ).body,
    ).toBe("Authoritative content.");
    const stale = await f.member.request.post(
      `/api/v1/notes/${resource.id}/export-preview`,
      {
        headers: { origin },
        data: {
          ...input,
          snapshot: { ...snapshot, generation: snapshot.generation + 1 },
        },
      },
    );
    expect(stale.status()).toBe(409);
    const blocked = await f.member.request.post(
      `/api/v1/notes/${resource.id}/export-preview`,
      { headers: { origin: "https://outside.invalid" }, data: input },
    );
    expect(blocked.status()).toBe(403);
    const queued = await f.member.request.post("/api/v1/exports", {
      headers: { origin },
      data: {
        resourceIds: [resource.id],
        spaceId: space.space_id,
        markdownSnapshot: snapshot,
      },
    });
    expect(queued.ok(), await queued.text()).toBeTruthy();
    const job = await queued.json();
    await expect
      .poll(
        async () =>
          (
            (await (
              await f.member.request.get("/api/v1/exports")
            ).json()) as any[]
          ).find((item) => item.id === job.id)?.status,
        { timeout: 40_000 },
      )
      .toBe("ready");
    const archive = await f.member.request.get(
      `/api/v1/exports/${job.id}/download`,
    );
    expect(archive.ok()).toBeTruthy();
    const zip = await JSZip.loadAsync(await archive.body());
    const md = Object.keys(zip.files).find((path) => path.endsWith(".md"))!;
    const bundledSource = await zip.file(md)!.async("string");
    expect(bundledSource).toContain("Not a persisted edit.");
    expect(bundledSource).not.toContain("/api/v1/attachments/");
    const evidencePath = Object.keys(zip.files).find((path) =>
      path.endsWith("/evidence.txt"),
    )!;
    expect(await zip.file(evidencePath)!.async("string")).toBe(
      "Immutable research evidence.",
    );
    expect(bundledSource).toContain(evidencePath);
    const removed = await f.owner.request.delete(
      `/api/v1/members/${me.user.id}?groupId=${f.group.id}`,
      { headers: { origin } },
    );
    expect(removed.ok(), await removed.text()).toBeTruthy();
    expect(
      (await f.member.request.get(`/api/v1/exports/${job.id}/download`)).ok(),
    ).toBe(false);
    expect(
      (
        await f.member.request.post(
          `/api/v1/notes/${resource.id}/export-preview`,
          { headers: { origin }, data: input },
        )
      ).ok(),
    ).toBe(false);
  } finally {
    await f.close();
  }
});
