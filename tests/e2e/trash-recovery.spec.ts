import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { PDFDocument } = createRequire(import.meta.url)(
  "pdf-lib",
) as typeof import("pdf-lib");
import { signInOwner } from "./auth";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";

const origin = process.env.TEST_APP_URL;
test("quick purge detaches library associations but preserves the reference and its metadata", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = await setup(browser);
  try {
    const pdf = await f.upload("Linked-library-file.pdf"),
      scope = { spaceId: f.space.id };
    const reference = await call(f.req, "research/library/items", {
      scope,
      draft: { citeKey: "keep-reference", title: "Keep this source metadata" },
      mutationId: randomUUID(),
    });
    await call(f.req, `research/library/items/${reference.id}/links`, {
      scope,
      version: reference.version,
      kind: "attachment",
      targetId: pdf.current_version_id,
      mutationId: randomUUID(),
    });
    const before = await call(f.req, `research/library/items/${reference.id}`);
    await f.trash(pdf);
    const op = (await f.preview([pdf.id])).operation,
      path = `trash/${op.id}/items/${pdf.id}/quick-purge`;
    const plan = await call(f.req, path);
    expect(plan.canPurge).toBe(true);
    expect(plan.impacts).toContainEqual({
      label: "Reference-library file associations (references are kept)",
      count: 1,
    });
    await call(f.req, path, {
      mutationId: randomUUID(),
      fingerprint: plan.fingerprint,
      confirmation: "DELETE FOREVER",
      acknowledgeBrokenLinks: false,
    });
    const after = await call(f.req, `research/library/items/${reference.id}`);
    expect(after.title).toBe(before.title);
    expect(after.version).toBe(before.version + 1);
    expect(after.attachments).toHaveLength(0);
  } finally {
    await f.owner.close();
  }
});

