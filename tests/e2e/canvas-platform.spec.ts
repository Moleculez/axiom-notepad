import { test, expect, type APIRequestContext } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fixture, origin } from "./native-editor-helpers";
const JSZip: typeof import("jszip") = createRequire(import.meta.url)("jszip");
let f: Awaited<ReturnType<typeof fixture>>, spaceId: string;
const call = async (
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) => {
  const response = await request.fetch(`/api/v1/${path}`, {
    method,
    data,
    headers: { origin },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
};
test.beforeAll(async ({ browser }) => {
  test.setTimeout(120000);
  if (!["http://localhost:3002", "http://localhost:3004"].includes(origin))
    throw new Error(
      "Use an isolated platform staging database on port 3002 or 3004.",
    );
  f = await fixture(
    browser,
    "# Platform acceptance\n\nResearch stays intact.\n",
  );
  spaceId = (await call(f.member.request, "spaces")).find(
    (s: any) => s.kind === "team" && s.group_id === f.group.id,
  ).id;
});
test.afterAll(async () => {
  await f?.close();
});

for (const kind of ["math", "image", "canvas", "text"])
  test(`Creating ${kind} replaces the creation tab and its history`, async ({}, info) => {
    test.setTimeout(90000);
    const page = f.page;
    await page.goto(`/workbench/tools/${kind}/new?space=${spaceId}`);
    await page.getByLabel("Project name").fill(`Tab replacement ${kind}`);
    await expect(
      page.getByRole("button", { name: "Create project", exact: true }),
    ).toBeEnabled();
    const before = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find((k) =>
            k.startsWith("axiom:application-tabs:"),
          )!,
        )!,
      ),
    );
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/tools/${kind}/[a-f0-9-]{36}$`));
    const after = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find((k) =>
            k.startsWith("axiom:application-tabs:"),
          )!,
        )!,
      ),
    );
    expect(after.tabs.length).toBe(before.tabs.length);
    expect(after.active).toBe(before.active);
    const tab = after.tabs.find((t: any) => t.id === before.active);
    expect(tab.path).not.toContain("/new");
    expect(
      tab.history.some((p: string) => p.includes(`/tools/${kind}/new`)),
    ).toBe(false);
    await expect(
      page.getByRole("heading", { name: new RegExp(`New ${kind}`) }),
    ).toHaveCount(0);
    await expect(
      page.locator(kind === "text" ? ".plain-text-studio" : `.${kind}-studio`),
    ).toBeVisible();
    if (kind !== "image")
      await expect(page.locator(".studio-status,.canvas-status")).toContainText(
        "Saved on server",
      );
    else
      await expect(
        page.getByLabel("Image canvas", { exact: true }),
      ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`created-${kind}-current.png`),
      fullPage: true,
    });
  });

test("A creation finishing in the background replaces only its originating tab", async () => {
  const page = f.page;
  await page.goto(`/workbench/tools/text/new?space=${spaceId}`);
  await page.getByLabel("Project name").fill("Background creation");
  const tabs = () =>
    page.evaluate(() =>
      JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find((k) =>
            k.startsWith("axiom:application-tabs:"),
          )!,
        )!,
      ),
    );
  const creation = (await tabs()).active;
  let release!: () => void, intercepted!: () => void;
  const hold = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      intercepted = resolve;
    });
  await page.route("**/api/v1/tools", async (route) => {
    if (route.request().method() === "POST") {
      intercepted();
      await hold;
    }
    await route.continue();
  });
  try {
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await started;
    await page.getByRole("tab").first().click();
    const active = (await tabs()).active,
      url = page.url();
    expect(active).not.toBe(creation);
    release();
    await expect
      .poll(
        async () =>
          (await tabs()).tabs.find((t: any) => t.id === creation).path,
      )
      .toMatch(/\/tools\/text\/[a-f0-9-]{36}$/);
    expect((await tabs()).active).toBe(active);
    expect(page.url()).toBe(url);
  } finally {
    release();
    await page.unroute("**/api/v1/tools");
  }
});

test("Canvas collaborates, preserves local undo, drags, and reloads canonical JSON", async ({}, info) => {
  test.setTimeout(120000);
  const canvas = await call(f.member.request, "files/new", {
    type: "canvas",
    name: "Connected research",
    spaceId,
    mutationId: randomUUID(),
  });
  const a = f.page,
    b = await f.owner.newPage();
  await a.goto(`/workbench/tools/canvas/${canvas.id}`);
  await b.goto(`/workbench/tools/canvas/${canvas.id}`);
  await expect(a.locator(".canvas-status")).toContainText("Saved on server");
  await expect(b.locator(".canvas-status")).toContainText("Saved on server");
  await a.getByRole("button", { name: "Add text card", exact: true }).click();
  await expect(a.getByLabel("Card Markdown")).toBeVisible();
  await a
    .locator(".canvas-card.is-editing")
    .getByRole("button", { name: "Source", exact: true })
    .click();
  await a.getByLabel("Card Markdown").fill("# Hypothesis\n\nEnergy: $E=mc^2$");
  await a.getByLabel("Card Markdown").press("Escape");
  await expect(b.locator(".canvas-card")).toContainText("Hypothesis");
  await b.getByRole("button", { name: "Add text card", exact: true }).click();
  await b
    .locator(".canvas-card.is-editing")
    .getByRole("button", { name: "Source", exact: true })
    .click();
  await b.getByLabel("Card Markdown").fill("Independent observation");
  await b.getByLabel("Card Markdown").press("Escape");
  await expect(a.locator(".canvas-card")).toHaveCount(2);
  const card = a.locator(".canvas-card").first(),
    before = await card.boundingBox();
  await a.mouse.move(before!.x + 30, before!.y + 30);
  await a.mouse.down();
  await a.mouse.move(before!.x - 80, before!.y - 40, { steps: 8 });
  await a.mouse.up();
  await expect
    .poll(async () => (await card.boundingBox())!.x)
    .toBeLessThan(before!.x - 50);
  await a.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(a.locator(".canvas-card").last()).toContainText(
    "Independent observation",
  );
  await expect
    .poll(async () => (await card.boundingBox())!.x)
    .toBeCloseTo(before!.x, 0);
  await expect(a.locator(".canvas-status")).toContainText("Saved on server");
  const source = await call(f.member.request, `notes/${canvas.id}`);
  expect(source.source_format).toBe("canvas");
  expect(JSON.parse(source.body).nodes).toHaveLength(2);
  await a.reload();
  await expect(a.locator(".canvas-card")).toHaveCount(2);
  await expect(a.locator(".canvas-status")).toContainText("Saved on server");
  await a.getByRole("button", { name: "Zoom to fit" }).click();
  await a.screenshot({
    path: info.outputPath("canvas-current.png"),
    fullPage: true,
  });
  await b.close();
});

test("Canvas text cards render immediately, edit rich text, toggle source and never create cards on text double-click", async ({}, info) => {
  test.setTimeout(90000);
  const source =
    "# Visible immediately\n\nA **bold** observation.\n\n| Quantity | Model |\n| --- | --- |\n| Energy | $E=mc^2$ |\n\n$$\n\\frac{1}{2}\n$$\n";
  const created = await call(f.member.request, "files/new", {
    type: "canvas",
    name: "Inline research cards",
    spaceId,
    mutationId: randomUUID(),
    source: JSON.stringify({
      nodes: [
        {
          id: "rich-card",
          type: "text",
          text: source,
          x: 0,
          y: 0,
          width: 520,
          height: 540,
        },
      ],
      edges: [],
    }),
  });
  const a = f.page,
    b = await f.owner.newPage();
  try {
    await a.goto(`/workbench/tools/canvas/${created.id}`);
    await b.goto(`/workbench/tools/canvas/${created.id}`);
    const card = a.locator('[data-canvas-node="rich-card"]');
    // Neither client focuses a card before these assertions.
    await expect(
      card.getByRole("heading", { name: "Visible immediately" }),
    ).toBeVisible();
    await expect(card.locator("strong")).toHaveText("bold");
    await expect(card.locator("table")).toBeVisible();
    await expect(
      card.locator('[data-math-state="ready"]').last(),
    ).toBeVisible();
    await expect(b.locator(".canvas-card h1")).toContainText(
      "Visible immediately",
    );
    await card.getByRole("heading", { name: "Visible immediately" }).dblclick();
    const editor = a.getByLabel("Card Markdown", { exact: true });
    await expect(editor).toBeVisible();
    await expect(a.locator(".canvas-card")).toHaveCount(1);
    await expect(
      card.locator('.axiom-editor[data-mode="write"]'),
    ).toBeVisible();
    await editor.press("ControlOrMeta+End");
    await editor.press("Enter");
    await a.keyboard.insertText("Rich text stays collaborative.");
    await expect(b.locator(".canvas-card-body")).toContainText(
      "Rich text stays collaborative.",
    );
    await editor.dblclick();
    await expect(a.locator(".canvas-card")).toHaveCount(1);
    await card.getByRole("button", { name: "Source", exact: true }).click();
    await expect(
      card.locator('.axiom-editor[data-mode="source"]'),
    ).toBeVisible();
    await expect(editor).toContainText("# Visible immediately");
    await expect(editor).toContainText("Rich text stays collaborative.");
    await editor.press("ControlOrMeta+End");
    await a.keyboard.insertText("\n\nSource and Write share one document.");
    await editor.press("ControlOrMeta+/");
    await expect(
      card.locator('.axiom-editor[data-mode="write"]'),
    ).toBeVisible();
    await expect(editor).toContainText("Source and Write share one document.");
    await expect(card.locator("table")).toBeVisible();
    await editor.press("Escape");
    await expect(card.locator(".canvas-card-editor")).toHaveCount(0);
    await expect(
      card.getByRole("heading", { name: "Visible immediately" }),
    ).toBeVisible();
    await card.getByRole("heading", { name: "Visible immediately" }).dblclick();
    await expect(editor).toBeVisible();
    await expect(a.locator(".canvas-card")).toHaveCount(1);
    await editor.press("Escape");
    const area = (await a.locator(".canvas-board").boundingBox())!;
    await a.mouse.dblclick(area.x + 35, area.y + 35);
    await expect(a.locator(".canvas-card")).toHaveCount(1);
    await a.getByRole("button", { name: "Add text card", exact: true }).click();
    await expect(a.locator(".canvas-card")).toHaveCount(2);
    await expect(a.getByLabel("Card Markdown", { exact: true })).toBeVisible();
    await a.keyboard.insertText("A new card starts in Write mode.");
    await expect(
      a.locator('.canvas-card.is-editing .axiom-editor[data-mode="write"]'),
    ).toBeVisible();
    await expect(b.locator(".canvas-card")).toHaveCount(2);
    await expect(a.locator(".canvas-status")).toContainText("Saved on server");
    await a.getByRole("button", { name: "Zoom to fit", exact: true }).click();
    await a.screenshot({
      path: info.outputPath("canvas-rich-cards-current.png"),
      fullPage: true,
    });
    await a.reload();
    await expect(a.locator(".canvas-card")).toHaveCount(2);
    await expect(
      a
        .locator(".canvas-card-body")
        .filter({ hasText: "Source and Write share one document." }),
    ).toBeVisible();
  } finally {
    await b.close();
  }
});

test("Explorer blank-space menu has keyboard submenus and creates native files in the selected folder", async ({}, info) => {
  const folder = await call(f.member.request, "resources", {
    spaceId,
    name: "Platform files",
    kind: "folder",
    mutationId: randomUUID(),
  });
  const page = f.page;
  await page.goto(`/workbench/explorer?space=${spaceId}&folder=${folder.id}`);
  const area = page.locator(".ws-explorer-main");
  await expect(
    page.getByRole("heading", { name: "Platform files", exact: true }),
  ).toBeVisible();
  // The page surface, including empty space below the list, is a creation target.
  const region = area
    .count()
    .then(async (n) => (n ? area : page.locator(".ws-resource-container")));
  await (await region).click({ button: "right", position: { x: 30, y: 180 } });
  await expect(
    page.getByRole("menuitem", { name: /Research file/ }),
    JSON.stringify(await call(f.member.request, "spaces")),
  ).toBeEnabled();
  await page.getByRole("menuitem", { name: /Research file/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("menuitem", { name: "Canvas", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("menuitem", { name: /Research file/ }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: /Text & data/ }).hover();
  await page.getByRole("menuitem", { name: "Plain text", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Experiment log");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Create/ })
    .click();
  await expect(page.getByLabel("Text source")).toBeVisible();
  expect(await page.getByRole("menu").count()).toBe(0);
  const items = await call(
    f.member.request,
    `resources?spaceId=${spaceId}&parentId=${folder.id}`,
  );
  expect(
    items.items.some(
      (r: any) => r.name === "Experiment log.txt" && r.document_type === "text",
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("text-studio-current.png"),
    fullPage: true,
  });
});

test("Explorer marquee selection clears on blank click and details resize persists", async ({}, info) => {
  const folder = await call(f.member.request, "resources", {
    spaceId,
    name: "Selection acceptance",
    kind: "folder",
    mutationId: randomUUID(),
  });
  for (const name of ["Alpha.txt", "Beta.txt", "Gamma.txt"])
    await call(f.member.request, "files/new", {
      type: "text",
      name,
      spaceId,
      parentId: folder.id,
      mutationId: randomUUID(),
    });
  const page = f.page;
  await page.goto(`/workbench/explorer?space=${spaceId}&folder=${folder.id}`);
  await page.getByRole("button", { name: "List view", exact: true }).click();
  const rows = page.locator(".ws-resource-row");
  await expect(rows).toHaveCount(3);
  const main = page.locator(".ws-explorer-main"),
    region = (await main.boundingBox())!,
    first = (await rows.first().boundingBox())!,
    last = (await rows.last().boundingBox())!;
  // Begin in the gutter, not on a draggable file, and sweep across two rows.
  const blank = { x: region.x + 8, y: last.y + last.height + 60 };
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.down();
  await page.mouse.move(first.x + 80, first.y + first.height + 10, {
    steps: 10,
  });
  await expect(page.locator(".explorer-selection-rectangle")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".ws-resource-row.selected")).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "Selection actions" }),
  ).toBeVisible();
  await page.mouse.click(blank.x, blank.y);
  await expect(page.locator(".ws-resource-row.selected")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Selection actions" }),
  ).toHaveCount(0);
  await rows
    .first()
    .getByRole("button", { name: /Details for/ })
    .click();
  const panel = page.locator(".ws-inspector"),
    divider = page.getByRole("separator", { name: "Resize details panel" }),
    before = (await panel.boundingBox())!,
    handle = (await divider.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x - 78, handle.y + 100, { steps: 8 });
  await page.mouse.up();
  const width = Number(await divider.getAttribute("aria-valuenow"));
  expect(width).toBeGreaterThan(before.width + 60);
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  await rows
    .first()
    .getByRole("button", { name: /Details for/ })
    .click();
  await expect(divider).toHaveAttribute("aria-valuenow", String(width));
  await page.screenshot({
    path: info.outputPath("explorer-details-current.png"),
    fullPage: true,
  });
});

test("MCP OAuth consent, tools, approval, stale edits and revoked tokens are enforced", async ({
  playwright,
}, info) => {
  test.setTimeout(120000);
  const request = f.owner.request;
  const external = await playwright.request.newContext({ baseURL: origin });
  const registration = await external.post("/api/auth/oauth2/register", {
    data: {
      client_name: "Research assistant acceptance",
      application_type: "native",
      redirect_uris: ["http://127.0.0.1:8589/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope:
        "openid offline_access workspace:read workspace:write workspace:manage",
    },
  });
  expect(registration.ok(), await registration.text()).toBeTruthy();
  const client = await registration.json(),
    verifier = randomBytes(32).toString("base64url"),
    state = randomUUID();
  const params = new URLSearchParams({
    client_id: client.client_id,
    response_type: "code",
    redirect_uri: "http://127.0.0.1:8589/callback",
    scope: client.scope,
    resource: `${origin}/mcp`,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  const authorization = await request.get(
    `/api/auth/oauth2/authorize?${params}`,
    { maxRedirects: 0 },
  );
  expect(authorization.status(), await authorization.text()).toBe(302);
  const page = await f.owner.newPage();
  await page.route("http://127.0.0.1:8589/callback**", (route) =>
    route.fulfill({ body: "Authorization returned to the client." }),
  );
  await page.goto(authorization.headers().location);
  await page.getByRole("checkbox", { name: new RegExp(f.group.name) }).check();
  await page.screenshot({ path: info.outputPath("mcp-consent-current.png") });
  await page
    .getByRole("button", { name: /Connect|Allow/, exact: false })
    .click();
  await page.waitForURL("http://127.0.0.1:8589/callback**");
  const callback = new URL(page.url());
  expect(callback.searchParams.get("state")).toBe(state);
  expect(callback.searchParams.get("error")).toBeNull();
  const tokenResponse = await external.post("/api/auth/oauth2/token", {
    form: {
      grant_type: "authorization_code",
      code: callback.searchParams.get("code")!,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: "http://127.0.0.1:8589/callback",
      resource: `${origin}/mcp`,
    },
  });
  expect(tokenResponse.ok(), await tokenResponse.text()).toBeTruthy();
  const token = await tokenResponse.json();
  const mcp = async (
    method: string,
    parameters: unknown,
    accessToken = token.access_token,
  ) => {
    const r = await external.post("/mcp", {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      data: { jsonrpc: "2.0", id: randomUUID(), method, params: parameters },
    });
    const raw = await r.text();
    expect(r.ok(), raw).toBeTruthy();
    const result =
      raw.startsWith("event:") || raw.startsWith("data:")
        ? JSON.parse(
            raw
              .split("\n")
              .find((l) => l.startsWith("data: "))!
              .slice(6),
          )
        : JSON.parse(raw);
    expect(result.error, raw).toBeUndefined();
    return result.result;
  };
  await mcp("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "acceptance", version: "1" },
  });
  const list = await mcp("tools/list", {});
  expect(list.tools.some((t: any) => t.name === "document_edit")).toBe(true);
  const tool = async (name: string, args: unknown) => {
    const result = await mcp("tools/call", { name, arguments: args });
    return { ...JSON.parse(result.content[0].text), isError: result.isError };
  };
  const source = await tool("note_read", { spaceId, id: f.note.id });
  expect(source.contentHash).toMatch(/^[a-f\d]{64}$/);
  const edit = {
    mutationId: randomUUID(),
    noteId: f.note.id,
    generation: source.generation,
    expectedHash: source.contentHash,
    source: source.body + "\nAutomation reviewed.\n",
  };
  expect((await tool("document_edit", edit)).isError).not.toBe(true);
  expect((await tool("document_edit", edit)).isError).not.toBe(true);
  expect(
    (await tool("document_edit", { ...edit, mutationId: randomUUID() }))
      .isError,
  ).toBe(true);
  const resource = await call(request, `resources/${f.note.id}`),
    trashArgs = {
      spaceId,
      id: f.note.id,
      payload: { version: resource.version, mutationId: randomUUID() },
    };
  const pending = await tool("file_trash", trashArgs);
  expect(pending.requiresApproval).toBe(true);
  expect((await call(request, `resources/${f.note.id}`)).deleted_at).toBeNull();
  await call(request, `connections/approvals/${pending.approvalId}`, {
    decision: "approve",
  });
  expect(
    (
      await tool("file_trash", {
        ...trashArgs,
        payload: { ...trashArgs.payload, version: resource.version + 1 },
        approvalId: pending.approvalId,
      })
    ).isError,
  ).toBe(true);
  const approved = await tool("file_trash", {
    ...trashArgs,
    approvalId: pending.approvalId,
  });
  expect(approved.isError).not.toBe(true);
  expect(
    (await call(request, `resources/${f.note.id}`)).deleted_at,
  ).not.toBeNull();
  expect(
    (await tool("file_trash", { ...trashArgs, approvalId: pending.approvalId }))
      .isError,
  ).not.toBe(true);
  const connection = (await call(request, "connections")).connections.find(
    (c: any) => c.client_id === client.client_id,
  );
  await call(request, `connections/${connection.id}`, {}, "DELETE");
  const revoked = await request.post("/mcp", {
    headers: {
      authorization: `Bearer ${token.access_token}`,
      accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  });
  expect([401, 403]).toContain(revoked.status());
  await call(request, "connections/consent", {
    clientId: client.client_id,
    spaceIds: [spaceId],
    scopes: ["workspace:read"],
  });
  const stale = await request.post("/mcp", {
    headers: {
      authorization: `Bearer ${token.access_token}`,
      accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  });
  expect([401, 403]).toContain(stale.status());
  await page.close();
  await external.dispose();
});

test("Selected offline work opens after reload and a new Canvas replays without duplicate content", async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  const folder = await call(f.member.request, "resources", {
    spaceId,
    name: "Offline study",
    kind: "folder",
    mutationId: randomUUID(),
  });
  const text = await call(f.member.request, "files/new", {
    type: "text",
    name: "Local experiment",
    source: "Original experiment",
    spaceId,
    parentId: folder.id,
    mutationId: randomUUID(),
  });
  const context = await browser.newContext({
    baseURL: origin,
    storageState: await f.member.storageState(),
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  await page.goto(`/workbench/explorer?space=${spaceId}`);
  await page
    .locator(".ws-resource-row")
    .filter({ hasText: "Offline study" })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Available offline", exact: true })
    .click();
  await expect(page.locator(".ws-notice")).toContainText(
    "Selected work is available offline",
    { timeout: 30000 },
  );
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.goto(`/workbench/tools/text/${text.id}`);
  await expect(page.getByLabel("Text source")).toContainText(
    "Original experiment",
  );
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel("Text source")).toContainText(
    "Original experiment",
  );
  await page.getByLabel("Text source").click();
  await page.getByLabel("Text source").press("ControlOrMeta+End");
  await page.keyboard.insertText("\nOffline observation");
  await expect(page.getByLabel("Text source").locator(".cm-line")).toHaveText([
    "Original experiment",
    "Offline observation",
  ]);
  // A full document navigation can abort pending IDB writes. Playwright
  // accepts beforeunload warnings automatically; wait for the actual durable
  // save, rather than implicitly choosing to discard an in-flight edit.
  await expect(page.locator(".canvas-status")).toContainText(
    "Saved locally · offline",
  );
  await page.goto(
    `/workbench/tools/canvas/new?space=${spaceId}&folder=${folder.id}`,
  );
  await page.getByLabel("Project name").fill("Offline canvas");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(page).toHaveURL(/\/tools\/canvas\/[a-f0-9-]{36}$/);
  const id = page.url().split("/").at(-1)!;
  await page
    .getByRole("button", { name: "Add text card", exact: true })
    .click();
  await page
    .locator(".canvas-card.is-editing")
    .getByRole("button", { name: "Source", exact: true })
    .click();
  await page
    .getByLabel("Card Markdown")
    .fill("Offline idea survives reconciliation");
  await page.getByLabel("Card Markdown").press("Escape");
  await page.screenshot({
    path: info.outputPath("offline-canvas-current.png"),
  });
  await context.setOffline(false);
  await expect
    .poll(
      async () => (await f.member.request.get(`/api/v1/notes/${id}`)).status(),
      { timeout: 30000 },
    )
    .toBe(200);
  await expect(page.locator(".canvas-status")).toContainText(
    "Saved on server",
    { timeout: 30000 },
  );
  const saved = await call(f.member.request, `notes/${id}`);
  expect(JSON.parse(saved.body).nodes.map((n: any) => n.text)).toEqual([
    "Offline idea survives reconciliation",
  ]);
  await page.goto(`/workbench/tools/text/${text.id}`);
  await expect(page.getByLabel("Text source")).toContainText(
    "Offline observation",
  );
  await expect(page.locator(".canvas-status")).toContainText("Saved on server");
  expect((await call(f.member.request, `notes/${text.id}`)).body).toBe(
    "Original experiment\nOffline observation",
  );
  await context.close();
});

test("Native document downloads preserve formats and legacy notebook export refuses mismatched formats", async () => {
  for (const [type, name, source, extension] of [
    ["text", "Plain.txt", "Do not interpret **this** as Markdown.", "txt"],
    ["math", "Equation", "\\int_0^1 x^2\\,dx", "tex"],
    ["canvas", "Research", '{"nodes":[],"edges":[]}', "canvas"],
  ]) {
    const created = await call(f.member.request, "files/new", {
      type,
      name,
      source,
      spaceId,
      mutationId: randomUUID(),
    });
    const result = await f.member.request.get(
      `/api/v1/notes/${created.id}/export`,
    );
    expect(result.ok(), await result.text()).toBeTruthy();
    const body = await result.text();
    if (type === "canvas") expect(JSON.parse(body)).toEqual(JSON.parse(source));
    else expect(body).toBe(source);
    expect(result.headers()["content-disposition"]).toMatch(
      new RegExp(`\\.${extension}"$`),
    );
    expect(result.headers()["content-disposition"]).not.toContain(
      `.${extension}.${extension}`,
    );
  }
  const legacy = await f.member.request.get(
    `/api/v1/export?groupId=${f.group.id}`,
  );
  expect(legacy.status()).toBe(409);
  expect(await legacy.text()).toContain("Workspace management");
});

