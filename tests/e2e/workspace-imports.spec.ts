import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Pg from "pg";
import { createRequire } from "node:module";
import { mutationTestTarget } from "../../packages/shared/src/test-target";
import * as Y from "yjs";
import { signInOwner } from "./auth";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
import {
  interfaceStyleIds,
  type InterfaceStyleId,
} from "../../packages/shared/src/interface-styles";
import {
  UPLOAD_CHUNK_BYTES,
  type Space,
} from "../../packages/shared/src/workspace";
import type {
  ImportManifest,
  ImportManifestEntry,
  WorkspaceImportBatch,
  WorkspaceImportPreview,
} from "../../packages/shared/src/workspace-import";
import { portableCollectionZip } from "../fixtures/portable-collection";
import { portableCollectionSchema } from "../../packages/shared/src/portable-collection";
import { parseCanvas } from "../../packages/shared/src/canvas";
const pg = createRequire(import.meta.url)("pg") as typeof import("pg");
const JSZip = createRequire(import.meta.url)("jszip") as typeof import("jszip");
const origin = "http://localhost:3004";
let saved: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;
async function call<T = Record<string, any>>(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = "POST",
) {
  const response = await request.fetch("/api/v1/" + path, {
    method,
    headers: { origin, "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<T>;
}
async function fixture(browser: Browser) {
  if (process.env.TEST_APP_URL !== origin)
    throw new Error("Use isolated imports.config.ts.");
  const context = await browser.newContext({
    baseURL: origin,
    storageState: saved,
    viewport: { width: 1500, height: 960 },
  });
  if (!saved) {
    const login = await signInOwner(context.request, origin);
    expect(login.ok(), await login.text()).toBeTruthy();
    saved = await context.storageState();
  }
  const group = await call(context.request, "groups", {
    name: "Import browser " + randomUUID().slice(0, 8),
  });
  const workspace = await call(context.request, "spaces", {
    name: "Imported research",
    groupId: group.id,
    audience: "group",
  });
  const page = await context.newPage();
  await page.goto(`/workbench/workspaces/${workspace.space_id}/files`);
  await expect(
    page.getByRole("button", { name: "Add files", exact: true }),
  ).toBeVisible();
  return { context, page, id: workspace.space_id as string };
}
async function dialog(page: Page, source = "Markdown") {
  await page.getByRole("button", { name: "Add files", exact: true }).click();
  await page
    .getByRole("menuitem", { name: `Import ${source}…`, exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Import into workspace",
    exact: true,
  });
  await expect(modal).toBeVisible();
  return modal;
}
async function layout(page: Page, modal = page.getByRole("dialog")) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(
    await modal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  const footer = modal.locator(".dialog-footer"),
    box = await footer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + 1,
  );
  const controls = modal.locator(".import-fields").getByRole("combobox");
  const boxes = await controls.evaluateAll((items) =>
    items.map((el) => ({ bottom: el.getBoundingClientRect().bottom })),
  );
  if (boxes.length)
    expect(
      Math.max(...boxes.map((b) => b.bottom)) -
        Math.min(...boxes.map((b) => b.bottom)),
    ).toBeLessThan(3);
}
async function appearance(
  request: APIRequestContext,
  mode: "light" | "dark",
  style: InterfaceStyleId,
  large = false,
) {
  const current = await call(request, "me/preferences", undefined, "GET");
  await call(
    request,
    "me/preferences",
    {
      version: current.version,
      mutationId: randomUUID(),
      preferences: {
        ...current.preferences,
        mode,
        interfaceStyle: style,
        uiSize: large ? 22 : 15,
        radius: large ? 0 : 12,
        shadows: large ? "none" : "soft",
      },
    },
    "PATCH",
  );
}
async function dbFixture(work: (db: Pg.Client) => Promise<void>) {
  const target = new URL(
    mutationTestTarget(process.env, process.env.AXIOM_TEST_ROOT).databaseUrl,
  );
  if (target.pathname !== "/axiom_plugins_test")
    throw new Error("Use the extension test profile.");
  const db = new pg.Client({ connectionString: target.href });
  await db.connect();
  try {
    await work(db);
  } finally {
    await db.end();
  }
}

test("mixed native collection previews, publishes atomically and exports an importable manifest", async ({
  browser,
}, info) => {
  const f = await fixture(browser),
    collection = await portableCollectionZip(),
    errors: string[] = [];
  f.page.on("pageerror", (error) => errors.push(error.message));
  try {
    const modal = await dialog(f.page, "ZIP");
    await modal
      .locator('input[type="file"]')
      .setInputFiles({
        name: "Research.zip",
        mimeType: "application/zip",
        buffer: Buffer.from(collection.bytes),
      });
    await expect(modal.locator(".import-counts")).toContainText("5 notes");
    await expect(modal).toContainText("Restores files and safe metadata");
    await modal
      .locator(".import-entry-row")
      .filter({ hasText: "Lab/Paper.md" })
      .click();
    await modal.getByRole("button", { name: "Source", exact: true }).click();
    await expect(modal.locator(".workspace-import-preview")).toContainText(
      "Methods.md",
    );
    await layout(f.page, modal);
    await f.page.screenshot({
      path: info.outputPath("collection-preview.png"),
      fullPage: true,
    });
    await modal
      .getByRole("button", { name: "Import collection", exact: true })
      .click();
    const complete = f.page.getByRole("dialog", {
      name: "Import complete",
      exact: true,
    });
    await expect(complete).toBeVisible({ timeout: 35000 });
    const batches = await call<WorkspaceImportBatch[]>(
        f.context.request,
        "me/imports",
        undefined,
        "GET",
      ),
      batch = batches.find((b) => b.spaceId === f.id)!;
    const native = new Map(
      batch.entries
        .filter((e) => e.metadata?.originId)
        .map((e) => [e.metadata!.originId!, e]),
    );
    const paper = native.get(collection.ids.paper)!,
      plot = native.get(collection.ids.plot)!,
      canvas = native.get(collection.ids.canvas)!;
    expect(paper.resourceId).not.toBe(collection.ids.paper);
    await dbFixture(async (db) => {
      const notes = (
        await db.query(
          "SELECT id,body,source_format FROM notes WHERE id=ANY($1::uuid[])",
          [[paper.resourceId, canvas.resourceId]],
        )
      ).rows;
      const board = parseCanvas(
        notes.find((row) => row.id === canvas.resourceId).body,
      );
      expect(board.nodes[1]).toMatchObject({
        resourceId: plot.resourceId,
        versionId: plot.resourceId,
      });
      expect(board.edges[0].fromNode).toBe(board.nodes[0].id);
      expect(notes.find((row) => row.id === paper.resourceId).body).toContain(
        native.get(collection.ids.methods)!.resourceId,
      );
      expect(
        (
          await db.query(
            "SELECT settings FROM tool_projects WHERE resource_id=$1",
            [native.get(collection.ids.math)!.resourceId],
          )
        ).rows[0].settings.fontSize,
      ).toBe(32);
      expect(
        (
          await db.query(
            "SELECT room FROM documents WHERE note_id=ANY($1::uuid[])",
            [[paper.resourceId, canvas.resourceId]],
          )
        ).rowCount,
      ).toBe(2);
    });
    await complete.getByRole("button", { name: "Close dialog" }).click();
    const folder = batch.result!.resources.find(
      (r) => r.kind === "folder" && r.parentId === null,
    )!;
    await f.page
      .getByRole("checkbox", { name: `Select ${folder.name}`, exact: true })
      .check();
    await f.page
      .getByRole("button", { name: "Export selection", exact: true })
      .click();
    const exporting = f.page.getByRole("dialog", {
      name: "Export collection",
      exact: true,
    });
    await expect(exporting.getByLabel("Archive profile")).toHaveValue(
      "portable",
    );
    await expect(exporting).toContainText("50 MB compressed");
    await f.page.screenshot({
      path: info.outputPath("collection-export.png"),
      fullPage: true,
    });
    await exporting
      .getByRole("button", { name: "Prepare archive", exact: true })
      .click();
    await expect(exporting).toBeHidden();
    let job: Record<string, any> | undefined;
    await expect
      .poll(
        async () => {
          job = (
            await call<Record<string, any>[]>(
              f.context.request,
              "exports",
              undefined,
              "GET",
            )
          ).find((item) => item.space_id === f.id);
          if (job?.status === "failed") throw new Error(job.error);
          return job?.status;
        },
        { timeout: 35000 },
      )
      .toBe("ready");
    const response = await f.context.request.get(
      `/api/v1/exports/${job!.id}/download`,
    );
    expect(response.ok()).toBe(true);
    const zip = await JSZip.loadAsync(await response.body()),
      manifest = portableCollectionSchema.parse(
        JSON.parse(await zip.file("axiom-manifest.json")!.async("string")),
      );
    expect(manifest.resources.filter((r) => r.kind === "note")).toHaveLength(5);
    expect(
      manifest.resources.find((r) => r.id === plot.resourceId)?.parentId,
    ).toBe(native.get(collection.ids.folder)!.resourceId);
    expect(errors).toEqual([]);
  } finally {
    await f.context.close();
  }
});

test("Markdown preview is local, publication is native, and UUID anchors work beyond context's latest 200", async ({
  browser,
}) => {
  const f = await fixture(browser),
    errors: string[] = [],
    images: string[] = [];
  f.page.on("pageerror", (e) => errors.push(e.message));
  await f.page.route("**/never-load.axiom.invalid/**", (route) => {
    images.push(route.request().url());
    return route.abort();
  });
  const modal = await dialog(f.page);
  await modal.locator('input[type="file"]').setInputFiles([
    {
      name: "Main.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        '[**Linked methods**](Second.md#Methods "Retained title")\n\n![offline preview](https://never-load.axiom.invalid/image.png)\n\n# Introduction\n\nBody text.\n',
      ),
    },
    {
      name: "Second.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Methods\n\n$$E=mc^2$$\n"),
    },
  ]);
  await expect(modal.locator(".import-counts")).toContainText("2 notes");
  await expect(
    modal.getByRole("button", { name: "Import collection", exact: true }),
  ).toBeEnabled();
  await modal.getByRole("button", { name: "Source", exact: true }).click();
  await expect(modal.locator(".workspace-import-preview")).toContainText(
    "Second.md#Methods",
  );
  await modal.getByRole("button", { name: "Preview", exact: true }).click();
  expect(images).toEqual([]);
  await layout(f.page, modal);
  await modal
    .getByRole("button", { name: "Import collection", exact: true })
    .click();
  const complete = f.page.getByRole("dialog", {
    name: "Import complete",
    exact: true,
  });
  await expect(complete).toBeVisible({ timeout: 35000 });
  const batches = await call<WorkspaceImportBatch[]>(
      f.context.request,
      "me/imports",
      undefined,
      "GET",
    ),
    batch = batches.find((b) => b.spaceId === f.id)!;
  const main = batch.result!.resources.find((r) => r.name === "Main")!,
    second = batch.result!.resources.find((r) => r.name === "Second")!;
  await dbFixture(async (db) => {
    const doc = new Y.Doc();
    doc.getText("markdown").insert(0, "# Context fixture\n");
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    doc.destroy();
    await db.query(
      "INSERT INTO notes(group_id,project_id,author_id,title,body) SELECT p.group_id,p.id,m.user_id,'Context filler '||n,'# Context fixture' FROM projects p JOIN spaces s ON s.project_id=p.id JOIN members m ON m.group_id=p.group_id AND m.role='owner' CROSS JOIN generate_series(1,205) n WHERE s.id=$1",
      [f.id],
    );
    await db.query(
      "INSERT INTO documents(room,note_id,state) SELECT n.id::text||':1',n.id,$2 FROM notes n JOIN resources r ON r.note_id=n.id WHERE r.space_id=$1 AND n.title LIKE 'Context filler %'",
      [f.id, state],
    );
  });
  const context = await call(
    f.context.request,
    `notes/${main.id}/context`,
    undefined,
    "GET",
  );
  expect(
    context.notes.some((note: { id: string }) => note.id === second.id),
  ).toBe(false);
  await complete
    .getByRole("button", { name: "Open file", exact: true })
    .click();
  await expect(f.page).toHaveURL(new RegExp(`/notes/${main.id}`));
  await f.page.getByRole("button", { name: "Read", exact: true }).click();
  const linked = f.page
    .locator(".read-mount:not(.print-only) a[data-note-target]")
    .filter({ hasText: "Linked methods" });
  await expect(linked).toBeVisible();
  await expect(linked.locator("strong")).toHaveText("Linked methods");
  await linked.click();
  await expect(f.page).toHaveURL(new RegExp(`/notes/${second.id}#methods`));
  expect(errors).toEqual([]);
  await f.context.close();
});