test("quick purge cannot override a formal review even through a retained note snapshot", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = await setup(browser);
  try {
    const pdf = await f.upload("Formal-evidence.pdf");
    const note = await call(f.req, "notes", {
      groupId: f.group.id,
      title: "Reviewed experiment",
      body: `[Evidence](/api/v1/attachments/${pdf.current_version_id})`,
    });
    const snapshot = await call(f.req, `notes/${note.id}/history`, {
      label: "Review milestone",
    });
    const { reviewers } = await call(
      f.req,
      `resources/${note.id}/review-requests`,
    );
    await call(f.req, `resources/${note.id}/review-requests`, {
      mutationId: randomUUID(),
      reference: `snapshot:${snapshot.id}`,
      reviewerId: reviewers[0].id,
    });
    await f.trash(pdf);
    const op = (await f.preview([pdf.id])).operation,
      path = `trash/${op.id}/items/${pdf.id}/quick-purge`;
    const plan = await call(f.req, path);
    expect(plan.canPurge).toBe(false);
    expect(plan.blockers).toContain(
      "Formal review evidence cannot be overridden here.",
    );
    const result = await f.req.post(`/api/v1/${path}`, {
      headers: { origin: origin! },
      data: {
        mutationId: randomUUID(),
        fingerprint: plan.fingerprint,
        confirmation: "DELETE FOREVER",
        acknowledgeBrokenLinks: true,
      },
    });
    expect(result.status()).toBe(409);
    expect(
      (await call(f.req, `trash/${op.id}/items/${pdf.id}/protection`)).sources,
    ).toContainEqual(expect.objectContaining({ id: note.id, history: true }));
  } finally {
    await f.owner.close();
  }
});
test.beforeAll(() => {
  if (
    !["http://localhost:3004", "http://localhost:3008"].includes(origin ?? "")
  )
    throw new Error(
      "Trash acceptance requires isolated staging on port 3004 or 3008.",
    );
});
let ownerState: Awaited<ReturnType<BrowserContext["storageState"]>>;
async function call(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const result = await request.fetch(`/api/v1/${path}`, {
    method,
    data,
    headers: { origin: origin! },
  });
  expect(result.ok(), `${path}: ${await result.text()}`).toBeTruthy();
  return result.json();
}
async function setup(browser: Browser) {
  const owner = await browser.newContext({
    baseURL: origin,
    storageState: ownerState,
    serviceWorkers: "block",
    extraHTTPHeaders: {
      "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA),
    },
  });
  if (!ownerState) {
    expect((await signInOwner(owner.request, origin!)).ok()).toBeTruthy();
    ownerState = await owner.storageState();
  }
  const req = owner.request;
  const group = await call(req, "groups", {
    name: `Trash acceptance ${randomUUID().slice(0, 8)}`,
  });
  const space = (await call(req, "spaces")).find(
    (s: any) => s.group_id === group.id && s.kind === "team",
  );
  const upload = async (name: string) => {
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("Fictional Trash verification");
    const bytes = Buffer.from(await pdf.save()),
      id = randomUUID();
    await call(req, "uploads", {
      id,
      spaceId: space.id,
      name,
      bytes: bytes.length,
    });
    expect(
      (
        await req.put(`/api/v1/uploads/${id}/chunks/1`, {
          headers: {
            origin: origin!,
            "content-type": "application/octet-stream",
          },
          data: bytes,
        })
      ).ok(),
    ).toBeTruthy();
    await call(req, `uploads/${id}/complete`, {});
    await expect
      .poll(async () => (await call(req, `uploads/${id}`)).status, {
        timeout: 45000,
      })
      .toBe("complete");
    return call(
      req,
      `resources/${(await call(req, `uploads/${id}`)).resourceId}`,
    );
  };
  const reading = (
    file: any,
    kind: string,
    request = req,
    label = "Chapter to revisit",
  ) =>
    call(
      request,
      "me/reading",
      {
        id: randomUUID(),
        group_id: space.id,
        kind,
        target_type: "attachment",
        target_id: file.current_version_id,
        data:
          kind === "reading"
            ? { status: "reading", label }
            : { page: 1, label },
        version: 0,
        mutation_id: randomUUID(),
      },
      "PUT",
    );
  const trash = async (file: any) => {
    const resource = await call(req, `resources/${file.id}`);
    return call(req, `resources/${file.id}/trash`, {
      version: resource.version,
      mutationId: randomUUID(),
    });
  };
  const preview = (ids: string[]) =>
    call(req, "trash/preview", {
      action: "purge",
      spaceIds: [space.id],
      ids,
      mutationId: randomUUID(),
    });
  const member = async () => {
    const invite = await call(req, "invitations", {
      groupId: group.id,
      email: `trash-${randomUUID()}@axiom.test`,
    });
    const context = await browser.newContext({
      baseURL: origin,
      serviceWorkers: "block",
    });
    await call(context.request, "register", {
      token: new URL(invite.link).searchParams.get("invite"),
      name: "Private reader",
      password: "TrashAcceptance2026!",
    });
    return context;
  };
  return { owner, req, group, space, upload, reading, trash, preview, member };
}

