import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { PDFDocument } = createRequire(import.meta.url)(
  "pdf-lib",
) as typeof import("pdf-lib");
import { fixture, origin } from "./native-editor-helpers";
test.use({ actionTimeout: 15000 });
test.beforeAll(() => {
  if (origin !== "http://localhost:3008")
    throw new Error(
      "Documentation acceptance requires isolated staging on port 3008.",
    );
});
async function call(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data ? "POST" : "GET",
) {
  const response = await request.fetch("/api/v1/" + path, {
    method,
    data,
    headers: { origin },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test("Docs navigation, genuine disposable editor/Canvas, and no document requests", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const f = await fixture(browser, "# A real note\n\nUnchanged.\n");
  try {
    await f.page.getByRole("link", { name: "Open Docs" }).click();
    await expect(
      f.page.getByRole("main", { name: "Product documentation" }),
    ).toBeVisible();
    const searchAlignment = await f.page
      .locator(".docs-search")
      .evaluate((el) => {
        const icon = el.querySelector("svg")!.getBoundingClientRect(),
          input = el.querySelector("input")!.getBoundingClientRect();
        return Math.abs(icon.y + icon.height / 2 - input.y - input.height / 2);
      });
    expect(searchAlignment).toBeLessThan(2);
    const writes: string[] = [],
      sockets: string[] = [];
    f.page.on("request", (r) => {
      if (
        /\/api\/v1\/(notes|tools|uploads|resources|sync-token)/.test(r.url()) &&
        r.method() !== "GET"
      )
        writes.push(r.url());
    });
    f.page.on("websocket", (s) => sockets.push(s.url()));
    await f.page
      .getByRole("navigation", { name: "Documentation chapters" })
      .getByRole("link", { name: "Write, Source & Read" })
      .click();
    await f.page
      .getByRole("button", { name: "Open example", exact: true })
      .click();
    const editor = f.page.getByTestId("settings-scratchpad");
    await expect(editor).toBeVisible();
    await editor.click();
    await editor.press("ControlOrMeta+End");
    await f.page.keyboard.insertText("Disposable evidence");
    await expect(editor).toContainText("Disposable evidence");
    await f.page
      .getByRole("button", { name: "Reset sample", exact: true })
      .click();
    await expect(editor).not.toContainText("Disposable evidence");
    await f.page.getByRole("button", { name: "Source", exact: true }).click();
    await expect(editor).toContainText("# A research question");
    await f.page.screenshot({ path: info.outputPath("docs-editor.png") });
    await f.page
      .getByRole("navigation", { name: "Documentation chapters" })
      .getByRole("link", { name: "Think on a Canvas" })
      .click();
    await expect(editor).toHaveCount(0);
    await f.page
      .getByRole("button", { name: "Open example", exact: true })
      .click();
    await expect(f.page.locator(".docs-canvas .canvas-card")).toHaveCount(2);
    await f.page
      .getByText("What changes the result?", { exact: true })
      .dblclick();
    const card = f.page.getByTestId("canvas-card-editor");
    await expect(card).toBeVisible();
    await card.press("ControlOrMeta+End");
    await f.page.keyboard.insertText("Temporary Canvas idea");
    await expect(card).toContainText("Temporary Canvas idea");
    const remote: string[] = [];
    await f.page.route("https://example.org/**", (route) => {
      remote.push(route.request().url());
      return route.abort();
    });
    await f.page
      .locator(".canvas-card.is-editing")
      .getByRole("button", { name: "Source", exact: true })
      .click();
    await card.press("ControlOrMeta+a");
    await f.page.keyboard.insertText(
      "[Remote](https://example.org)\n\n![External image](https://example.org/sandbox-image.png)\n",
    );
    await card.press("Escape");
    await f.page.getByRole("link", { name: "Remote", exact: true }).click();
    await expect(f.page).toHaveURL(/\/docs\/canvas\/basics/);
    expect(remote).toEqual([]);
    await f.page
      .getByRole("button", { name: "Reset sample", exact: true })
      .click();
    await expect(f.page.locator(".docs-canvas")).not.toContainText(
      "Temporary Canvas idea",
    );
    await f.page.screenshot({ path: info.outputPath("docs-canvas.png") });
    await expect.poll(f.source).toBe("# A real note\n\nUnchanged.\n");
    expect(writes).toEqual([]);
    expect(sockets).toEqual([]);
    await f.page.getByLabel("Search documentation").fill("footnote");
    await expect(
      f.page
        .getByRole("navigation", { name: "Documentation chapters" })
        .getByRole("link", { name: "Footnotes, metadata & link definitions" }),
    ).toBeVisible();
    await f.page
      .getByRole("link", { name: "Reference library", exact: true })
      .first()
      .click();
    await expect(f.page).toHaveURL(/\/research\/references/);
  } finally {
    await f.close();
  }
});
test("bounded research scope, private evidence, stale preview and idempotent synthesis", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const f = await fixture(browser, "# Research safety\n");
  try {
    const spaces = await call(f.member.request, "spaces"),
      team = spaces.find(
        (s: any) => s.group_id === f.group.id && s.kind === "team",
      ),
      personal = spaces.find((s: any) => s.kind === "personal");
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("Measured evidence");
    const bytes = Buffer.from(await pdf.save()),
      upload = randomUUID();
    await call(f.member.request, "uploads", {
      id: upload,
      spaceId: team.id,
      name: "Measured-evidence.pdf",
      bytes: bytes.length,
    });
    const chunk = await f.member.request.put(
      `/api/v1/uploads/${upload}/chunks/1`,
      {
        headers: { origin, "content-type": "application/octet-stream" },
        data: bytes,
      },
    );
    expect(chunk.ok()).toBeTruthy();
    await call(f.member.request, `uploads/${upload}/complete`, {});
    await expect
      .poll(
        async () => (await call(f.member.request, `uploads/${upload}`)).status,
        { timeout: 45000 },
      )
      .toBe("complete");
    const file = await call(
        f.member.request,
        `resources/${(await call(f.member.request, `uploads/${upload}`)).resourceId}`,
      ),
      meta = await call(
        f.member.request,
        `attachments/${file.current_version_id}/meta`,
      );
    const annotation = {
      id: randomUUID(),
      version: 0,
      mutation_id: randomUUID(),
      shared: false,
      data: {
        kind: "note",
        page: 1,
        sha256: meta.sha256,
        rects: [],
        quote: "Measured evidence",
        body: "Private interpretation",
        color: "yellow",
      },
    };
    const saved = await call(
      f.member.request,
      `attachments/${meta.id}/annotations`,
      annotation,
      "PUT",
    );
    const reading = {
      id: randomUUID(),
      group_id: f.group.id,
      kind: "reading",
      target_type: "attachment",
      target_id: meta.id,
      data: { status: "reading", label: "Measured evidence" },
      version: 0,
      mutation_id: randomUUID(),
    };
    await call(f.member.request, "me/reading", reading, "PUT");
    const own = await call(
        f.member.request,
        `research/workbench?groupId=${f.group.id}&view=evidence`,
      ),
      other = await call(
        f.owner.request,
        `research/workbench?groupId=${f.group.id}&view=evidence`,
      );
    expect(own.items.some((i: any) => i.id === annotation.id)).toBe(true);
    expect(other.items).toEqual([]);
    const page1 = await call(
      f.member.request,
      `research/workbench?groupId=${f.group.id}&limit=1`,
    );
    expect(page1.items).toHaveLength(1);
    expect(page1.next).toBeTruthy();
    const page2 = await call(
      f.member.request,
      `research/workbench?groupId=${f.group.id}&limit=1&cursor=${page1.next}`,
    );
    expect(page2.items[0].key).not.toBe(page1.items[0].key);
    const privateList = await call(
      f.member.request,
      `research/workbench?spaceId=${personal.id}`,
    );
    expect(privateList.items).toEqual([]);
    const input = {
      selection: [{ kind: "annotation", id: annotation.id }],
      groupId: f.group.id,
      spaceId: null,
      destination: team.id,
      name: "Evidence synthesis",
      type: "markdown",
      id: randomUUID(),
      mutationId: randomUUID(),
    };
    const preview = await call(
      f.member.request,
      "research/synthesis/preview",
      input,
    );
    expect(preview.privateCount).toBe(1);
    expect(preview.source).toContain("Private interpretation");
    const create = (extra: object) =>
      f.member.request.post("/api/v1/research/synthesis/create", {
        headers: { origin },
        data: { ...input, expectedHash: preview.hash, ...extra },
      });
    expect((await create({})).status()).toBe(400);
    await call(
      f.member.request,
      `attachments/${meta.id}/annotations`,
      {
        ...annotation,
        version: saved.version,
        mutation_id: randomUUID(),
        data: { ...annotation.data, body: "Revised private interpretation" },
      },
      "PUT",
    );
    expect((await create({ acknowledgePrivate: true })).status()).toBe(409);
    expect(
      (await f.member.request.get(`/api/v1/resources/${input.id}`)).status(),
    ).toBe(404);
    const fresh = await call(
      f.member.request,
      "research/synthesis/preview",
      input,
    );
    const created = await create({
      expectedHash: fresh.hash,
      acknowledgePrivate: true,
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const retry = await create({
      expectedHash: fresh.hash,
      acknowledgePrivate: true,
    });
    expect(retry.ok(), await retry.text()).toBeTruthy();
    expect((await retry.json()).id).toBe(input.id);
    expect((await call(f.member.request, `notes/${input.id}`)).body).toContain(
      "Revised private interpretation",
    );
    const canvas = {
      ...input,
      type: "canvas",
      id: randomUUID(),
      mutationId: randomUUID(),
      destination: personal.id,
    };
    const cp = await call(
      f.member.request,
      "research/synthesis/preview",
      canvas,
    );
    expect(JSON.parse(cp.source).nodes).toHaveLength(3);
    await call(f.member.request, "research/synthesis/create", {
      ...canvas,
      expectedHash: cp.hash,
    });
    await f.page.goto(
      `/workbench/research?groupId=${f.group.id}&view=evidence`,
    );
    await expect(
      f.page.getByText("Revised private interpretation", { exact: true }),
    ).toBeVisible();
    await f.page
      .getByLabel("Select Measured-evidence.pdf", { exact: true })
      .check();
    await f.page
      .getByRole("button", { name: "Create from evidence", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Preview draft", exact: true })
      .click();
    await expect(f.page.getByLabel("Synthesis preview")).toContainText(
      "Revised private interpretation",
    );
    await f.page.screenshot({
      path: info.outputPath("research-synthesis.png"),
    });
    await f.page.getByLabel("Format", { exact: true }).selectOption("canvas");
    await f.page
      .getByRole("button", { name: "Preview draft", exact: true })
      .click();
    await expect(f.page.locator(".synthesis-preview .canvas-card")).toHaveCount(
      3,
    );
    await expect(
      f.page
        .locator(".synthesis-preview")
        .getByRole("button", { name: "Add text card", exact: true }),
    ).toBeDisabled();
    await f.page.getByRole("button", { name: "Cancel", exact: true }).click();
    const exposed = await call(
      f.member.request,
      `attachments/${meta.id}/annotations`,
      {
        ...annotation,
        version: saved.version + 1,
        mutation_id: randomUUID(),
        shared: true,
      },
      "PUT",
    );
    const sharedList = await call(
      f.owner.request,
      `research/workbench?groupId=${f.group.id}&view=evidence&author=shared`,
    );
    expect(sharedList.items.some((i: any) => i.id === annotation.id)).toBe(
      true,
    );
    const mine = await call(
      f.owner.request,
      `research/workbench?groupId=${f.group.id}&view=evidence`,
    );
    expect(mine.items).toEqual([]);
    const ownerInput = { ...input, id: randomUUID(), mutationId: randomUUID() };
    const ownerPreview = await call(
      f.owner.request,
      "research/synthesis/preview",
      ownerInput,
    );
    await call(
      f.member.request,
      `attachments/${meta.id}/annotations`,
      {
        ...annotation,
        version: exposed.version,
        mutation_id: randomUUID(),
        shared: false,
      },
      "PUT",
    );
    const denied = await f.owner.request.post(
      "/api/v1/research/synthesis/create",
      {
        headers: { origin },
        data: { ...ownerInput, expectedHash: ownerPreview.hash },
      },
    );
    expect(denied.status()).toBe(409);
    expect(
      (
        await f.owner.request.get(`/api/v1/resources/${ownerInput.id}`)
      ).status(),
    ).toBe(404);
  } finally {
    await f.close();
  }
});
