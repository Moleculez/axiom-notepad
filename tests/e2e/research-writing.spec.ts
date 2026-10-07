import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fixture, origin, replaceSource } from "./native-editor-helpers";
import {
  researchWritingSource,
  researchWritingReferences,
} from "../fixtures/research-writing";
const JSZip = createRequire(import.meta.url)("jszip") as typeof import("jszip");
const sharp = createRequire(import.meta.url)(
  "sharp",
) as typeof import("sharp").default;
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error(
      "Research-writing mutations require isolated reliability staging.",
    );
});
test.setTimeout(240000);
async function call(
  req: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const response = await req.fetch(`/api/v1/${path}`, {
    method,
    headers: { origin },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
const mutation = (data: object) => ({ mutationId: randomUUID(), ...data });
async function importReferences(
  req: APIRequestContext,
  spaceId: string,
  source = researchWritingReferences[0].bibtex!,
) {
  const input = {
    scope: { spaceId },
    source,
    format: "bib",
    skipDuplicates: false,
  };
  const preview = await call(req, "research/library/import/preview", input);
  const result = await call(
    req,
    "research/library/import/apply",
    mutation({ ...input, hash: preview.hash }),
  );
  return Promise.all(
    result.ids.map((id: string) => call(req, `research/library/items/${id}`)),
  );
}
async function waitExport(req: APIRequestContext, id: string) {
  await expect
    .poll(
      async () =>
        (await call(req, "exports")).find((j: any) => j.id === id)?.status,
      { timeout: 90000 },
    )
    .toBe("ready");
  const response = await req.get(`/api/v1/exports/${id}/download`);
  expect(response.ok(), await response.text()).toBe(true);
  return JSZip.loadAsync(await response.body());
}
test("editable paper exports preserve unsaved source and original figures; reading review and both backends work", async ({
  browser,
}, info) => {
  const f = await fixture(
    browser,
    researchWritingSource +
      "\n```mermaid\nflowchart LR\n  Study --> Result\n```\n",
  );
  try {
    const req = f.member.request,
      resource = await call(req, `resources/${f.note.id}`);
    await importReferences(req, resource.space_id);
    const figure = await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#335a70" },
    })
      .png()
      .toBuffer();
    const upload = await req.post(`/api/v1/notes/${f.note.id}/attachments`, {
      headers: { origin },
      multipart: {
        file: {
          name: "paper-figure.png",
          mimeType: "image/png",
          buffer: figure,
        },
      },
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const asset = await upload.json();
    await replaceSource(
      f.page,
      (await f.source()) + `\n![Experiment](/api/v1/attachments/${asset.id})\n`,
    );
    await expect.poll(f.source).toContain(asset.id);
    const canonical = await f.source();
    await f.page
      .getByRole("button", { name: "Export document", exact: true })
      .click();
    const dialog = f.page.getByRole("dialog", {
      name: "Export document",
      exact: true,
    });
    await dialog.getByLabel("Format", { exact: true }).selectOption("latex");
    await expect(dialog.getByLabel("Generated LaTeX source")).toContainText(
      "\\documentclass",
    );
    await dialog.getByRole("button", { name: "Reading", exact: true }).click();
    await expect(
      f.page
        .frameLocator('iframe[title="Manuscript reading preview"]')
        .getByRole("heading", { name: "Conservation", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Files", exact: true }).click();
    await expect(dialog).toContainText("export-manifest.json");
    await dialog
      .getByRole("button", { name: "Prepare project", exact: true })
      .click();
    const downloadLink = dialog.getByRole("link", {
      name: "Download project",
      exact: true,
    });
    await expect(downloadLink).toBeVisible({ timeout: 90000 });
    const downloaded = f.page.waitForEvent("download");
    await downloadLink.click();
    const zip = await JSZip.loadAsync(
      await readFile((await (await downloaded).path())!),
    );
    expect(await zip.file("original.md")!.async("string")).toBe(canonical);
    const manifest = JSON.parse(
      await zip.file("export-manifest.json")!.async("string"),
    );
    expect(manifest.sourceHash).toBe(
      createHash("sha256").update(canonical).digest("hex"),
    );
    expect(
      await zip.file(manifest.assets[0].originalPath)!.async("nodebuffer"),
    ).toEqual(figure);
    expect(
      Object.keys(zip.files).some((path) =>
        /^figures\/diagram-\d+\.png$/.test(path),
      ),
    ).toBe(true);
    expect(
      manifest.diagnostics.some((d: any) => d.code === "diagram-unavailable"),
    ).toBe(false);
    await dialog.getByLabel("Bibliography backend").selectOption("bibtex");
    await dialog.getByLabel("Citation style").selectOption("author-year");
    await dialog.getByRole("button", { name: "TeX", exact: true }).click();
    await expect(dialog.getByLabel("Generated LaTeX source")).toContainText(
      "plainnat",
    );
    await f.page.screenshot({
      path: info.outputPath("paper-export-light.png"),
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const snapshot = {
        source: canonical + "\r\nUncommitted local observation.\r\n",
        title: "Frozen local paper",
        generation: 1,
      },
      options = { backend: "bibtex", citations: "author-year" };
    const preview = await call(req, `notes/${f.note.id}/latex-preview`, {
      snapshot,
      options,
    });
    const job = await call(
      req,
      "exports",
      mutation({
        spaceId: resource.space_id,
        resourceIds: [f.note.id],
        markdownSnapshot: snapshot,
        latex: {
          options,
          fingerprint: preview.fingerprint,
          acknowledgeWarnings: true,
        },
      }),
    );
    const localZip = await waitExport(req, job.id);
    expect(await localZip.file("original.md")!.async("string")).toBe(
      snapshot.source,
    );
    expect(await f.source()).toBe(canonical);
  } finally {
    await f.close();
  }
});
test("reference imports, field-reviewed merges, aliases and immutable task sources retain provenance", async ({
  browser,
}, info) => {
  const f = await fixture(
    browser,
    "# Related evidence\n\nCompare [@alpha] and [@beta].\n",
  );
  try {
    const req = f.member.request,
      resource = await call(req, `resources/${f.note.id}`),
      spaceId = resource.space_id,
      scope = { spaceId };
    const [a, b] = await importReferences(
      req,
      spaceId,
      `@string{venue="Research Letters"}\n@inproceedings(alpha, title={Shared study}, author={Ada Scientist}, year=2026, booktitle=venue, doi={10.1234/fiction}, pages={1--8}, custom={original})\n@inproceedings{beta,title={Shared study},author={Ada Scientist},year={2026},booktitle=venue,doi={10.1234/fiction},pages={2--9},custom={alternate}}`,
    );
    const history = await call(
      req,
      `research/library/items/${a.id}/provenance`,
    );
    expect(history.items[0].kind).toBe("import");
    expect(history.items[0].after_data).not.toHaveProperty("bibtex");
    const sourceEvent = await call(
      req,
      `research/library/items/${a.id}/provenance/${history.items[0].id}`,
    );
    expect(sourceEvent.after_data.bibtex).toContain("@string");
    expect(sourceEvent.after_data.bibtex).toContain("custom={original}");
    const handoff = await call(
      req,
      `research/library/items/${a.id}/research-tasks`,
      mutation({
        referenceEventId: sourceEvent.id,
        title: "Check original evidence",
      }),
    );
    const original = await f.source();
    const input = {
      scope,
      ids: [a.id, b.id],
      targetId: a.id,
      versions: { [a.id]: a.version, [b.id]: b.version },
      draft: {
        title: "Reviewed shared study",
        authors: a.authors,
        year: a.year,
        venue: a.venue,
        doi: a.doi,
        arxiv: a.arxiv,
        url: a.url,
      },
      extraFields: { pages: "2--9" },
    };
    const preview = await call(req, "research/library/merge/preview", input);
    expect(preview.matches[0].reasons.join(" ")).toContain("DOI");
    expect(preview.extraFields.map((field: any) => field.name)).toContain(
      "custom",
    );
    await call(
      req,
      "research/library/merge/apply",
      mutation({ ...input, hash: preview.hash }),
    );
    expect(await f.source()).toBe(original);
    const alias = await call(req, `research/library/items/${b.id}`);
    expect(alias.canonical_id).toBe(a.id);
    const events = await call(req, `research/library/items/${a.id}/provenance`);
    expect(events.items.some((e: any) => e.kind === "merge")).toBe(true);
    const before = await call(
      req,
      `research/library/items/${a.id}/provenance/${sourceEvent.id}`,
    );
    expect(before.after_data.title).toBe("Shared study");
    const exported = await call(req, `notes/${f.note.id}/latex-preview`, {
      snapshot: { source: original, title: "Aliases", generation: 1 },
      options: {},
    });
    expect(exported.citationMap.beta).toBe("alpha");
    expect(exported.files["references.bib"]).toContain("2--9");
    const links = await call(req, `tasks/${handoff.taskId}/research-links`);
    expect(links[0].reference_event_id).toBe(sourceEvent.id);
    await f.page.goto(`/workbench/workspaces/${spaceId}/research?tab=library`);
    await f.page
      .getByRole("button", { name: "Reviewed shared study", exact: true })
      .click();
    await f.page.getByRole("button", { name: "History", exact: true }).click();
    await expect(
      f.page.getByRole("region", { name: "Reference provenance" }),
    ).toContainText("Merge");
    await f.page.screenshot({
      path: info.outputPath("reference-history.png"),
      animations: "disabled",
    });
    await f.page
      .getByRole("button", { name: "Follow-up task", exact: true })
      .first()
      .click();
    const handoffDialog = f.page.getByRole("dialog", {
      name: "Research follow-up",
      exact: true,
    });
    await handoffDialog
      .getByLabel("Task title", { exact: true })
      .fill("Inspect merged sources");
    await handoffDialog
      .getByRole("button", { name: "Link source", exact: true })
      .click();
    await expect(handoffDialog).not.toBeVisible();
    let current = await call(req, `research/library/items/${a.id}`);
    for (let i = 0; i < 22; i++)
      current = await call(
        req,
        `research/library/items/${a.id}`,
        mutation({
          scope,
          version: current.version,
          draft: {
            title: current.title,
            authors: current.authors,
            year: current.year,
            url: current.url,
            doi: current.doi,
            arxiv: current.arxiv,
            venue: current.venue,
            tags: [`review-${i}`],
          },
          ...(i === 0 ? { lookupIdentifier: "10.1234/fiction" } : {}),
        }),
        "PATCH",
      );
    const firstPage = await call(
      req,
      `research/library/items/${a.id}/provenance`,
    );
    expect(firstPage.items).toHaveLength(20);
    expect(firstPage.nextCursor).toBeTruthy();
    const older = await call(
      req,
      `research/library/items/${a.id}/provenance?cursor=${firstPage.nextCursor}`,
    );
    expect(older.items.some((event: any) => event.kind === "lookup")).toBe(
      true,
    );
    expect(older.items.some((event: any) => event.id === sourceEvent.id)).toBe(
      true,
    );
    await call(
      req,
      "research/library/batch",
      mutation({
        scope,
        ids: [a.id],
        versions: { [a.id]: current.version },
        operation: "trash",
      }),
    );
    const unavailable = await call(
      req,
      `tasks/${handoff.taskId}/research-links`,
    );
    expect(unavailable[0].available).toBe(false);
    expect(unavailable[0].reference_id).toBeNull();
    await call(
      req,
      `tasks/${handoff.taskId}/research-links/${links[0].id}`,
      mutation({}),
      "DELETE",
    );
    expect(await call(req, `tasks/${handoff.taskId}/research-links`)).toEqual(
      [],
    );
  } finally {
    await f.close();
  }
});
test("paper export controls retain scroll ownership, footer access and keyboard behavior at large text and forced colors", async ({
  browser,
}, info) => {
  const f = await fixture(
    browser,
    "# Presentation acceptance\n\nUnchanged text.\n",
  );
  try {
    const prefs = await call(f.member.request, "me/preferences-bundle");
    await call(
      f.member.request,
      "me/preferences-bundle",
      mutation({
        appearance: {
          version: prefs.appearance.version,
          preferences: {
            ...prefs.appearance.preferences,
            interfaceStyle: "folio",
            uiSize: 22,
            mode: "dark",
            radius: 0,
            shadows: "none",
            motion: "reduced",
          },
        },
        editor: prefs.editor,
      }),
      "PATCH",
    );
    await f.page.setViewportSize({ width: 1280, height: 900 });
    await f.page.reload();
    await f.page
      .getByRole("button", { name: "Export document", exact: true })
      .click();
    const dialog = f.page.getByRole("dialog", {
      name: "Export document",
      exact: true,
    });
    await dialog.getByLabel("Format", { exact: true }).selectOption("latex");
    await expect(dialog.getByLabel("Generated LaTeX source")).toContainText(
      "\\documentclass",
    );
    await expect(
      dialog.getByRole("button", { name: "Prepare project", exact: true }),
    ).toBeInViewport();
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    const settings = dialog.locator(".document-export-settings");
    await settings.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(dialog.getByLabel("Add table of contents")).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "Close", exact: true }),
    ).toBeInViewport();
    await f.page.screenshot({
      path: info.outputPath("paper-export-dark-large.png"),
      animations: "disabled",
    });
    await f.page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await dialog.getByLabel("Add table of contents").focus();
    await f.page.keyboard.press("Space");
    await expect(dialog.getByLabel("Add table of contents")).toBeChecked();
    await f.page.screenshot({
      path: info.outputPath("paper-export-forced-colors.png"),
      animations: "disabled",
    });
    await f.page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect(await f.source()).toBe(
      "# Presentation acceptance\n\nUnchanged text.\n",
    );
  } finally {
    await f.close();
  }
});
test("paper reviews freeze bibliography and milestone handoffs reject stale source/task versions", async ({
  browser,
}, info) => {
  const f = await fixture(
    browser,
    "# Paper review\n\nEvidence [@einstein1905].\n",
  );
  try {
    const req = f.member.request,
      resource = await call(req, `resources/${f.note.id}`),
      [reference] = await importReferences(req, resource.space_id);
    const current = await call(req, `resources/${f.note.id}/history/current`);
    const stale = await req.post(`/api/v1/resources/${f.note.id}/history`, {
      headers: { origin },
      data: mutation({
        label: "Stale checkpoint",
        expectedHash: "0".repeat(64),
      }),
    });
    expect(stale.status()).toBe(409);
    const milestone = await call(
      req,
      `resources/${f.note.id}/history`,
      mutation({ label: "Reviewed paper", expectedHash: current.hash }),
    );
    const history = await call(req, `resources/${f.note.id}/history`),
      saved = history.items.find((r: any) => r.label === "Reviewed paper");
    expect(milestone).toBeTruthy();
    const revision = saved.id;
    const me = await call(req, "me"),
      preview = await call(req, `resources/${f.note.id}/paper-review-preview`, {
        reference: revision,
      });
    const review = await call(
      req,
      `resources/${f.note.id}/review-requests`,
      mutation({
        reference: revision,
        reviewerId: me.user.id,
        paperFingerprint: preview.fingerprint,
        message: "Check frozen bibliography",
      }),
    );
    expect(review.paper_context).not.toHaveProperty("references");
    const handoff = await call(
      req,
      `resources/${f.note.id}/research-tasks`,
      mutation({
        snapshotId: revision.split(":")[1],
        title: "Check manuscript milestone",
      }),
    );
    const badLink = await req.post(
      `/api/v1/resources/${f.note.id}/research-tasks`,
      {
        headers: { origin },
        data: mutation({
          snapshotId: revision.split(":")[1],
          taskId: handoff.taskId,
          taskVersion: 999,
        }),
      },
    );
    expect(badLink.status()).toBe(409);
    const updatedDraft = {
      title: "Newer library title",
      authors: reference.authors,
      year: reference.year,
      doi: reference.doi,
      arxiv: reference.arxiv,
      url: reference.url,
      venue: reference.venue,
      tags: reference.tags,
    };
    await call(
      req,
      `research/library/items/${reference.id}`,
      mutation({
        scope: { spaceId: resource.space_id },
        version: reference.version,
        draft: updatedDraft,
      }),
      "PATCH",
    );
    const drift = await req.post(
      `/api/v1/resources/${f.note.id}/review-requests`,
      {
        headers: { origin },
        data: mutation({
          reference: revision,
          reviewerId: me.user.id,
          paperFingerprint: preview.fingerprint,
        }),
      },
    );
    expect(drift.status()).toBe(409);
    const frozen = await call(req, `reviews/${review.id}/paper-context`);
    expect(frozen.references[0].title).toBe(reference.title);
    const inbox = await call(req, "reviews/inbox");
    expect(
      inbox.requests.find((r: any) => r.id === review.id).paper_context,
    ).not.toHaveProperty("references");
    const dashboard = await call(req, "dashboard");
    expect(JSON.stringify(dashboard)).not.toContain("paper_context");
    await f.page
      .getByRole("link", { name: "Review inbox", exact: true })
      .click();
    await f.page.locator(".paper-review-context summary").click();
    await expect(f.page.locator(".paper-review-context")).toContainText(
      reference.title,
    );
    await f.page.screenshot({
      path: info.outputPath("frozen-paper-review.png"),
      animations: "disabled",
    });
    expect(await f.source()).toBe(
      "# Paper review\n\nEvidence [@einstein1905].\n",
    );
  } finally {
    await f.close();
  }
});
test("dependency changes invalidate export review and revoked access blocks ready downloads", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "# Permission boundary\n\n[@einstein1905]\n",
  );
  try {
    const req = f.member.request,
      resource = await call(req, `resources/${f.note.id}`),
      [ref] = await importReferences(req, resource.space_id),
      snapshot = {
        source: await f.source(),
        title: "Permission boundary",
        generation: 1,
      };
    const preview = await call(req, `notes/${f.note.id}/latex-preview`, {
      snapshot,
      options: {},
    });
    await call(
      req,
      `research/library/items/${ref.id}`,
      mutation({
        scope: { spaceId: resource.space_id },
        version: ref.version,
        draft: {
          title: "Changed dependency",
          authors: ref.authors,
          year: ref.year,
          url: ref.url,
          doi: ref.doi,
          arxiv: ref.arxiv,
          venue: ref.venue,
          tags: ref.tags,
        },
      }),
      "PATCH",
    );
    const stale = await req.post("/api/v1/exports", {
      headers: { origin },
      data: mutation({
        spaceId: resource.space_id,
        resourceIds: [f.note.id],
        markdownSnapshot: snapshot,
        latex: { options: {}, fingerprint: preview.fingerprint },
      }),
    });
    expect(stale.status()).toBe(409);
    const fresh = await call(req, `notes/${f.note.id}/latex-preview`, {
      snapshot,
      options: {},
    });
    const me = await call(req, "me");
    await call(
      f.owner.request,
      `members/${me.user.id}?groupId=${f.group.id}`,
      { contentRole: "viewer" },
      "PATCH",
    );
    const job = await call(
      req,
      "exports",
      mutation({
        spaceId: resource.space_id,
        resourceIds: [f.note.id],
        markdownSnapshot: snapshot,
        latex: {
          options: {},
          fingerprint: fresh.fingerprint,
          acknowledgeWarnings: true,
        },
      }),
    );
    await waitExport(req, job.id);
    await call(
      f.owner.request,
      `members/${me.user.id}?groupId=${f.group.id}`,
      undefined,
      "DELETE",
    );
    const denied = await req.get(`/api/v1/exports/${job.id}/download`);
    expect([403, 404]).toContain(denied.status());
  } finally {
    await f.close();
  }
});