test("Offline conflicts require a current review and cancelled work has a complete recovery download", async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  const folder = await call(f.member.request, "resources", {
    spaceId,
    name: "Offline conflicts",
    kind: "folder",
    mutationId: randomUUID(),
  });
  const text = await call(f.member.request, "files/new", {
    type: "text",
    name: "Conflict study.txt",
    source: "Retained research text",
    spaceId,
    parentId: folder.id,
    mutationId: randomUUID(),
  });
  const context = await browser.newContext({
    baseURL: origin,
    storageState: await f.member.storageState(),
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  try {
    await page.goto(`/workbench/explorer?space=${spaceId}`);
    await page
      .locator(`.ws-resource-row[data-resource-id="${folder.id}"]`)
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Available offline", exact: true })
      .click();
    await expect(page.locator(".ws-notice")).toContainText(
      "Selected work is available offline",
      { timeout: 30000 },
    );
    const localRename = async (name: string) => {
      await page.goto(
        `/workbench/explorer?space=${spaceId}&folder=${folder.id}`,
      );
      await expect(
        page.locator(`.ws-resource-row[data-resource-id="${text.id}"]`),
      ).toBeVisible();
      await context.setOffline(true);
      await page
        .locator(`.ws-resource-row[data-resource-id="${text.id}"]`)
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: /^Rename/ }).click();
      const dialog = page.getByRole("dialog", {
        name: "Rename item",
        exact: true,
      });
      await dialog.getByLabel("Name", { exact: true }).fill(name);
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      try {
        await expect(dialog).toHaveCount(0);
      } catch (error) {
        throw new Error(
          `${(error as Error).message}\nRename dialog: ${await dialog.innerText()}`,
        );
      }
    };
    const remoteRename = async (name: string, description: string) => {
      const resource = await call(f.member.request, `resources/${text.id}`);
      return call(
        f.member.request,
        `resources/${text.id}`,
        {
          version: resource.version,
          mutationId: randomUUID(),
          name,
          description,
        },
        "PATCH",
      );
    };
    await localRename("My reviewed name.txt");
    await remoteRename("Team name.txt", "Preserve team description");
    await context.setOffline(false);
    await page.goto("/workbench/settings/data");
    await expect(page.locator(".offline-queue-item")).toContainText(
      "conflict",
      { timeout: 30000 },
    );
    await page
      .getByRole("button", { name: "Review server changes…", exact: true })
      .click();
    const review = page.getByRole("dialog", {
      name: "Review offline conflict",
      exact: true,
    });
    await expect(review).toContainText("Team name.txt");
    await remoteRename("Newer team name.txt", "Newer description must survive");
    await review
      .getByRole("button", {
        name: "Apply my changes to this version",
        exact: true,
      })
      .click();
    await expect(review).toContainText("changed again");
    expect((await call(f.member.request, `resources/${text.id}`)).name).toBe(
      "Newer team name.txt",
    );
    await review
      .getByRole("button", { name: "Keep paused", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review server changes…", exact: true })
      .click();
    await expect(review).toContainText("Newer team name.txt");
    await review
      .getByRole("button", {
        name: "Apply my changes to this version",
        exact: true,
      })
      .click();
    await expect(review).toHaveCount(0);
    await expect(page.locator(".offline-queue-item")).toHaveCount(0);
    const merged = await call(f.member.request, `resources/${text.id}`);
    expect(merged.name).toBe("My reviewed name.txt");
    expect(merged.description).toBe("Newer description must survive");

    await localRename("Do not replay this name.txt");
    await remoteRename("Keep the team name.txt", "Team description");
    await context.setOffline(false);
    await page.goto("/workbench/settings/data");
    await expect(page.locator(".offline-queue-item")).toContainText(
      "conflict",
      { timeout: 30000 },
    );
    await page
      .getByRole("button", { name: "Stop pending operations…", exact: true })
      .click();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: "Download recovery & stop queue",
        exact: true,
      })
      .click();
    const recovered = await download;
    expect(recovered.suggestedFilename()).toBe("axiom-offline-recovery.zip");
    const zip = await JSZip.loadAsync(
      await readFile((await recovered.path())!),
    );
    expect(zip.file("operations.json")).not.toBeNull();
    const journals = zip.file(/^documents\/.*\.yjs$/);
    expect(journals.length).toBeGreaterThan(0);
    const sources = await Promise.all(
      zip.file(/^documents\/.*\.txt$/).map((file) => file.async("string")),
    );
    expect(sources).toContain("Retained research text");
    await expect(page.locator(".offline-queue-item")).toHaveCount(0);
    expect((await call(f.member.request, `resources/${text.id}`)).name).toBe(
      "Keep the team name.txt",
    );
    await page.screenshot({
      path: info.outputPath("offline-recovery-current.png"),
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