test("folder picker keeps hierarchy, empty Markdown, raw attachments and merge-safe names", async ({
  browser,
}) => {
  const f = await fixture(browser),
    temp = await mkdtemp(join(tmpdir(), "axiom-import-fixture-")),
    collection = join(temp, "Research");
  // Synthetic disposable files only; no application storage or user's originals.
  await mkdir(join(collection, "Data"), { recursive: true });
  await writeFile(
    join(collection, "Paper.md"),
    "# Paper\n\n[Table](Data/data.csv)\n",
  );
  await writeFile(join(collection, "Empty.md"), "");
  await writeFile(join(collection, "Data", "data.csv"), "A,B\n1,2\n");
  await writeFile(join(collection, ".env"), "SYNTHETIC_EXCLUDED=1\n");
  // WebKit's native folder picker can omit dotfiles; a visible secret fixture
  // proves exclusion there too, without assuming the picker reports hidden files.
  await writeFile(join(collection, "private.key"), "SYNTHETIC_EXCLUDED=1\n");
  const modal = await dialog(f.page, "folder");
  await modal.locator('input[type="file"]').setInputFiles(collection);
  await expect(modal.locator(".import-counts")).toContainText("2 notes");
  await expect(modal.locator(".import-counts")).toContainText("1 files");
  await expect(modal.locator(".import-warnings")).toContainText("excluded");
  await modal.getByLabel("Matching names").selectOption("merge");
  await expect(
    modal.getByRole("button", { name: "Import collection" }),
  ).toBeEnabled();
  await modal.getByRole("button", { name: "Import collection" }).click();
  const complete = f.page.getByRole("dialog", {
    name: "Import complete",
    exact: true,
  });
  await expect(complete).toBeVisible({ timeout: 35000 });
  await complete
    .getByRole("button", { name: "Open folder", exact: true })
    .click();
  await expect(f.page.locator(".ws-resource-container")).toContainText("Empty");
  await expect(f.page.locator(".ws-resource-container")).toContainText("Paper");
  await expect(f.page.locator(".ws-resource-container")).toContainText("Data");
  const batch = (
    await call<WorkspaceImportBatch[]>(
      f.context.request,
      "me/imports",
      undefined,
      "GET",
    )
  ).find((b) => b.spaceId === f.id)!;
  expect(
    batch.result!.resources.some((r) =>
      [".env", "private.key"].includes(r.name),
    ),
  ).toBe(false);
  const raw = batch.result!.resources.find((r) => r.kind === "file")!,
    versions = await call(
      f.context.request,
      `files/${raw.id}/versions`,
      undefined,
      "GET",
    );
  expect(versions[0].sha256).toBe(
    createHash("sha256").update("A,B\n1,2\n").digest("hex"),
  );
  await f.context.close();
});

