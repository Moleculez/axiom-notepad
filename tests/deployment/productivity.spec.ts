import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const origin = process.env.TEST_APP_URL!;
test.beforeAll(() => {
  if (
    origin !== "https://localhost:8443" ||
    !process.env.AXIOM_REHEARSAL_DIR ||
    !process.env.TEST_OWNER_PASSWORD
  )
    throw new Error(
      "Run through npm run test:deployment with its isolated Compose dataset.",
    );
});
async function api(
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
  expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
  return response.json();
}
const receipt = () => `${process.env.AXIOM_REHEARSAL_DIR}/content.json`;
async function login(request: APIRequestContext) {
  const result = await request.post("/api/auth/sign-in/email", {
    headers: { origin },
    data: {
      email: process.env.TEST_OWNER_EMAIL,
      password: process.env.TEST_OWNER_PASSWORD,
    },
  });
  expect(result.ok(), await result.text()).toBe(true);
}

test("fresh production productivity workflow", async ({
  browser,
  context,
  page,
}, info) => {
  await login(context.request);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const group = await api(context.request, "groups", {
    name: "Deployment research group",
  });
  const invite = await api(context.request, "invitations", {
    groupId: group.id,
    email: `colleague-${randomUUID()}@axiom.test`,
  });
  const member = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    await api(member.request, "register", {
      token: new URL(invite.link).searchParams.get("invite"),
      name: "Deployment colleague",
      password: "Isolated-rehearsal-only-2026!",
    });
    const space = (await api(context.request, "spaces")).find(
      (s: any) => s.group_id === group.id && s.kind === "team",
    );
    expect(space).toBeTruthy();
    const note = await api(context.request, "notes", {
      groupId: group.id,
      title: "Deployment evidence",
      body: "# Shared evidence\n\nInitial result.\n",
    });
    await page.goto(`/workbench/notes/${note.id}`);
    await expect(
      page
        .locator('[data-engine="milkdown"]')
        .filter({ has: page.getByTestId("note-editor") }),
    ).toBeVisible();
    await expect(page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    const peer = await member.newPage();
    await peer.goto(`/workbench/notes/${note.id}`);
    await expect(peer.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await page.getByRole("button", { name: "Source", exact: true }).click();
    const editor = page.getByTestId("note-editor");
    await editor.click();
    await editor.press("ControlOrMeta+a");
    const body =
      "# Shared evidence\n\nVerified collaboration.\n\n$$\nE=mc^2\n$$\n";
    await page.keyboard.insertText(body);
    await expect(peer.getByTestId("note-editor")).toContainText(
      "Verified collaboration.",
    );
    await expect
      .poll(async () => (await api(context.request, `notes/${note.id}`)).body)
      .toBe(body);
    await expect(page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );

    const id = randomUUID(),
      bytes = Buffer.from("Axiom isolated deployment file\n"),
      hash = createHash("sha256").update(bytes).digest("hex");
    await api(context.request, "uploads", {
      id,
      spaceId: space.id,
      name: "evidence.txt",
      bytes: bytes.length,
    });
    expect(
      (
        await context.request.put(`/api/v1/uploads/${id}/chunks/1`, {
          data: bytes,
          headers: { origin, "content-type": "application/octet-stream" },
        })
      ).ok(),
    ).toBe(true);
    await api(context.request, `uploads/${id}/complete`, {});
    let uploaded: any;
    await expect
      .poll(
        async () => {
          uploaded = await api(context.request, `uploads/${id}`);
          return uploaded.status;
        },
        { timeout: 45000 },
      )
      .toBe("complete");
    const preview = await api(
      context.request,
      `files/${uploaded.resourceId}/preview`,
    );
    expect(preview.kind).toBe("text");
    const download = await context.request.get(preview.source);
    expect(download.ok()).toBe(true);
    expect(
      createHash("sha256")
        .update(await download.body())
        .digest("hex"),
    ).toBe(hash);

    const canvas = await api(context.request, "files/new", {
      type: "canvas",
      name: "Research map",
      spaceId: space.id,
      mutationId: randomUUID(),
    });
    await page.goto(`/workbench/tools/canvas/${canvas.id}`);
    await expect(page.locator(".canvas-status")).toContainText(
      "Saved on server",
    );
    await page
      .getByRole("button", { name: "Add text card", exact: true })
      .click();
    await page
      .locator(".canvas-card.is-editing")
      .getByRole("button", { name: "Source", exact: true })
      .click();
    await page
      .getByLabel("Card Markdown")
      .fill("# Reproducible result\n\nA preserved card.");
    await page.getByLabel("Card Markdown").press("Escape");
    await expect(page.locator(".canvas-status")).toContainText(
      "Saved on server",
    );
    await page.screenshot({
      path: info.outputPath("production-canvas-current.png"),
      fullPage: true,
    });

    const folder = await api(context.request, "resources", {
      kind: "folder",
      spaceId: space.id,
      name: "Recoverable folder",
    });
    await api(context.request, `resources/${folder.id}/trash`, {
      version: folder.version,
    });
    const trashed = await api(context.request, `resources/${folder.id}`);
    await api(context.request, `resources/${folder.id}/restore`, {
      version: trashed.version,
    });
    const restored = await api(context.request, `resources/${folder.id}`);
    expect(restored.deleted_at).toBeNull();
    await api(context.request, `resources/${folder.id}/trash`, {
      version: restored.version,
    });
    const purge = await api(context.request, "trash/preview", {
      action: "purge",
      spaceIds: [space.id],
      ids: [folder.id],
      mutationId: randomUUID(),
    });
    await api(context.request, `trash/${purge.operation.id}/confirm`, {
      confirmation: "DELETE FOREVER",
      mutationId: randomUUID(),
    });
    await expect
      .poll(
        async () =>
          (await api(context.request, `trash/${purge.operation.id}`)).operation
            .status,
      )
      .toBe("completed");

    const exported = await api(context.request, "exports", {
      spaceId: space.id,
      resourceIds: [uploaded.resourceId, canvas.id],
      mutationId: randomUUID(),
    });
    await expect
      .poll(
        async () =>
          (await api(context.request, "exports")).find(
            (item: any) => item.id === exported.id,
          )?.status,
        { timeout: 45000 },
      )
      .toBe("ready");
    expect(
      (
        await context.request.get(`/api/v1/exports/${exported.id}/download`)
      ).ok(),
    ).toBe(true);
    await page.goto(`/workbench/explorer?space=${space.id}`);
    await expect(
      page.getByText("evidence.txt", { exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("production-explorer-current.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    await writeFile(
      receipt(),
      JSON.stringify(
        {
          note: note.id,
          canvas: canvas.id,
          file: uploaded.resourceId,
          body,
          hash,
          group: group.id,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } finally {
    await member.close();
  }
});

test("research survives service restart", async ({ context, page }) => {
  const saved = JSON.parse(await readFile(receipt(), "utf8"));
  await login(context.request);
  expect((await api(context.request, `notes/${saved.note}`)).body).toBe(
    saved.body,
  );
  const canvas = JSON.parse(
    (await api(context.request, `notes/${saved.canvas}`)).body,
  );
  expect(canvas.nodes[0].text).toContain("A preserved card.");
  const preview = await api(context.request, `files/${saved.file}/preview`);
  const downloaded = await context.request.get(preview.source);
  expect(
    createHash("sha256")
      .update(await downloaded.body())
      .digest("hex"),
  ).toBe(saved.hash);
  await page.goto(`/workbench/notes/${saved.note}`);
  await expect(
    page
      .locator('[data-engine="milkdown"]')
      .filter({ has: page.getByTestId("note-editor") }),
  ).toBeVisible();
  await expect(page.locator(".ws-document-status")).toContainText(
    "Saved on server",
  );
});