test("Trash explains personal reading protection and clears it before explicit permanent deletion", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const f = await setup(browser);
  const bundle = await call(f.req, "me/preferences-bundle");
  try {
    await call(
      f.req,
      "me/preferences-bundle",
      {
        editor: bundle.editor,
        appearance: {
          version: bundle.appearance.version,
          preferences: { ...bundle.appearance.preferences, mode: "system" },
        },
        mutationId: randomUUID(),
      },
      "PATCH",
    );
    const pdf = await f.upload(
      "Reading-notes-with-a-long-filename-for-table-layout-verification.pdf",
    );
    const bookmark = await f.reading(pdf, "bookmark");
    await f.reading(pdf, "progress", f.req, "");
    await f.trash(pdf);
    const page = await f.owner.newPage(),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/workbench/trash?space=${f.space.id}`);
    await expect(page.locator(".console-trash-table")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    const toolbar = page.locator(".trash-toolbar");
    const searchBox = await toolbar.getByLabel("Search Trash").boundingBox();
    const spaceBox = await toolbar.getByLabel("Trash workspace").boundingBox();
    const searchIcon = await toolbar
      .locator(".trash-search-field svg")
      .boundingBox();
    expect(Math.abs(searchBox!.y - spaceBox!.y)).toBeLessThan(2);
    expect(
      Math.abs(
        searchBox!.y +
          searchBox!.height / 2 -
          searchIcon!.y -
          searchIcon!.height / 2,
      ),
    ).toBeLessThan(2);
    await page
      .getByRole("button", { name: "Filters & restore options" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Restore behavior" }),
    ).toBeVisible();
    expect(
      await page
        .locator(".trash-page")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("trash-page-light.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Filters & restore options" })
      .click();
    await page
      .getByRole("button", { name: "Empty Trash in this scope…" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Delete permanently",
      exact: true,
    });
    await expect(
      dialog.getByText("Nothing can be deleted yet.", { exact: false }),
    ).toBeVisible();
    await expect(
      dialog.getByLabel("Confirm permanent Trash deletion"),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Review protection" }).click();
    await expect(
      dialog.getByText("Chapter to revisit", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Saved page position", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Remove my reading data & recheck" }),
    ).toBeDisabled();
    await page.screenshot({
      path: info.outputPath("trash-protection-light.png"),
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({
      path: info.outputPath("trash-protection-dark.png"),
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await dialog
      .getByRole("checkbox", {
        name: "Remove the 2 personal reading records shown above",
      })
      .check();
    await dialog
      .getByRole("button", { name: "Remove my reading data & recheck" })
      .click();
    await expect(
      dialog.getByLabel("Confirm permanent Trash deletion"),
    ).toBeVisible();
    expect((await call(f.req, `resources/${pdf.id}`)).deleted_at).toBeTruthy();
    const tombstones = await call(f.req, `me/reading?groupId=${f.space.id}`);
    expect(tombstones.find((r: any) => r.id === bookmark.id)).toMatchObject({
      deleted: true,
      version: bookmark.version + 1,
    });
    await dialog
      .getByLabel("Confirm permanent Trash deletion")
      .fill("DELETE FOREVER");
    await dialog
      .getByRole("button", { name: "Delete 1 item", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Trash results" }),
    ).toBeVisible();
    expect((await f.req.get(`/api/v1/resources/${pdf.id}`)).status()).toBe(404);
    expect(
      (await call(f.req, `me/reading?groupId=${f.space.id}`)).find(
        (r: any) => r.id === bookmark.id,
      ).deleted,
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    const current = await call(f.req, "me/preferences-bundle");
    await call(
      f.req,
      "me/preferences-bundle",
      {
        editor: current.editor,
        appearance: {
          version: current.appearance.version,
          preferences: bundle.appearance.preferences,
        },
        mutationId: randomUUID(),
      },
      "PATCH",
    );
    await f.owner.close();
  }
});

test("protection details show retaining notes and saved history without exposing another reader's records", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const f = await setup(browser),
    member = await f.member();
  try {
    const pdf = await f.upload("Retained-evidence.pdf");
    const own = await f.reading(pdf, "progress", f.req, "My position");
    const other = await f.reading(
      pdf,
      "bookmark",
      member.request,
      "PRIVATE LABEL MUST NOT LEAK",
    );
    const note = await call(f.req, "notes", {
      groupId: f.group.id,
      title: "Experiment evidence",
      body: `[Evidence](/api/v1/attachments/${pdf.current_version_id})`,
    });
    await call(f.req, `notes/${note.id}/history`, {
      label: "Evidence checkpoint",
    });
    await f.trash(pdf);
    const op = (await f.preview([pdf.id])).operation;
    const path = `trash/${op.id}/items/${pdf.id}`;
    const protection = await call(f.req, `${path}/protection`);
    expect(protection.sources).toContainEqual(
      expect.objectContaining({
        id: note.id,
        current: true,
        history: true,
        href: `/notes/${note.id}`,
      }),
    );
    expect(protection.otherReading).toBe(true);
    expect(JSON.stringify(protection)).not.toContain(other.id);
    expect(JSON.stringify(protection)).not.toContain("PRIVATE LABEL");
    const input = {
      mutationId: randomUUID(),
      confirmation: "REMOVE MY READING DATA",
      records: [{ id: own.id, version: own.version }],
    };
    await call(f.req, `${path}/clear-reading`, input);
    expect((await call(f.req, `${path}/clear-reading`, input)).removed).toBe(1);
    await call(f.req, `trash/${op.id}/recheck`, { mutationId: randomUUID() });
    expect((await call(f.req, `trash/${op.id}`)).operation).toMatchObject({
      blocked: 1,
      pending: 0,
    });
    const denied = await member.request.get(`/api/v1/${path}/protection`);
    expect(denied.status()).toBe(404);
    const page = await f.owner.newPage();
    await page.goto(`/workbench/trash?space=${f.space.id}`);
    await page
      .getByRole("button", { name: "Empty Trash in this scope…" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Delete permanently",
      exact: true,
    });
    await dialog.getByRole("button", { name: "Review protection" }).click();
    await expect(
      dialog.getByText("Another reader’s data", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Saved revision / review history", { exact: false }),
    ).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("trash-retained-history.png"),
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Open note", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/notes/${note.id}`));
    await expect(page.getByTestId("note-editor")).toBeVisible();
  } finally {
    await member.close();
    await f.owner.close();
  }
});