test("ZIP preserves empty folders and previews are tidy in every interface treatment", async ({
  browser,
}, info) => {
  const f = await fixture(browser),
    zip = new JSZip();
  zip.folder("Archive/Empty");
  zip.file(
    "Archive/α.md",
    "# Research\n\n" +
      "Comfortable reading and source preview.\n\n".repeat(180),
  );
  zip.file("Archive/Data.csv", "x,y\n1,2");
  const archive = {
    name: "Research.zip",
    mimeType: "application/zip",
    buffer: await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    }),
  };
  for (const style of interfaceStyleIds)
    for (const mode of ["light", "dark"] as const) {
      await appearance(f.context.request, mode, style);
      await f.page.reload();
      const modal = await dialog(f.page, "ZIP");
      await modal.locator('input[type="file"]').setInputFiles(archive);
      await expect(modal.locator(".import-counts")).toContainText("1 notes");
      await expect(
        modal.getByRole("button", { name: "Import collection" }),
      ).toBeEnabled();
      await layout(f.page, modal);
      const scroll = modal.locator(".planning-markdown-scroll");
      expect(
        await scroll.evaluate((el) => el.scrollHeight > el.clientHeight),
      ).toBe(true);
      await scroll.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect(
        modal.getByRole("button", { name: "Import collection" }),
      ).toBeInViewport();
      if (
        (style === "axiom" && mode === "light") ||
        (style === "editorial" && mode === "dark")
      ) {
        await scroll.evaluate((el) => {
          el.scrollTop = 0;
        });
        const inset = await scroll
          .locator(".axiom-editor-content.prose")
          .evaluate((el) =>
            Number.parseFloat(getComputedStyle(el).paddingInlineStart),
          );
        expect(inset).toBeGreaterThanOrEqual(20);
        await f.page.screenshot({
          path: info.outputPath(`import-${style}-${mode}.png`),
        });
      }
      await modal.getByRole("button", { name: "Close", exact: true }).click();
    }
  await appearance(f.context.request, "light", "fluent", true);
  await f.page.setViewportSize({ width: 1280, height: 720 });
  await f.page.reload();
  const large = await dialog(f.page, "ZIP");
  await large.locator('input[type="file"]').setInputFiles(archive);
  await expect(
    large.getByRole("button", { name: "Import collection" }),
  ).toBeEnabled();
  await layout(f.page, large);
  await f.page.emulateMedia({
    forcedColors: "active",
    reducedMotion: "reduce",
  });
  await f.page.screenshot({
    path: info.outputPath("import-large-forced-colors.png"),
  });
  await large.getByRole("button", { name: "Import collection" }).focus();
  await f.page.keyboard.press("Enter");
  const complete = f.page.getByRole("dialog", {
    name: "Import complete",
    exact: true,
  });
  await expect(complete).toBeVisible({ timeout: 35000 });
  const batch = (
    await call<WorkspaceImportBatch[]>(
      f.context.request,
      "me/imports",
      undefined,
      "GET",
    )
  ).find((b) => b.spaceId === f.id)!;
  expect(
    batch.result!.resources.some(
      (r) => r.kind === "folder" && r.name === "Empty",
    ),
  ).toBe(true);
  await appearance(f.context.request, "light", "axiom");
  await f.context.close();
});

