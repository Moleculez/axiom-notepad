import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { PDFDocument } = createRequire(import.meta.url)(
  "pdf-lib",
) as typeof import("pdf-lib");
import { fixture, origin } from "./native-editor-helpers";
import { defaults } from "../../packages/shared/src/appearance";

test.beforeAll(() => {
  // Both coordinators verify an isolated-server fingerprint before fixtures
  // can mutate anything; never accept an arbitrary application origin.
  if (!["http://localhost:3008", "http://localhost:3004"].includes(origin))
    throw new Error("Use isolated research staging on port 3008 or 3004.");
});

test("standalone PDF linking, collection boundaries, viewer access and revocation", async ({
  browser,
}) => {
  test.setTimeout(240000);
  const f = await fixture(browser, "# PDF associations\n");
  try {
    const req = f.member.request,
      scope = { groupId: f.group.id },
      spaces = await call(req, "spaces"),
      team = spaces.find(
        (s: any) => s.group_id === f.group.id && s.kind === "team",
      );
    const r = await call(req, "research/library/items", {
      scope,
      draft: draft("linked-pdf"),
      mutationId: randomUUID(),
    });
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("Fictional spectral study");
    const bytes = Buffer.from(await pdf.save()),
      upload = randomUUID();
    await call(req, "uploads", {
      id: upload,
      spaceId: team.id,
      name: "Spectral-study.pdf",
      bytes: bytes.length,
    });
    const chunk = await req.put(`/api/v1/uploads/${upload}/chunks/1`, {
      headers: { origin, "content-type": "application/octet-stream" },
      data: bytes,
    });
    expect(chunk.ok()).toBe(true);
    await call(req, `uploads/${upload}/complete`, {});
    await expect
      .poll(async () => (await call(req, `uploads/${upload}`)).status, {
        timeout: 45000,
      })
      .toBe("complete");
    const file = await call(
      req,
      `resources/${(await call(req, `uploads/${upload}`)).resourceId}`,
    );
    await call(req, `research/library/items/${r.id}/links`, {
      scope,
      version: r.version,
      kind: "attachment",
      targetId: file.current_version_id,
      mutationId: randomUUID(),
    });
    let detail = await call(req, `research/library/items/${r.id}`);
    expect(detail.attachments[0].resource_id).toBe(file.id);
    const graph = await call(req, `research/graph?groupId=${f.group.id}`);
    expect(
      graph.edges.some(
        (e: any) =>
          e.source === "reference:" + r.id &&
          e.target === "pdf:" + file.current_version_id,
      ),
    ).toBe(true);
    await call(req, `research/library/items/${r.id}/links`, {
      scope,
      version: detail.version,
      kind: "note",
      targetId: f.note.id,
      mutationId: randomUUID(),
    });
    detail = await call(req, `research/library/items/${r.id}`);
    expect(detail.notes[0].manual).toBe(true);
    await call(
      req,
      `research/library/items/${r.id}/links`,
      {
        scope,
        version: detail.version,
        kind: "note",
        targetId: f.note.id,
        mutationId: randomUUID(),
      },
      "DELETE",
    );
    const personal = await call(req, "research/library/items", {
      scope: { groupId: null },
      draft: draft("private-link"),
      mutationId: randomUUID(),
    });
    const cross = await req.post(
      `/api/v1/research/library/items/${personal.id}/links`,
      {
        headers: { origin },
        data: {
          scope: { groupId: null },
          version: 1,
          kind: "attachment",
          targetId: file.current_version_id,
          mutationId: randomUUID(),
        },
      },
    );
    expect(cross.status()).toBe(400);
    const collection = await call(req, "research/library/collections", {
      scope,
      name: "Parent",
      mutationId: randomUUID(),
    });
    const child = await call(req, "research/library/collections", {
      scope,
      parentId: collection.id,
      name: "Child",
      mutationId: randomUUID(),
    });
    const cycle = await req.patch(
      `/api/v1/research/library/collections/${collection.id}`,
      {
        headers: { origin },
        data: {
          scope,
          parentId: child.id,
          version: 1,
          mutationId: randomUUID(),
        },
      },
    );
    expect(cycle.status()).toBe(400);
    const user = (await call(req, "me")).user;
    await call(
      f.owner.request,
      `members/${user.id}?groupId=${f.group.id}`,
      { contentRole: "viewer" },
      "PATCH",
    );
    const viewer = await call(req, `research/library?groupId=${f.group.id}`);
    expect(viewer.canEdit).toBe(false);
    const denied = await req.post("/api/v1/research/library/items", {
      headers: { origin },
      data: { scope, draft: draft("forbidden"), mutationId: randomUUID() },
    });
    expect(denied.status()).toBe(403);
    await call(req, "research/library/batch", {
      scope,
      ids: [r.id],
      versions: { [r.id]: viewer.items[0].version },
      operation: "reading",
      status: "reading",
      mutationId: randomUUID(),
    });
    await call(
      f.owner.request,
      `members/${user.id}?groupId=${f.group.id}`,
      undefined,
      "DELETE",
    );
    const revoked = await req.get(
      `/api/v1/research/graph?groupId=${f.group.id}`,
    );
    expect(revoked.status()).toBe(404);
    expect(
      (await call(req, `research/library/items/${personal.id}`)).title,
    ).toBe(personal.title);
  } finally {
    await f.close();
  }
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
const draft = (
  citeKey: string,
  title = "Spectral analysis of research networks",
) => ({
  citeKey,
  title,
  authors: "Ada Example and Sam Example",
  year: "2026",
  venue: "Example Research",
  doi: "10.5555/spectral-demo",
  arxiv: "",
  url: "https://example.org/paper",
  tags: ["spectral"],
});
test("workspace-owned libraries isolate siblings, restricted content, citations and lifecycle", async ({
  browser,
}) => {
  test.setTimeout(240000);
  const f = await fixture(browser, "# Workspace libraries\n");
  try {
    const req = f.owner.request;
    const createSpace = (name: string, audience: string) =>
      call(req, "projects", {
        groupId: f.group.id,
        name,
        audience,
        mutationId: randomUUID(),
      });
    const a = await createSpace("Independent library A", "group");
    const b = await createSpace("Restricted library B", "restricted");
    const scopeA = { spaceId: a.space_id },
      scopeB = { spaceId: b.space_id };
    const reference = (scope: typeof scopeA, title: string) =>
      call(req, "research/library/items", {
        scope,
        draft: draft("same-key", title),
        mutationId: randomUUID(),
      });
    const ra = await reference(scopeA, "Public workspace metadata");
    const rb = await reference(scopeB, "Restricted independent metadata");
    expect(ra.id).not.toBe(rb.id);
    expect(ra.space_id).toBe(a.space_id);
    expect(rb.space_id).toBe(b.space_id);
    const pageA = await call(req, `research/library?spaceId=${a.space_id}`);
    expect(pageA.items.map((r: any) => r.id)).toEqual([ra.id]);
    for (const path of [
      `research/library?spaceId=${b.space_id}`,
      `research/library/items/${rb.id}`,
      `research/graph?spaceId=${b.space_id}`,
      `research/workbench?spaceId=${b.space_id}`,
    ])
      expect(
        (await f.member.request.get("/api/v1/" + path)).status(),
        path,
      ).toBe(404);
    expect(
      (
        await f.member.request.delete(
          `/api/v1/references/${rb.id}?groupId=${f.group.id}`,
          { headers: { origin } },
        )
      ).status(),
    ).toBe(404);
    const collection = await call(req, "research/library/collections", {
      scope: scopeB,
      name: "Restricted collection",
      mutationId: randomUUID(),
    });
    const cross = await req.post("/api/v1/research/library/batch", {
      headers: { origin },
      data: {
        scope: scopeA,
        ids: [ra.id],
        versions: { [ra.id]: ra.version },
        operation: "collection-add",
        collectionId: collection.id,
        mutationId: randomUUID(),
      },
    });
    expect([400, 404]).toContain(cross.status());
    const note = await call(req, "files/new", {
      type: "markdown",
      name: "Workspace-specific citation",
      spaceId: a.space_id,
      source: "A result [@same-key].",
      mutationId: randomUUID(),
    });
    const context = await call(req, `notes/${note.id}/context`);
    expect(
      context.references.find((r: any) => r.cite_key === "same-key").title,
    ).toBe(ra.title);
    const wrongLink = await req.post(
      `/api/v1/research/library/items/${rb.id}/links`,
      {
        headers: { origin },
        data: {
          scope: scopeB,
          version: rb.version,
          kind: "note",
          targetId: note.id,
          mutationId: randomUUID(),
        },
      },
    );
    expect(wrongLink.status()).toBe(400);
    const graphB = await call(req, `research/graph?spaceId=${b.space_id}`);
    expect(graphB.nodes.map((n: any) => n.id)).toEqual(["reference:" + rb.id]);
    const queueB = await call(
      req,
      `research/workbench?spaceId=${b.space_id}&view=queue`,
    );
    expect(queueB.items.some((r: any) => r.id === rb.id)).toBe(true);
    const member = (await call(f.member.request, "me")).user;
    await call(req, `projects/${b.id}/members`, {
      userId: member.id,
      role: "viewer",
      mutationId: randomUUID(),
    });
    expect(
      (await call(f.member.request, `research/library?spaceId=${b.space_id}`))
        .canEdit,
    ).toBe(false);
    const denied = await f.member.request.post(
      "/api/v1/research/library/items",
      {
        headers: { origin },
        data: {
          scope: scopeB,
          draft: draft("blocked"),
          mutationId: randomUUID(),
        },
      },
    );
    expect(denied.status()).toBe(403);
    await call(req, `projects/${b.id}/members`, {
      userId: member.id,
      remove: true,
      mutationId: randomUUID(),
    });
    expect(
      (
        await f.member.request.get(`/api/v1/research/library/items/${rb.id}`)
      ).status(),
    ).toBe(404);
    const transition = async (action: string) => {
      const space = (await call(req, "spaces?manage=1")).find(
        (s: any) => s.id === b.space_id,
      );
      return call(req, `spaces/${b.space_id}/${action}`, {
        version: space.version,
        confirmation: space.name,
        mutationId: randomUUID(),
      });
    };
    await transition("archive");
    expect(
      (await call(req, `research/library?spaceId=${b.space_id}`)).canEdit,
    ).toBe(false);
    await transition("trash");
    expect(
      (await req.get(`/api/v1/research/library/items/${rb.id}`)).status(),
    ).toBe(404);
    await transition("restore");
    await transition("unarchive");
    expect((await call(req, `research/library/items/${rb.id}`)).title).toBe(
      rb.title,
    );
    await transition("trash");
    await transition("purge");
    await expect
      .poll(
        async () =>
          (await req.get(`/api/v1/spaces/${b.space_id}/lifecycle`)).status(),
        { timeout: 45000 },
      )
      .toBe(404);
    expect(
      (await req.get(`/api/v1/research/library/items/${rb.id}`)).status(),
    ).toBe(404);
    expect((await call(req, `research/library/items/${ra.id}`)).title).toBe(
      ra.title,
    );
  } finally {
    await f.close();
  }
});

test("workspace Research navigation and old offline reading edits stay scoped", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const f = await fixture(browser, "# Navigation\n");
  try {
    const req = f.member.request;
    const user = (await call(req, "me")).user;
    const team = (await call(req, "spaces")).find(
      (s: any) => s.group_id === f.group.id && s.kind === "team",
    );
    const ref = await call(req, "research/library/items", {
      scope: { spaceId: team.id },
      draft: draft("offline-preserved"),
      mutationId: randomUUID(),
    });
    const pendingId = randomUUID(),
      filterId = randomUUID();
    await f.page.evaluate(
      async ({ user, group, ref, pendingId, filterId }) => {
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(`axiom:${user}:research-v1`);
          request.onupgradeneeded = () =>
            request.result.createObjectStore("items", { keyPath: "key" });
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction("items", "readwrite");
            for (const [id, kind, target_type, target_id, data] of [
              [pendingId, "reading", "reference", ref, { status: "read" }],
              [
                filterId,
                "filter",
                "group",
                group,
                { label: "Pending saved search", query: "spectral" },
              ],
            ])
              tx.objectStore("items").put({
                key: `reading:${id}`,
                kind: "reading",
                groupId: group,
                pending: true,
                value: {
                  id,
                  group_id: group,
                  kind,
                  target_type,
                  target_id,
                  data,
                  version: 0,
                  mutation_id: crypto.randomUUID(),
                  deleted: false,
                },
              });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        });
      },
      { user: user.id, group: f.group.id, ref: ref.id, pendingId, filterId },
    );
    await f.page.goto(`/workbench/research/references?groupId=${f.group.id}`);
    await expect(f.page).toHaveURL(
      new RegExp(`/workspaces/${team.id}/research\\?.*view=library`),
    );
    await expect(
      f.page
        .locator(".ws-sidebar")
        .getByRole("link", { name: "Research", exact: true }),
    ).toHaveCount(0);
    await expect(
      f.page.getByLabel("Research context", { exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await call(req, `me/reading?groupId=${team.id}`)).filter((r: any) =>
            [pendingId, filterId].includes(r.id),
          ).length,
      )
      .toBe(2);
    const synced = await call(req, `me/reading?groupId=${team.id}`);
    expect(synced.find((r: any) => r.id === pendingId).data.status).toBe(
      "read",
    );
    expect(synced.find((r: any) => r.id === filterId).target_id).toBe(team.id);
    await expect(
      f.page.getByRole("button", { name: "Pending saved search", exact: true }),
    ).toBeVisible();
    await f.page.screenshot({
      path: info.outputPath("workspace-research-library.png"),
    });
    const workspaceNavigation = f.page.getByRole("navigation", {
      name: "Workspace sections",
    });
    const sections = await workspaceNavigation
      .getByRole("link")
      .allTextContents();
    expect(sections.indexOf("Research")).toBe(sections.indexOf("Overview") + 1);
    expect(sections.indexOf("Files")).toBe(sections.indexOf("Research") + 1);
    await f.page
      .getByRole("navigation", { name: "Research views" })
      .getByRole("button", { name: "Knowledge graph" })
      .click();
    await workspaceNavigation
      .getByRole("link", { name: "Files", exact: true })
      .click();
    await workspaceNavigation
      .getByRole("link", { name: "Research", exact: true })
      .click();
    await expect(f.page).toHaveURL(/view=graph/);
    await f.page.goto("/workbench/settings/data");
    const context = f.page.getByLabel("Reading workspace", { exact: true });
    await expect(context).toBeVisible();
    await context.selectOption(team.id);
    await expect(context).toHaveValue(team.id);
    await expect(context.locator(`option[value="${f.group.id}"]`)).toHaveCount(
      0,
    );
  } finally {
    await f.close();
  }
});