test("personal cleanup checks records, revisions and current permissions; restored targets cannot be changed", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = await setup(browser),
    member = await f.member();
  try {
    const pdf = await f.upload("Protected-cleanup.pdf"),
      unrelated = await f.upload("Unrelated.pdf");
    const own = await f.reading(pdf, "bookmark"),
      otherFile = await f.reading(unrelated, "bookmark");
    await f.trash(pdf);
    const op = (await f.preview([pdf.id])).operation,
      path = `trash/${op.id}/items/${pdf.id}`;
    const clear = (records: unknown) =>
      f.req.post(`/api/v1/${path}/clear-reading`, {
        headers: { origin: origin! },
        data: {
          mutationId: randomUUID(),
          confirmation: "REMOVE MY READING DATA",
          records,
        },
      });
    expect(
      (await clear([{ id: own.id, version: own.version + 1 }])).status(),
    ).toBe(409);
    expect(
      (
        await clear([{ id: otherFile.id, version: otherFile.version }])
      ).status(),
    ).toBe(409);
    expect((await call(f.req, `${path}/protection`)).reading).toHaveLength(1);
    const memberPreview = (
      await call(member.request, "trash/preview", {
        action: "purge",
        spaceIds: [f.space.id],
        ids: [pdf.id],
        mutationId: randomUUID(),
      })
    ).operation;
    expect(
      (
        await member.request.post(
          `/api/v1/trash/${memberPreview.id}/items/${pdf.id}/clear-reading`,
          {
            headers: { origin: origin! },
            data: {
              mutationId: randomUUID(),
              confirmation: "REMOVE MY READING DATA",
              records: [{ id: own.id, version: own.version }],
            },
          },
        )
      ).status(),
    ).toBe(403);
    const current = await call(f.req, `resources/${pdf.id}`);
    await call(f.req, `resources/${pdf.id}/restore`, {
      version: current.version,
    });
    expect((await clear([{ id: own.id, version: own.version }])).status()).toBe(
      409,
    );
    expect(
      (await call(f.req, `me/reading?groupId=${f.space.id}`)).find(
        (r: any) => r.id === own.id,
      ).deleted,
    ).toBe(false);
  } finally {
    await member.close();
    await f.owner.close();
  }
});

test("mixed cleanup deletes only ready targets and a fresh review keeps completed and newly trashed items separate", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = await setup(browser);
  try {
    const pdf = await f.upload("Retained.pdf");
    const reading = await f.reading(pdf, "bookmark");
    const folder = await call(f.req, "resources", {
      spaceId: f.space.id,
      kind: "folder",
      name: "Disposable",
    });
    await f.trash(pdf);
    await f.trash(folder);
    const op = (await f.preview([pdf.id, folder.id])).operation;
    expect(op).toMatchObject({ pending: 1, blocked: 1 });
    const attention = await call(f.req, `trash/${op.id}?filter=attention`);
    expect(attention.filteredTotal).toBe(1);
    expect(attention.items[0].resource_id).toBe(pdf.id);
    const next = await call(f.req, "resources", {
      spaceId: f.space.id,
      kind: "folder",
      name: "Trashed later",
    });
    await f.trash(next);
    await call(f.req, `trash/${op.id}/confirm`, {
      mutationId: randomUUID(),
      confirmation: "DELETE FOREVER",
    });
    await expect
      .poll(async () => (await call(f.req, `trash/${op.id}`)).operation.status)
      .toBe("completed");
    await call(f.req, `trash/${op.id}/items/${pdf.id}/clear-reading`, {
      mutationId: randomUUID(),
      confirmation: "REMOVE MY READING DATA",
      records: [{ id: reading.id, version: reading.version }],
    });
    const rechecked = await call(f.req, `trash/${op.id}/recheck`, {
      mutationId: randomUUID(),
    });
    expect(rechecked.operation).toMatchObject({
      status: "preview",
      done: 1,
      pending: 1,
      blocked: 0,
      total: 2,
    });
    await call(f.req, `trash/${op.id}/confirm`, {
      mutationId: randomUUID(),
      confirmation: "DELETE FOREVER",
    });
    await expect
      .poll(async () => (await call(f.req, `trash/${op.id}`)).operation.done)
      .toBe(2);
    expect((await call(f.req, `resources/${next.id}`)).deleted_at).toBeTruthy();
  } finally {
    await f.owner.close();
  }
});