test("command palette and context-menu import share the selected workspace and folder", async ({
  browser,
}) => {
  const f = await fixture(browser),
    folder = await call(f.context.request, "resources", {
      spaceId: f.id,
      kind: "folder",
      name: "Destination",
    });
  await f.page.goto(`/workbench/workspaces/${f.id}/files?folder=${folder.id}`);
  await expect(
    f.page.getByRole("button", { name: "Add files", exact: true }),
  ).toBeVisible();
  await f.page
    .getByRole("button", { name: "Search workspace", exact: true })
    .click();
  const search = f.page.getByRole("dialog", { name: "Search & commands" });
  await search
    .getByRole("combobox", { name: "Global search" })
    .fill("Import Markdown files");
  await search.getByRole("option", { name: /Import Markdown files/ }).click();
  const modal = f.page.getByRole("dialog", {
    name: "Import into workspace",
    exact: true,
  });
  await expect(modal.locator(".import-destination")).toContainText(
    "Imported research",
  );
  await modal.locator('input[type="file"]').setInputFiles({
    name: "Folder note.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Folder note\n"),
  });
  await expect(modal.locator(".import-destination")).toContainText(
    "Destination",
  );
  await modal.getByRole("button", { name: "Import collection" }).click();
  await expect(
    f.page.getByRole("dialog", { name: "Import complete", exact: true }),
  ).toBeVisible({ timeout: 35000 });
  const batch = (
    await call<WorkspaceImportBatch[]>(
      f.context.request,
      "me/imports",
      undefined,
      "GET",
    )
  ).find((b) => b.spaceId === f.id)!;
  expect(batch.result!.resources[0].parentId).toBe(folder.id);
  await f.page
    .getByRole("dialog", { name: "Import complete", exact: true })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  // The blank-space menu uses the same host, keeping this folder destination.
  const container = f.page.locator(".ws-resource-container");
  const blank = await container.evaluate((el) => {
    const row = el.querySelector(".ws-resource-row:last-child");
    return {
      x: 24,
      y: row
        ? Math.min(
            el.clientHeight - 12,
            row.getBoundingClientRect().bottom -
              el.getBoundingClientRect().top +
              24,
          )
        : 24,
    };
  });
  await container.click({ button: "right", position: blank, timeout: 10000 });
  await f.page
    .getByRole("menu", { name: "Explorer actions", exact: true })
    .getByRole("menuitem", { name: "Folders & uploads", exact: true })
    .click();
  await f.page
    .getByRole("menu", { name: "Folders & uploads", exact: true })
    .getByRole("menuitem", { name: "Add files · Import folder…", exact: true })
    .click();
  const contextImport = f.page.getByRole("dialog", {
    name: "Import into workspace",
    exact: true,
  });
  await expect(contextImport).toBeVisible();
  await expect(contextImport.getByLabel("Import", { exact: true })).toHaveValue(
    "folder",
  );
  const local = await mkdtemp(join(tmpdir(), "axiom-import-context-")),
    selected = join(local, "Context folder");
  await mkdir(selected);
  await writeFile(join(selected, "Reference.md"), "# Local preview\n");
  await contextImport.locator('input[type="file"]').setInputFiles(selected);
  await expect(contextImport.locator(".import-destination")).toContainText(
    "Destination",
  );
  await contextImport
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const space = (
    await call<Space[]>(f.context.request, "spaces", undefined, "GET")
  ).find((s) => s.id === f.id)!;
  expect(space.role).toBe("editor");
  await f.context.close();
});