test("scoped library, previewed import, safe merge, preserved citations, trash and private copy", async ({
  browser,
}) => {
  test.setTimeout(240000);
  const f = await fixture(
    browser,
    "# Evidence\n\nThe result [@spectral-a; @spectral-b].\n",
  );
  try {
    const req = f.member.request,
      scope = { groupId: f.group.id };
    const create = async (key: string) =>
      call(req, "research/library/items", {
        scope,
        draft: draft(key),
        mutationId: randomUUID(),
      });
    const a = await create("spectral-a"),
      b = await create("spectral-b");
    const collection = await call(req, "research/library/collections", {
      scope,
      name: "Methods",
      mutationId: randomUUID(),
    });
    await call(req, "research/library/batch", {
      scope,
      ids: [a.id],
      versions: { [a.id]: a.version },
      operation: "collection-add",
      collectionId: collection.id,
      mutationId: randomUUID(),
    });
    let page = await call(
      req,
      `research/library?groupId=${f.group.id}&filter=duplicates`,
    );
    expect(page.items).toHaveLength(2);
    const chosen = page.items;
    const {
      citeKey: _key,
      tags: _tags,
      ...metadata
    } = draft("spectral-a", "Reviewed spectral methods");
    const merge = {
      scope,
      ids: chosen.map((r: any) => r.id),
      versions: Object.fromEntries(chosen.map((r: any) => [r.id, r.version])),
      targetId: a.id,
      draft: metadata,
    };
    const preview = await call(req, "research/library/merge/preview", merge);
    const apply = { ...merge, hash: preview.hash, mutationId: randomUUID() };
    await call(req, "research/library/merge/apply", apply);
    await call(req, "research/library/merge/apply", apply);
    const alias = await call(req, "research/library/items/" + b.id);
    expect(alias.canonical_id).toBe(a.id);
    expect(alias.cite_key).toBe("spectral-b");
    expect(alias.title).toBe(metadata.title);
    expect(alias.bibtex).toContain("{spectral-b,");
    const spaces = await call(req, "spaces"),
      space = spaces.find(
        (s: any) => s.group_id === f.group.id && s.kind === "team",
      );
    const importedNote = await call(req, "files/new", {
      type: "markdown",
      name: "File-menu citation regression",
      spaceId: space.id,
      mutationId: randomUUID(),
      source: "# Imported note\n\nA citation [@spectral-b].\n",
    });
    await expect
      .poll(async () => {
        const g = await call(
          req,
          `research/graph?groupId=${f.group.id}&spaceId=${space.id}`,
        );
        return g.edges.some(
          (e: any) =>
            e.source === "note:" + importedNote.id &&
            e.target === "reference:" + a.id &&
            e.kind === "citation",
        );
      })
      .toBe(true);
    const citationContext = await call(req, `notes/${f.note.id}/context`);
    expect(
      citationContext.references
        .filter((r: any) => ["spectral-a", "spectral-b"].includes(r.cite_key))
        .map((r: any) => r.title),
    ).toEqual([metadata.title, metadata.title]);
    const exported = await call(req, `notes/${f.note.id}/export-preview`, {
      snapshot: {
        source: await f.source(),
        title: "Citation export",
        generation: f.note.generation,
      },
      options: {},
      preferences: defaults,
    });
    expect(exported.html).toContain(metadata.title);
    expect(exported.html).toContain("spectral-b");
    const graph = await call(req, `research/graph?groupId=${f.group.id}`);
    expect(graph.nodes.some((n: any) => n.id === "reference:" + a.id)).toBe(
      true,
    );
    expect(
      graph.edges.some(
        (e: any) =>
          e.source === "note:" + f.note.id &&
          e.target === "reference:" + a.id &&
          e.kind === "citation",
      ),
    ).toBe(true);
    const detail = await call(req, "research/library/items/" + a.id);
    await call(req, "research/library/batch", {
      scope,
      ids: [a.id],
      versions: { [a.id]: detail.version },
      operation: "trash",
      mutationId: randomUUID(),
    });
    page = await call(
      req,
      `research/library?groupId=${f.group.id}&filter=trash`,
    );
    expect(page.items).toHaveLength(1);
    await call(req, "research/library/batch", {
      scope,
      ids: [a.id],
      versions: { [a.id]: page.items[0].version },
      operation: "restore",
      mutationId: randomUUID(),
    });
    const imports = {
      scope,
      format: "ris",
      source:
        "TY  - JOUR\nID  - diffusion\nTI  - Diffusion in measured systems\nAU  - Example, A\nPY  - 2025\nDO  - 10.5555/diffusion\nKW  - physics\nER  -",
      skipDuplicates: true,
    };
    const ip = await call(req, "research/library/import/preview", imports);
    expect(ip.count).toBe(1);
    const imported = await call(req, "research/library/import/apply", {
      ...imports,
      hash: ip.hash,
      mutationId: randomUUID(),
    });
    expect(imported.added).toBe(1);
    const next = await call(req, "research/library/import/preview", imports);
    expect(next.count).toBe(0);
    const personal = { groupId: null };
    const own = await call(req, "research/library/items", {
      scope: personal,
      draft: draft("private-study", "A private bibliographic record"),
      mutationId: randomUUID(),
    });
    const forbidden = await f.owner.request.get(
      "/api/v1/research/library/items/" + own.id,
    );
    expect(forbidden.status()).toBe(404);
    const copy = {
      scope,
      sourceScope: personal,
      ids: [own.id],
      skipDuplicates: false,
    };
    const cp = await call(req, "research/library/copy/preview", copy);
    expect(cp.privateCopy).toBe(true);
    const denied = await req.post("/api/v1/research/library/copy/apply", {
      headers: { origin },
      data: { ...copy, hash: cp.hash, mutationId: randomUUID() },
    });
    expect(denied.status()).toBe(400);
    const copied = await call(req, "research/library/copy/apply", {
      ...copy,
      hash: cp.hash,
      mutationId: randomUUID(),
      confirmAudience: true,
    });
    const copiedDetail = await call(
      req,
      "research/library/items/" + copied.ids[0],
    );
    expect(copiedDetail.notes).toEqual([]);
    expect(copiedDetail.attachments).toEqual([]);
    await call(req, "research/library/batch", {
      scope,
      ids: [copied.ids[0]],
      versions: { [copied.ids[0]]: copiedDetail.version },
      operation: "reading",
      status: "read",
      mutationId: randomUUID(),
    });
    const ownerPage = await call(
      f.owner.request,
      `research/library?groupId=${f.group.id}`,
    );
    expect(
      ownerPage.items.find((r: any) => r.id === copied.ids[0]).status,
    ).toBe("want");
    const memberPage = await call(
      req,
      `research/library?groupId=${f.group.id}`,
    );
    expect(
      memberPage.items.find((r: any) => r.id === copied.ids[0]).status,
    ).toBe("read");
    const stale = await req.patch("/api/v1/research/library/items/" + a.id, {
      headers: { origin },
      data: {
        scope,
        version: 1,
        draft: { ...metadata, tags: [] },
        mutationId: randomUUID(),
      },
    });
    expect(stale.status()).toBe(409);
    expect(await f.source()).toContain("[@spectral-a; @spectral-b]");
  } finally {
    await f.close();
  }
});