test("snippets stay protected and inaccessible retaining notes expose no private metadata", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = await setup(browser),
    member = await f.member();
  try {
    const pdf = await f.upload("Snippet-evidence.pdf");
    await call(f.req, "editor-snippets", {
      name: "Evidence template",
      body: `[Evidence](/api/v1/attachments/${pdf.current_version_id})`,
      spaceId: f.space.id,
    });
    const personal = (await call(f.req, "spaces")).find(
      (s: any) => s.kind === "personal",
    );
    const secret = await call(f.req, "resources", {
      kind: "note",
      spaceId: personal.id,
      name: "PRIVATE NOTE TITLE",
      body: `[Evidence](/api/v1/attachments/${pdf.current_version_id})`,
    });
    await f.trash(pdf);
    const op = (await f.preview([pdf.id])).operation;
    expect(op).toMatchObject({ pending: 0, blocked: 1 });
    const own = await call(f.req, `trash/${op.id}/items/${pdf.id}/protection`);
    expect(
      own.safeguards.some((s: any) => s.label === "Reusable editor snippet"),
    ).toBe(true);
    const memberPreview = (
      await call(member.request, "trash/preview", {
        action: "purge",
        spaceIds: [f.space.id],
        ids: [pdf.id],
        mutationId: randomUUID(),
      })
    ).operation;
    const restricted = await call(
      member.request,
      `trash/${memberPreview.id}/items/${pdf.id}/protection`,
    );
    expect(restricted.restrictedSources).toBe(true);
    expect(JSON.stringify(restricted)).not.toContain(secret.id);
    expect(JSON.stringify(restricted)).not.toContain("PRIVATE NOTE TITLE");
  } finally {
    await member.close();
    await f.owner.close();
  }
});

test("quick purge is directly accessible from the file menu and removes personal protection plus the file in one confirmation", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const f = await setup(browser);
  try {
    const pdf = await f.upload("Quick-cleanup.pdf"),
      reading = await f.reading(pdf, "bookmark");
    await f.trash(pdf);
    const page = await f.owner.newPage();
    await page.goto(`/workbench/trash?space=${f.space.id}`);
    await page
      .getByRole("button", { name: "Actions for Quick-cleanup.pdf" })
      .click();
    await page
      .getByRole("menuitem", { name: "Remove protection & purge…" })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Remove protection & purge",
      exact: true,
    });
    await expect(
      dialog.getByText(
        "Your bookmarks, reading-list entries and saved positions",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Remove protection & purge",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    expect((await call(f.req, `resources/${pdf.id}`)).deleted_at).toBeTruthy();
    await page
      .getByRole("button", { name: "Remove protection & purge…", exact: true })
      .click();
    await dialog.getByLabel("Confirm quick purge").fill("DELETE FOREVER");
    await page.screenshot({
      path: info.outputPath("quick-purge.png"),
      fullPage: true,
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Remove protection & purge", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Trash results", exact: true }),
    ).toBeVisible();
    expect((await f.req.get(`/api/v1/resources/${pdf.id}`)).status()).toBe(404);
    expect(
      (await call(f.req, `me/reading?groupId=${f.space.id}`)).find(
        (r: any) => r.id === reading.id,
      ).deleted,
    ).toBe(true);
  } finally {
    await f.owner.close();
  }
});