test("reloaded imports reject changed originals, resume only missing parts, and cancel privately", async ({
  browser,
}, info) => {
  const f = await fixture(browser),
    temp = await mkdtemp(join(tmpdir(), "axiom-import-resume-")),
    collectionName = `ResumeLab-${randomUUID().slice(0, 8)}`,
    cancelledName = `Cancelled-${randomUUID().slice(0, 8)}`,
    collection = join(temp, collectionName),
    note = Buffer.from("# Resumed research\n\n[Data](Data.bin)\n"),
    data = Buffer.alloc(UPLOAD_CHUNK_BYTES + 19, 42),
    hash = (bytes: Buffer | string) =>
      createHash("sha256").update(bytes).digest("hex");
  const fileEntry = (path: string, body: Buffer): ImportManifestEntry => {
    const parts = [];
    for (let from = 0; from < body.length; from += UPLOAD_CHUNK_BYTES)
      parts.push(hash(body.subarray(from, from + UPLOAD_CHUNK_BYTES)));
    return {
      id: randomUUID(),
      path,
      kind: path.endsWith(".md") ? "note" : "file",
      bytes: body.length,
      digest: hash(parts.join("")),
    };
  };
  const manifest: ImportManifest = {
    source: "folder",
    parentId: null,
    conflict: "keepBoth",
    entries: [
      {
        id: randomUUID(),
        path: collectionName,
        kind: "folder",
        bytes: 0,
        digest: null,
      },
      fileEntry(`${collectionName}/Paper.md`, note),
      fileEntry(`${collectionName}/Data.bin`, data),
    ],
  };
  const start = async (manifest: ImportManifest) => {
    const preview = await call<WorkspaceImportPreview>(
      f.context.request,
      `spaces/${f.id}/imports/preview`,
      manifest,
    );
    return call<WorkspaceImportBatch>(
      f.context.request,
      `spaces/${f.id}/imports`,
      {
        id: randomUUID(),
        manifest,
        fingerprint: preview.fingerprint,
      },
    );
  };
  const batch = await start(manifest),
    large = batch.entries.find((e) => e.kind === "file")!,
    base = `spaces/${f.id}/imports/${batch.id}/entries/${large.id}`;
  await call(f.context.request, base + "/prepare", {});
  const part = data.subarray(0, UPLOAD_CHUNK_BYTES);
  const accepted = await f.context.request.put(
    "/api/v1/" + base + "/chunks/1",
    {
      headers: {
        origin,
        "content-type": "application/octet-stream",
        "x-content-sha256": hash(part),
      },
      data: part,
    },
  );
  expect(accepted.ok(), await accepted.text()).toBeTruthy();
  // Reload deliberately drops in-memory File handles. The server retains a
  // private batch and the checksum receipt for part 1, never a partial folder.
  await f.page.reload();
  expect(
    (
      await call(
        f.context.request,
        `resources?spaceId=${f.id}`,
        undefined,
        "GET",
      )
    ).items,
  ).toHaveLength(0);
  const openBatch = async (name: string) => {
    await f.page
      .getByRole("button", { name: "Activity & recovery", exact: true })
      .click();
    const ledger = f.page.locator('section[aria-label="Workspace imports"]');
    await ledger.getByRole("button", { name: new RegExp(name) }).click();
    return f.page.getByRole("dialog", { name: "Import progress", exact: true });
  };
  const progress = await openBatch(collectionName);
  await expect(
    progress.getByRole("button", { name: "Resume import", exact: true }),
  ).toBeVisible();
  const idleReads: string[] = [];
  f.page.on("request", (request) => {
    if (request.url().includes("/me/imports?compact=1"))
      idleReads.push(request.url());
  });
  // A paused preparation does not need a status timer. This bounded wait spans
  // the 1.8-second poll interval specifically to detect accidental idle reads.
  await f.page.waitForTimeout(2100);
  expect(idleReads).toEqual([]);
  await progress
    .getByRole("button", { name: "Resume import", exact: true })
    .click();
  const resume = f.page.getByRole("dialog", {
    name: "Resume import",
    exact: true,
  });
  await mkdir(collection);
  await writeFile(join(collection, "Paper.md"), note);
  const wrong = Buffer.from(data);
  wrong[wrong.length - 1] = 43;
  await writeFile(join(collection, "Data.bin"), wrong);
  const chunks: string[] = [];
  f.page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      request.url().includes(`/imports/${batch.id}/`)
    )
      chunks.push(request.url());
  });
  await resume.locator('input[type="file"]').setInputFiles(collection);
  const submit = resume.getByRole("button", {
    name: "Resume original collection",
    exact: true,
  });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(resume).toContainText(
    `This is not the reviewed original: ${collectionName}/Data.bin`,
  );
  expect(chunks).toEqual([]);
  expect(
    (
      await call(
        f.context.request,
        `resources?spaceId=${f.id}`,
        undefined,
        "GET",
      )
    ).items,
  ).toHaveLength(0);
  await writeFile(join(collection, "Data.bin"), data);
  await resume.locator('input[type="file"]').setInputFiles(collection);
  await expect(submit).toBeEnabled();
  await submit.click();
  const complete = f.page.getByRole("dialog", {
    name: "Import complete",
    exact: true,
  });
  await expect(complete).toBeVisible({ timeout: 35000 });
  const receipt = await call<WorkspaceImportBatch>(
    f.context.request,
    `spaces/${f.id}/imports/${batch.id}`,
    undefined,
    "GET",
  );
  expect(receipt.result!.resources.map((r) => r.id).sort()).toEqual(
    batch.entries.map((e) => e.resourceId).sort(),
  );
  expect(
    chunks
      .filter((url) => url.includes(`/entries/${large.id}/chunks/`))
      .map((url) => url.split("/").at(-1)),
  ).toEqual(["2"]);
  await layout(f.page, complete);
  await f.page.screenshot({ path: info.outputPath("import-resumed.png") });
  await complete.getByRole("button", { name: "Done", exact: true }).click();

  const cancelled = await start({
    source: "folder",
    parentId: null,
    conflict: "keepBoth",
    entries: [
      {
        id: randomUUID(),
        path: cancelledName,
        kind: "folder",
        bytes: 0,
        digest: null,
      },
      fileEntry(`${cancelledName}/Private.md`, Buffer.from("Never published")),
    ],
  });
  await f.page.reload();
  const pending = await openBatch(cancelledName);
  await pending
    .getByRole("button", { name: "Cancel import", exact: true })
    .click();
  const discarded = f.page.getByRole("dialog", {
    name: "Import cancelled",
    exact: true,
  });
  await expect(discarded).toContainText("Private preparation discarded");
  await expect(discarded.getByRole("progressbar")).toHaveCount(0);
  expect(
    (
      await call<WorkspaceImportBatch>(
        f.context.request,
        `spaces/${f.id}/imports/${cancelled.id}`,
        undefined,
        "GET",
      )
    ).status,
  ).toBe("cancelled");
  expect(
    (
      await call(
        f.context.request,
        `resources?spaceId=${f.id}&view=all`,
        undefined,
        "GET",
      )
    ).items.some((item: { id: string }) =>
      cancelled.entries.some((e) => e.resourceId === item.id),
    ),
  ).toBe(false);
  await f.context.close();
});