test("Graph node clicks inspect, double-clicks open sources, and dragging stays separate", async ({
  browser,
}, info) => {
  test.setTimeout(180000);
  const f = await fixture(
    browser,
    "# Graph interactions\n\nSee [@pointer-study].\n",
  );
  try {
    const reference = await call(f.member.request, "research/library/items", {
      scope: { groupId: f.group.id },
      draft: draft("pointer-study"),
      mutationId: randomUUID(),
    });
    const graphUrl = `/workbench/research?view=graph&groupId=${f.group.id}`;
    await f.page.goto(graphUrl);
    const referenceNode = f.page.locator(
        `[data-node="reference:${reference.id}"]`,
      ),
      noteNode = f.page.locator(`[data-node="note:${f.note.id}"]`),
      details = f.page.getByRole("complementary", { name: "Graph details" });
    await expect(referenceNode).toBeVisible();

    // Click the painted SVG node, not the alternate accessible list button.
    await referenceNode.locator(".research-node-halo").click();
    await expect(details).toBeVisible();
    await expect(details).toContainText(
      "Spectral analysis of research networks",
    );
    await expect(referenceNode).toHaveClass(/selected/);
    await expect(referenceNode).toHaveAttribute("aria-pressed", "true");
    await expect(referenceNode).toBeFocused();
    await expect(f.page).toHaveURL(
      new RegExp(`focus=reference%3A${reference.id}`),
    );
    await f.page.screenshot({
      path: info.outputPath("graph-node-selected.png"),
    });

    // Background click clears selection; dragging a node must not select/open it.
    await f.page
      .locator(".research-graph-background")
      .click({ position: { x: 20, y: 20 } });
    await expect(details).toHaveCount(0);
    const before = await referenceNode.getAttribute("transform"),
      point = await referenceNode.locator(".research-node-halo").boundingBox();
    expect(point).not.toBeNull();
    await f.page.mouse.move(
      point!.x + point!.width / 2,
      point!.y + point!.height / 2,
    );
    await f.page.mouse.down();
    await f.page.mouse.move(
      point!.x + point!.width / 2 + 60,
      point!.y + point!.height / 2 + 30,
      { steps: 8 },
    );
    await f.page.mouse.up();
    await expect(referenceNode).not.toHaveAttribute("transform", before!);
    await expect(details).toHaveCount(0);
    await expect(f.page).toHaveURL(
      (url) =>
        /^\/workbench\/workspaces\/[^/]+\/research$/.test(url.pathname) &&
        url.searchParams.get("view") === "graph" &&
        !url.searchParams.has("focus"),
    );

    await referenceNode.locator(".research-node-halo").click();
    await expect(details).toBeVisible();
    const canvasTransform = f.page.locator(".research-graph-board > svg > g"),
      viewBeforePan = await canvasTransform.getAttribute("transform"),
      canvas = await f.page
        .locator(".research-graph-board > svg")
        .boundingBox();
    await f.page.mouse.move(canvas!.x + 20, canvas!.y + 20);
    await f.page.mouse.down();
    await f.page.mouse.move(canvas!.x + 50, canvas!.y + 40, { steps: 5 });
    await f.page.mouse.up();
    await expect(canvasTransform).not.toHaveAttribute(
      "transform",
      viewBeforePan!,
    );
    await expect(details).toBeVisible();

    await referenceNode.press("Escape");
    await expect(details).toHaveCount(0);
    // Normal hand movement below the drag threshold remains a click.
    const still = await referenceNode.getAttribute("transform"),
      clickPoint = await referenceNode
        .locator(".research-node-halo")
        .boundingBox();
    await f.page.mouse.move(
      clickPoint!.x + clickPoint!.width / 2,
      clickPoint!.y + clickPoint!.height / 2,
    );
    await f.page.mouse.down();
    await f.page.mouse.move(
      clickPoint!.x + clickPoint!.width / 2 + 2,
      clickPoint!.y + clickPoint!.height / 2 + 1,
    );
    await f.page.mouse.up();
    await expect(referenceNode).toHaveAttribute("transform", still!);
    await expect(details).toBeVisible();

    await noteNode.focus();
    await noteNode.press("Enter");
    await expect(details).toContainText("Native editor study");
    const firstVisit = f.page.waitForResponse((response) =>
      response.url().endsWith(`/resources/${f.note.id}/review-visit`),
    );
    await details
      .getByRole("button", { name: "Open source", exact: true })
      .click();
    await expect(f.page).toHaveURL(new RegExp(`/notes/${f.note.id}$`));
    await expect(f.page.getByTestId("note-editor")).toBeVisible();
    expect((await firstVisit).ok()).toBe(true);
    await expect(f.page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );

    // Use in-app history instead of unloading an editor with background reads
    // still in flight (WebKit reports those aborted fetches as access errors).
    await f.page.goBack();
    await details.getByRole("button", { name: "Close graph details" }).click();
    await referenceNode.locator(".research-node-halo").dblclick();
    await expect(f.page).toHaveURL(
      (url) =>
        url.searchParams.get("view") === "library" &&
        url.searchParams.get("reference") === reference.id,
    );
    await expect(
      f.page.getByRole("complementary", { name: "Reference details" }),
    ).toBeVisible();
    await f.page
      .getByRole("navigation", { name: "Research views" })
      .getByRole("button", { name: "Knowledge graph" })
      .click();
    await details.getByRole("button", { name: "Close graph details" }).click();
    const secondVisit = f.page.waitForResponse((response) =>
      response.url().endsWith(`/resources/${f.note.id}/review-visit`),
    );
    await noteNode.locator(".research-node-halo").dblclick();
    await expect(f.page).toHaveURL(new RegExp(`/notes/${f.note.id}$`));
    await expect(f.page.getByTestId("note-editor")).toBeVisible();
    expect((await secondVisit).ok()).toBe(true);
    await expect(f.page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
  } finally {
    await f.close();
  }
});

test("Research tabs, library inspector, aligned graph search and exports", async ({
  browser,
}, info) => {
  test.setTimeout(240000);
  const f = await fixture(
    browser,
    "# Connected research\n\nSee [@spectral-ui].\n",
  );
  try {
    const scope = { groupId: f.group.id };
    await call(f.member.request, "research/library/items", {
      scope,
      draft: draft("spectral-ui"),
      mutationId: randomUUID(),
    });
    await f.page.goto(`/workbench/research/references?groupId=${f.group.id}`);
    await expect(f.page).toHaveURL(/\/research\?.*view=library/);
    const nav = f.page.getByRole("navigation", { name: "Research views" });
    await expect(nav.getByRole("button")).toHaveCount(5);
    await expect(
      f.page.getByLabel("Filter reference author", { exact: true }),
    ).toBeHidden();
    await f.page.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(
      f.page.getByLabel("Filter reference author", { exact: true }),
    ).toBeVisible();
    await f.page.getByRole("button", { name: "Filters", exact: true }).click();
    await f.page
      .getByRole("button", { name: /Spectral analysis of research networks/ })
      .click();
    await expect(
      f.page.getByRole("complementary", { name: "Reference details" }),
    ).toBeVisible();
    await f.page
      .getByRole("checkbox", { name: "Select spectral-ui", exact: true })
      .check();
    await nav.getByRole("button", { name: "Knowledge graph" }).click();
    await expect(f.page.locator(".research-node")).toHaveCount(2);
    const alignment = await f.page
      .locator(".research-graph .research-search")
      .evaluate((el) => {
        const a = el.querySelector("svg")!.getBoundingClientRect(),
          b = el.querySelector("input")!.getBoundingClientRect();
        return Math.abs(a.y + a.height / 2 - b.y - b.height / 2);
      });
    expect(alignment).toBeLessThan(2);
    await f.page.getByLabel("Search graph", { exact: true }).fill("spectral");
    await expect(f.page.locator(".research-node.dim")).toHaveCount(1);
    await f.page.getByRole("button", { name: "Accessible list view" }).click();
    await f.page
      .getByRole("button", { name: /Spectral analysis of research networks/ })
      .click();
    await expect(
      f.page.getByRole("complementary", { name: "Graph details" }),
    ).toBeVisible();
    await f.page.getByLabel("Graph neighborhood").selectOption("1");
    await f.page
      .getByRole("button", { name: "Graph view", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "Fit graph", exact: true })
      .click();
    await f.page.screenshot({ path: info.outputPath("research-graph.png") });
    const download = f.page.waitForEvent("download");
    await f.page.locator(".research-graph-footer summary").click();
    await f.page.getByRole("button", { name: "JSON", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("research-graph.json");
    for (const format of ["SVG", "PNG"]) {
      const exported = f.page.waitForEvent("download");
      await f.page.getByRole("button", { name: format, exact: true }).click();
      expect((await exported).suggestedFilename()).toBe(
        `research-graph.${format.toLowerCase()}`,
      );
    }
    if (await f.page.evaluate(() => document.fullscreenEnabled)) {
      await f.page
        .getByRole("button", { name: "Fullscreen graph", exact: true })
        .click();
      await expect
        .poll(() => f.page.evaluate(() => !!document.fullscreenElement))
        .toBe(true);
      await f.page
        .getByRole("button", { name: "Fullscreen graph", exact: true })
        .click();
      await expect
        .poll(() => f.page.evaluate(() => !!document.fullscreenElement))
        .toBe(false);
    }
    await nav.getByRole("button", { name: "Library", exact: true }).click();
    await expect(
      f.page.getByRole("checkbox", { name: "Select spectral-ui", exact: true }),
    ).toBeChecked();
    await expect(
      f.page.getByRole("complementary", { name: "Reference details" }),
    ).toBeVisible();
    await f.page.screenshot({ path: info.outputPath("research-library.png") });
    await f.page.setViewportSize({ width: 1280, height: 800 });
    const layout = await f.page.locator(".research-embedded").evaluate((el) => {
      const content = el.getBoundingClientRect();
      const panel = el
        .querySelector(".research-tab-panel:not([hidden]) .research-inspector")!
        .getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        inset: panel.right < content.right - 10,
        height: panel.height,
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.inset).toBe(true);
    expect(layout.height).toBeGreaterThan(250);
    // Standard shared targets may wrap into two complete rows beside the
    // inspector. A fixed single-row height would require shrinking targets or
    // clipping actions; verify useful geometry instead.
    const selection = await f.page
      .locator(".library-selection")
      .evaluate((el) => {
        const shell = el.getBoundingClientRect(),
          style = getComputedStyle(el),
          controls = [
            ...el.querySelectorAll(":scope > button, :scope > select"),
          ].map((control) => control.getBoundingClientRect()),
          height = Math.max(
            32,
            parseFloat(getComputedStyle(document.body).fontSize) * 2.4,
          ),
          rows: number[] = [];
        for (const box of controls)
          if (!rows.some((top) => Math.abs(top - box.top) < 1))
            rows.push(box.top);
        return {
          rows: rows.length,
          overflow: el.scrollWidth - el.clientWidth,
          contained: controls.every(
            (box) =>
              box.left >= shell.left &&
              box.right <= shell.right + 1 &&
              box.top >= shell.top &&
              box.bottom <= shell.bottom + 1,
          ),
          heightDelta: Math.max(
            ...controls.map((box) => Math.abs(box.height - height)),
          ),
          aligned: controls.every((box) =>
            controls.every(
              (other) =>
                Math.abs(box.top - other.top) >= height / 2 ||
                Math.abs(box.bottom - other.bottom) < 1,
            ),
          ),
          height: shell.height,
          heightBudget: height * 3 + parseFloat(style.rowGap) + 2,
        };
      });
    expect(selection.rows).toBeGreaterThan(0);
    expect(selection.rows).toBeLessThanOrEqual(2);
    expect(selection.overflow).toBeLessThanOrEqual(1);
    expect(selection.contained).toBe(true);
    expect(selection.heightDelta).toBeLessThan(1);
    expect(selection.aligned).toBe(true);
    expect(selection.height).toBeLessThanOrEqual(selection.heightBudget);
    await f.page.screenshot({
      path: info.outputPath("research-library-1280.png"),
    });
    await f.page.setViewportSize({ width: 1440, height: 1000 });
    await f.page
      .getByRole("button", { name: "Add reference", exact: true })
      .click();
    await f.page.getByLabel("Citation key", { exact: true }).fill("ui-created");
    await f.page
      .getByLabel("Reference title", { exact: true })
      .fill("A reference created through the interface");
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "Add reference", exact: true })
      .click();
    await expect(f.page.getByRole("dialog")).toHaveCount(0);
    await expect(
      f.page.getByRole("complementary", { name: "Reference details" }),
    ).toContainText("A reference created through the interface");
    await f.page
      .getByRole("button", { name: "Save library search", exact: true })
      .click();
    await f.page
      .getByRole("dialog")
      .getByRole("textbox")
      .fill("Sources to revisit");
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      f.page.getByRole("button", { name: "Sources to revisit", exact: true }),
    ).toBeVisible();
    await f.page
      .getByRole("button", { name: "Manage saved search Sources to revisit" })
      .click();
    await f.page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await f.page
      .getByRole("dialog")
      .getByRole("textbox")
      .fill("Reviewed search");
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      f.page.getByRole("button", { name: "Reviewed search", exact: true }),
    ).toBeVisible();
    await f.page
      .getByRole("button", { name: "Manage saved search Reviewed search" })
      .click();
    await f.page
      .getByRole("menuitem", { name: "Delete saved search", exact: true })
      .click();
    await expect(
      f.page.getByRole("button", { name: "Reviewed search", exact: true }),
    ).toHaveCount(0);
  } finally {
    await f.close();
  }
});