test("quick purge releases authorized current and saved-history links atomically, rejects stale impact and requires broken-link acknowledgment", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = await setup(browser);
  try {
    const pdf = await f.upload("History-cleanup.pdf");
    await f.reading(pdf, "bookmark");
    const body = `[Preserved link text](/api/v1/attachments/${pdf.current_version_id})`;
    const note = await call(f.req, "notes", {
      groupId: f.group.id,
      title: "History preserved",
      body,
    });
    await call(f.req, `notes/${note.id}/history`, {
      label: "Keep this revision",
    });
    await f.trash(pdf);
    const op = (await f.preview([pdf.id])).operation,
      path = `trash/${op.id}/items/${pdf.id}/quick-purge`;
    const first = await call(f.req, path);
    expect(first).toMatchObject({ canPurge: true, breaksLinks: true });
    const execute = (data: unknown) =>
      f.req.post(`/api/v1/${path}`, { data, headers: { origin: origin! } });
    expect(
      (
        await execute({
          mutationId: randomUUID(),
          fingerprint: first.fingerprint,
          confirmation: "DELETE FOREVER",
          acknowledgeBrokenLinks: false,
        })
      ).status(),
    ).toBe(400);
    await call(f.req, `notes/${note.id}/history`, {
      label: "Added after preview",
    });
    expect(
      (
        await execute({
          mutationId: randomUUID(),
          fingerprint: first.fingerprint,
          confirmation: "DELETE FOREVER",
          acknowledgeBrokenLinks: true,
        })
      ).status(),
    ).toBe(409);
    expect(
      (await call(f.req, `trash/${op.id}/items/${pdf.id}/protection`)).reading,
    ).toHaveLength(1);
    const updated = await call(f.req, path);
    const input = {
      mutationId: randomUUID(),
      fingerprint: updated.fingerprint,
      confirmation: "DELETE FOREVER",
      acknowledgeBrokenLinks: true,
    };
    await call(f.req, path, input);
    expect(await call(f.req, path, input)).toMatchObject({ purged: true });
    expect((await call(f.req, `notes/${note.id}`)).body).toBe(body);
    expect(await call(f.req, `notes/${note.id}/history`)).toHaveLength(2);
    expect(
      (
        await f.req.get(`/api/v1/attachments/${pdf.current_version_id}`)
      ).status(),
    ).toBe(404);
    expect((await call(f.req, `trash/${op.id}`)).operation).toMatchObject({
      done: 1,
      status: "completed",
    });
  } finally {
    await f.owner.close();
  }
});

test("quick purge cannot discard another reader's data or a source outside the manager's access", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = await setup(browser),
    member = await f.member();
  try {
    const pdf = await f.upload("Private-retention.pdf");
    const own = await f.reading(pdf, "bookmark"),
      privateReading = await f.reading(
        pdf,
        "bookmark",
        member.request,
        "DO NOT EXPOSE THIS BOOKMARK",
      );
    const personal = (await call(member.request, "spaces")).find(
      (s: any) => s.kind === "personal",
    );
    const privateNote = await call(member.request, "resources", {
      kind: "note",
      spaceId: personal.id,
      name: "PRIVATE RETAINING NOTE",
      body: `[Evidence](/api/v1/attachments/${pdf.current_version_id})`,
    });
    await f.trash(pdf);
    const op = (await f.preview([pdf.id])).operation,
      path = `trash/${op.id}/items/${pdf.id}/quick-purge`;
    const plan = await call(f.req, path);
    expect(plan.canPurge).toBe(false);
    expect(JSON.stringify(plan)).not.toContain(privateReading.id);
    expect(JSON.stringify(plan)).not.toContain("DO NOT EXPOSE");
    expect(JSON.stringify(plan)).not.toContain(privateNote.id);
    expect(JSON.stringify(plan)).not.toContain("PRIVATE RETAINING NOTE");
    expect(plan.blockers).toContain(
      "You need editor and manager access to every workspace whose notes or history retain this file.",
    );
    const result = await f.req.post(`/api/v1/${path}`, {
      headers: { origin: origin! },
      data: {
        mutationId: randomUUID(),
        fingerprint: plan.fingerprint,
        confirmation: "DELETE FOREVER",
        acknowledgeBrokenLinks: true,
      },
    });
    expect(result.status()).toBe(409);
    expect(
      (await call(f.req, `trash/${op.id}/items/${pdf.id}/protection`)).reading,
    ).toContainEqual(expect.objectContaining({ id: own.id }));
    expect((await member.request.get(`/api/v1/${path}`)).status()).toBe(404);
  } finally {
    await member.close();
    await f.owner.close();
  }
});
