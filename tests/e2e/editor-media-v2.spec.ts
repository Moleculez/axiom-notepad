import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin } from "./native-editor-helpers";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
test.use({
  trace: "off",
  serviceWorkers: "block",
  extraHTTPHeaders: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
});
test.beforeAll(() => {
  if (origin !== "http://localhost:3008")
    throw new Error("Use the isolated media candidate on port 3008.");
});

test("review uploads, insert figure, edit caption, retain codes, save and archive snippets", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const f = await fixture(browser, "Research\n\n");
  try {
    const api = async (
      path: string,
      data?: unknown,
      method = data ? "POST" : "GET",
    ) => {
      const response = await f.member.request.fetch("/api/v1/" + path, {
        method,
        headers: { origin },
        data,
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return response.json();
    };
    const resource = await api("resources/" + f.note.id);
    expect(resource.reference_code).toMatch(/-\d+$/);
    const editor = f.page.getByTestId("note-editor");
    await editor.press("ControlOrMeta+End");
    await f.page.keyboard.type("/image");
    await f.page.getByRole("option", { name: "Image", exact: true }).click();
    const dialog = f.page.getByRole("dialog", { name: "Insert an image" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: "Upload", exact: true }).click();
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "Research-spectrum.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAIAAAAzn+mLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAQUlEQVRIie2WQQkAQAzDpjNeqqoGT8WxPQITUEJTNqSnbtYTYKBKKHYILev6/OAwVkKxQ2hZ10cIH7RKKHaIz5Y9G0TtWz8OKy8AAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await dialog.getByRole("button", { name: "Upload & review" }).click();
    await expect(
      dialog.getByRole("button", { name: "Insert", exact: true }),
    ).toBeEnabled({ timeout: 45000 });
    await dialog
      .getByLabel("Insert as", { exact: true })
      .selectOption("figure");
    await dialog
      .getByLabel("Alternative text", { exact: true })
      .fill("Measured spectrum");
    await dialog
      .getByLabel("Caption", { exact: true })
      .fill("Energy **response**");
    await dialog
      .getByLabel("Figure label", { exact: true })
      .fill("fig-spectrum");
    await dialog
      .locator("summary")
      .filter({ hasText: "File identity" })
      .click();
    await expect(
      dialog.getByText("Pinned version ID", { exact: true }),
    ).toBeVisible();
    await f.page.screenshot({
      path: info.outputPath("image-insertion-review.png"),
    });
    const peer = await f.owner.newPage();
    await peer.goto("/workbench/notes/" + f.note.id);
    await expect(peer.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await peer.getByRole("button", { name: "Source", exact: true }).click();
    await peer.getByTestId("note-editor").press("ControlOrMeta+Home");
    await peer.keyboard.insertText("Peer preface\n\n");
    await expect.poll(f.source).toContain("Peer preface");
    await dialog.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(f.source).toContain('"label":"fig-spectrum"');
    const inserted = await f.source();
    expect(inserted).toMatch(/^Peer preface\n\nResearch\n\n<!-- axiom-media/);
    await editor.press("ControlOrMeta+z");
    await expect.poll(f.source).toBe("Peer preface\n\nResearch\n\n/image");
    await editor.press("ControlOrMeta+Shift+z");
    await expect.poll(f.source).toBe(inserted);
    await expect(editor.locator("figure.media-figure")).toBeVisible();
    await expect(
      editor.getByRole("img", { name: "Measured spectrum" }),
    ).toBeVisible();
    await editor.getByText("Energy response", { exact: true }).click();
    await expect(editor).not.toContainText("axiom-media");
    await f.page.screenshot({
      path: info.outputPath("rendered-research-figure.png"),
    });
    const body = await f.source();
    const versionId = /attachments\/([\da-f-]{36})/.exec(body)![1];
    const [resolved] = await api("media-assets", {
      versions: [versionId, randomUUID()],
    });
    expect(resolved.referenceCode).toMatch(/-\d+$/);
    expect(resolved.versionId).toBe(versionId);
    const byCode = await api("resource-code/" + resolved.referenceCode);
    expect(byCode.id).toBe(resolved.resourceId);
    const renamed = await api(
      "resources/" + byCode.id,
      {
        mutationId: randomUUID(),
        version: byCode.version,
        name: "Renamed spectrum.png",
      },
      "PATCH",
    );
    expect(renamed.reference_code).toBe(resolved.referenceCode);
    const prefix =
      "LAB" + randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
    const prefixSave = await f.owner.request.put(
      `/api/v1/spaces/${resource.space_id}/reference-prefix`,
      { headers: { origin }, data: { prefix } },
    );
    expect(prefixSave.ok(), await prefixSave.text()).toBeTruthy();
    const nextNote = await api("notes", {
      groupId: f.group.id,
      title: "Next identity",
      body: "",
    });
    expect((await api("resources/" + nextNote.id)).reference_code).toBe(
      prefix + "-1",
    );
    expect((await api("resources/" + byCode.id)).reference_code).toBe(
      resolved.referenceCode,
    );
    const snippet = await api("editor-snippets", {
      name: "Spectrum reference",
      body,
      tags: ["physics"],
      spaceId: resource.space_id,
    });
    expect(snippet.version).toBe(1);
    const usage = await api(`files/${resolved.resourceId}/usage`);
    expect(usage.references).toBeGreaterThan(0);
    const archived = await api(
      "editor-snippets/" + snippet.id,
      { version: snippet.version, archived: true, spaceId: resource.space_id },
      "PATCH",
    );
    expect(archived.archived).toBe(true);
    expect(archived.tags).toEqual(["physics"]);
    const conflict = await f.member.request.patch(
      `/api/v1/editor-snippets/${snippet.id}`,
      {
        headers: { origin },
        data: { version: 1, name: "Stale", spaceId: resource.space_id },
      },
    );
    expect(conflict.status()).toBe(409);
    const outsider = await browser.newContext({ baseURL: origin });
    const denied = await outsider.request.post("/api/v1/media-assets", {
      headers: { origin },
      data: { versions: [versionId] },
    });
    expect(denied.status()).toBe(401);
    await outsider.close();
  } finally {
    await f.close();
  }
});

test("source mode uses the same picker and cancellation preserves slash source", async ({
  browser,
}) => {
  const f = await fixture(browser, "Start\n\n");
  try {
    await f.page.getByRole("button", { name: "Source", exact: true }).click();
    await f.page.getByTestId("note-editor").press("ControlOrMeta+End");
    await f.page.keyboard.type("/pdf");
    await f.page
      .getByRole("option", { name: "PDF document", exact: true })
      .click();
    const dialog = f.page.getByRole("dialog", { name: "Insert an attachment" });
    await expect(dialog).toBeVisible();
    await f.page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect.poll(f.source).toBe("Start\n\n/pdf");
  } finally {
    await f.close();
  }
});

test("snippet library inserts an independent copy and checks report unavailable versions", async ({
  browser,
}, info) => {
  const missing = randomUUID();
  const f = await fixture(
    browser,
    `Research\n\n[Missing paper](/api/v1/attachments/${missing})\n\n`,
  );
  try {
    const noteResource = await (
      await f.member.request.get(`/api/v1/resources/${f.note.id}`)
    ).json();
    const created = await f.member.request.post("/api/v1/editor-snippets", {
      headers: { origin },
      data: {
        name: "Lab procedure",
        body: "## Procedure\n\nRecord the measurement.",
        tags: ["lab"],
        spaceId: noteResource.space_id,
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const editor = f.page.getByTestId("note-editor");
    await editor.press("ControlOrMeta+End");
    await f.page.keyboard.type("/snippets");
    await f.page
      .getByRole("option", { name: "Research snippets", exact: true })
      .click();
    const dialog = f.page.getByRole("dialog", { name: "Research snippets" });
    await dialog.getByRole("button", { name: /Lab procedure/ }).click();
    await expect(dialog.getByLabel("Markdown", { exact: true })).toHaveValue(
      "## Procedure\n\nRecord the measurement.",
    );
    await f.page.screenshot({ path: info.outputPath("snippet-library.png") });
    await dialog
      .getByRole("button", { name: "Insert copy", exact: true })
      .click();
    await expect
      .poll(f.source)
      .toContain("## Procedure\n\nRecord the measurement.");
    expect(await f.source()).not.toContain("/snippets");
    await editor.press("ControlOrMeta+Shift+.");
    const commands = f.page.getByRole("dialog", {
      name: "Editor commands",
      exact: true,
    });
    await commands
      .getByLabel("Find a command")
      .fill("Check document attachments");
    await commands
      .getByRole("option", { name: /Check document attachments/ })
      .click();
    const checks = f.page.getByRole("dialog", {
      name: "Document attachment check",
    });
    await expect(
      checks.getByRole("button", {
        name: /Attachment missing or inaccessible/,
      }),
    ).toBeVisible();
    await f.page.screenshot({ path: info.outputPath("attachment-check.png") });
    await checks
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await editor.getByRole("link", { name: "Missing paper" }).hover();
    await expect(
      f.page.getByRole("dialog", { name: "Linked file actions" }),
    ).toContainText("missing or inaccessible");
  } finally {
    await f.close();
  }
});
