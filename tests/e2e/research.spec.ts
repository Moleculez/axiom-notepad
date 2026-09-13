import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInOwner } from "./auth";
import { defaults, paletteFor } from "../../packages/shared/src/appearance";
const origin =
  process.env.TEST_APP_URL || process.env.APP_URL || "http://localhost:8080";
let ownerState: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;
async function api(
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) {
  const response = await request.fetch("/api/v1/" + path, {
    method,
    data,
    headers: { origin, "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function lab(browser: Browser) {
  const owner = await browser.newContext({
      baseURL: origin,
      storageState: ownerState,
    }),
    member = await browser.newContext({ baseURL: origin });
  if (!ownerState) {
    const signedIn = await signInOwner(owner.request, origin);
    expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
    ownerState = await owner.storageState();
  }
  const group = await api(owner.request, "groups", {
      name: "Reading verification " + randomUUID().slice(0, 8),
    }),
    invite = await api(owner.request, "invitations", {
      groupId: group.id,
      email: `reading-${randomUUID()}@axiom.test`,
    });
  const user = await api(member.request, "register", {
    token: new URL(invite.link).searchParams.get("invite"),
    name: "Reading Researcher",
    password: "AxiomReadingPassword2026!",
  });
  const note = await api(member.request, "notes", {
    groupId: group.id,
    title: "Research reading fixture",
    body: "# Research\n\nCanonical Markdown with $E=mc^2$.\n\n## Target section\n\nDetails worth preserving.\n",
  });
  return { owner, member, group, userId: user.user.id, note };
}
async function open(context: BrowserContext, id: string) {
  const page = await context.newPage();
  await page.goto("/?note=" + id);
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(
    page.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  return page;
}
async function slider(page: Page, label: string, value: number) {
  await page
    .getByRole("slider", { name: label, exact: true })
    .evaluate((el, value) => {
      const input = el as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
}
function pdfFixture() {
  const content1 =
      "BT /F1 20 Tf 40 440 Td (Quantum research paper) Tj 0 -40 Td (A selected finding about energy.) Tj ET",
    content2 =
      "BT /F1 18 Tf 40 440 Td (Second page: reproducible results.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Rotate 90 /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content1.length} >>\nstream\n${content1}\nendstream`,
    `<< /Length ${content2.length} >>\nstream\n${content2}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(source));
    source += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = Buffer.byteLength(source);
  source +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(source);
}
async function paper(context: BrowserContext, noteId: string) {
  const response = await context.request.post(
    `/api/v1/notes/${noteId}/attachments`,
    {
      headers: { origin },
      multipart: {
        file: {
          name: "quantum-paper.pdf",
          mimeType: "application/pdf",
          buffer: pdfFixture(),
        },
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const file = await response.json();
  return api(context.request, `attachments/${file.id}/meta`);
}
test("appearance applies without source changes, syncs accounts, and keeps device overrides local", async ({
  browser,
}) => {
  const { owner, member, note } = await lab(browser),
    page = await open(member, note.id);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const before = await page.getByTestId("note-editor").innerText();
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Typography", exact: true }).click();
  await slider(page, "Note font size", 24);
  await slider(page, "Code font size", 18);
  await page
    .getByLabel("Note text font", { exact: true })
    .selectOption("sourceSans");
  await page
    .getByLabel("Source & code font", { exact: true })
    .selectOption("plexMono");
  await page
    .getByRole("button", { name: "Reading & layout", exact: true })
    .click();
  await page.getByLabel("Source line numbers", { exact: true }).check();
  await page
    .getByLabel("Use reading typography in print and HTML export", {
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".research-editor.mode-source")).toHaveCSS(
    "font-size",
    "18px",
  );
  await expect(
    page.locator(".native-source-gutter, .axiom-editor .cm-gutters"),
  ).toBeVisible();
  expect(await page.getByTestId("note-editor").innerText()).toBe(before);
  await expect
    .poll(
      async () =>
        (await api(member.request, "me/preferences")).preferences.proseSize,
    )
    .toBe(24);
  const other = await browser.newContext({
      baseURL: origin,
      storageState: await member.storageState(),
    }),
    second = await open(other, note.id);
  await second.getByRole("button", { name: "Source", exact: true }).click();
  await expect(second.locator(".research-editor.mode-source")).toHaveCSS(
    "font-size",
    "18px",
  );
  await second
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await second.getByRole("button", { name: "Device", exact: true }).click();
  await second.getByLabel("Override uiScale on this device").check();
  await slider(second, "Device uiScale", 1.2);
  await second.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(second.locator("body")).toHaveCSS("font-size", "18px");
  await expect(page.locator("body")).toHaveCSS("font-size", "15px");
  const exported = await member.request.get(
    `/api/v1/notes/${note.id}/export?format=html&appearance=reading`,
  );
  expect(exported.ok(), await exported.text()).toBeTruthy();
  expect(await exported.text()).toContain('font-family:"Source Sans 3"');
  expect(await exported.text()).toContain("data:font/woff2;base64");
  expect((await api(member.request, `notes/${note.id}`)).body).toBe(note.body);
  expect(errors).toEqual([]);
  await Promise.all([owner.close(), member.close(), other.close()]);
});
test("preference API rejects CSS injection and detects concurrent edits", async ({
  browser,
}) => {
  const { owner, member } = await lab(browser);
  const first = await api(
    member.request,
    "me/preferences",
    {
      preferences: { ...defaults, proseSize: 22 },
      version: 0,
      mutationId: randomUUID(),
    },
    "PATCH",
  );
  expect(first.version).toBe(1);
  const conflict = await member.request.patch("/api/v1/me/preferences", {
    headers: { origin },
    data: {
      preferences: { ...defaults, proseSize: 24 },
      version: 0,
      mutationId: randomUUID(),
    },
  });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).current.preferences.proseSize).toBe(22);
  for (const preferences of [
    { ...defaults, uiFont: "url(https://tracker.test)" },
    { ...defaults, lightColors: { text: "#000000;display:none" } },
    { ...defaults, css: "body{display:none}" },
  ])
    expect(
      (
        await member.request.patch("/api/v1/me/preferences", {
          headers: { origin },
          data: { preferences, version: 1, mutationId: randomUUID() },
        })
      ).status(),
    ).toBe(400);
  expect((await owner.request.get("/api/v1/me/preferences")).ok()).toBeTruthy();
  await Promise.all([owner.close(), member.close()]);
});
test("portable custom themes survive reload while cancelled previews do not", async ({
  browser,
}) => {
  const { owner, member, note } = await lab(browser),
    page = await open(member, note.id);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await page.getByText("Visual theme editor", { exact: true }).click();
  const theme = {
    format: "axiom-theme",
    version: 1,
    name: "Observatory",
    mode: "dark",
    colors: { ...paletteFor(defaults, true), paper: "#181f2b" },
  };
  await page.getByLabel("Import theme JSON").setInputFiles({
    name: "observatory.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(theme)),
  });
  await expect(page.locator(".saved-theme")).toContainText("Observatory");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await api(member.request, "me/preferences")).preferences.themes.length,
    )
    .toBe(1);
  await page.reload();
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--paper")
          .trim(),
      ),
    )
    .toBe("#181f2b");
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use Paper theme", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect((await api(member.request, "me/preferences")).preferences.mode).toBe(
    "dark",
  );
  expect(errors).toEqual([]);
  await Promise.all([owner.close(), member.close()]);
});
test("quotation insertion persists a real private annotation and warns before publishing text", async ({
  browser,
}) => {
  const { owner, member, note } = await lab(browser),
    file = await paper(member, note.id),
    page = await open(member, note.id);
  await page
    .getByRole("button", { name: "quantum-paper.pdf", exact: false })
    .click();
  await expect(page.locator(".textLayer")).toContainText(
    "Quantum research paper",
  );
  await page.getByRole("button", { name: "Page note", exact: true }).click();
  await page
    .getByLabel("Annotation note", { exact: true })
    .fill("An observation to discuss.");
  const confirmation = page.waitForEvent("dialog");
  const click = page
    .getByRole("button", { name: "Insert quotation", exact: true })
    .click();
  const dialog = await confirmation;
  expect(dialog.message()).toMatch(/private.*shared/i);
  await dialog.accept();
  await click;
  await expect
    .poll(
      async () =>
        (await api(member.request, `attachments/${file.id}/annotations`))
          .length,
    )
    .toBe(1);
  const annotation = (
    await api(member.request, `attachments/${file.id}/annotations`)
  )[0];
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.getByTestId("note-editor")).toContainText(
    "annotation=" + annotation.id,
  );
  expect(
    await api(owner.request, `attachments/${file.id}/annotations`),
  ).toEqual([]);
  await Promise.all([owner.close(), member.close()]);
});
test("offline appearance conflicts require an explicit choice", async ({
  browser,
}) => {
  const { owner, member, note } = await lab(browser),
    page = await open(member, note.id);
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await expect(page.locator(".settings-sync")).toContainText(
    "Preferences synced",
  );
  await member.setOffline(true);
  await page.getByRole("button", { name: "Typography", exact: true }).click();
  await slider(page, "Note font size", 22);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const remote = await browser.newContext({
    baseURL: origin,
    storageState: await member.storageState(),
  });
  await api(
    remote.request,
    "me/preferences",
    {
      preferences: { ...defaults, proseSize: 24 },
      version: 0,
      mutationId: randomUUID(),
    },
    "PATCH",
  );
  await member.setOffline(false);
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await expect(page.locator(".settings-conflict")).toContainText("proseSize");
  await page
    .getByRole("button", { name: "Use synced values", exact: true })
    .click();
  await page.getByRole("button", { name: "Typography", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Note font size", exact: true }),
  ).toHaveValue("24");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByTestId("note-editor")).toHaveCSS(
    "font-family",
    /Source Sans 3/,
  );
  await Promise.all([owner.close(), member.close(), remote.close()]);
});
test("online papers remain readable when research storage is denied", async ({
  browser,
}) => {
  const { owner, member, note } = await lab(browser);
  await paper(member, note.id);
  const page = await open(member, note.id);
  await page.evaluate(() => {
    const original = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, version) {
      if (name.endsWith(":research-v1"))
        throw new DOMException(
          "Simulated research storage denial",
          "QuotaExceededError",
        );
      return original.call(this, name, version!);
    };
  });
  await page
    .getByRole("button", { name: "quantum-paper.pdf", exact: false })
    .click();
  await expect(page.locator(".textLayer")).toContainText(
    "Quantum research paper",
  );
  await page.getByRole("button", { name: "Keep offline", exact: true }).click();
  await expect(page.locator(".pdf-viewer")).toContainText(
    "Simulated research storage denial",
  );
  await expect(
    page.getByRole("button", { name: "Remove offline copy", exact: true }),
  ).toHaveCount(0);
  await Promise.all([owner.close(), member.close()]);
});
test("reconnecting removes revoked offline papers while retaining unsynced annotations for export", async ({
  browser,
}) => {
  const { owner, member, note, group, userId } = await lab(browser),
    file = await paper(member, note.id),
    page = await open(member, note.id);
  await page
    .getByRole("button", { name: "quantum-paper.pdf", exact: false })
    .click();
  await expect(page.locator(".textLayer")).toContainText(
    "Quantum research paper",
  );
  await page.getByRole("button", { name: "Keep offline", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove offline copy", exact: true }),
  ).toBeVisible();
  await member.setOffline(true);
  await page.getByRole("button", { name: "Page note", exact: true }).click();
  await page
    .getByLabel("Annotation note", { exact: true })
    .fill("Retain my unsynced observation");
  await page
    .getByRole("button", { name: "Save privately", exact: true })
    .click();
  await api(
    owner.request,
    `members/${userId}?groupId=${group.id}`,
    undefined,
    "DELETE",
  );
  await member.setOffline(false);
  await expect(page.locator(".pdf-viewer")).toContainText("Access changed");
  await expect
    .poll(() =>
      page.evaluate(async (user) => {
        return await new Promise<{ papers: number; pending: number }>(
          (resolve, reject) => {
            const request = indexedDB.open(`axiom:${user}:research-v1`, 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result,
                tx = db.transaction("items", "readonly"),
                read = tx.objectStore("items").getAll();
              read.onsuccess = () => {
                const all = read.result;
                resolve({
                  papers: all.filter((r) => r.kind === "pdf").length,
                  pending: all.filter(
                    (r) => r.kind === "annotation" && r.pending,
                  ).length,
                });
              };
              tx.oncomplete = () => db.close();
            };
          },
        );
      }, userId),
    )
    .toEqual({ papers: 0, pending: 1 });
  expect(
    (await member.request.get(`/api/v1/attachments/${file.id}/meta`)).status(),
  ).toBe(404);
  await Promise.all([owner.close(), member.close()]);
});
test("PDF text, search, rotated highlights, private sharing and references work together", async ({
  browser,
}) => {
  const { owner, member, note, group } = await lab(browser),
    file = await paper(member, note.id),
    page = await open(member, note.id);
  await page
    .getByRole("button", { name: "quantum-paper.pdf", exact: false })
    .click();
  await expect(page.locator(".pdf-toolbar")).toContainText("1 / 2");
  await expect(page.locator(".textLayer")).toContainText(
    "Quantum research paper",
  );
  await page.locator(".textLayer").evaluate((el) => {
    const span = [...el.querySelectorAll("span")].find((s) =>
      s.textContent?.includes("selected finding"),
    )!;
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(
    page.getByRole("region", { name: "Annotation editor" }),
  ).toBeVisible();
  await page
    .getByLabel("Annotation note", { exact: true })
    .fill("Check the energy assumption.");
  await page
    .getByRole("button", { name: "Save privately", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await api(member.request, `attachments/${file.id}/annotations`))
          .length,
    )
    .toBe(1);
  expect(
    await api(owner.request, `attachments/${file.id}/annotations`),
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Share with readers", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await api(owner.request, `attachments/${file.id}/annotations`)).length,
    )
    .toBe(1);
  await page
    .getByRole("button", { name: "Close paper panel", exact: true })
    .click();
  await expect(page.locator(".pdf-highlight")).toHaveCount(1);
  await page.getByRole("button", { name: "Rotate PDF clockwise" }).click();
  await expect(page.locator(".pdf-highlight")).toHaveCount(1);
  await page
    .getByLabel("Search PDF text", { exact: true })
    .fill("reproducible");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("button", { name: /Page 2.*reproducible/ }).click();
  await expect(page.locator(".pdf-toolbar")).toContainText("2 / 2");
  await page.getByRole("button", { name: "Bookmark", exact: true }).click();
  await page
    .getByRole("button", { name: "Link this page", exact: true })
    .click();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.getByTestId("note-editor")).toContainText("#page=2");
  const ref = await api(member.request, "references", {
    groupId: group.id,
    citeKey: "quantum2026",
    title: "Quantum paper",
    authors: "A. Researcher",
    year: "2026",
    doi: "10.1000/quantum",
  });
  await api(member.request, `references/${ref.id}/links`, {
    kind: "attachment",
    targetId: file.id,
  });
  const refs = await api(member.request, `references?groupId=${group.id}`);
  expect(refs.find((r: any) => r.id === ref.id).linked_papers[0].id).toBe(
    file.id,
  );
  await expect(page.locator(".paper-page")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await expect(page.locator(".textLayer")).toContainText("Second page");
  await page.screenshot({
    path: "test-results/research-reading-workspace.png",
    fullPage: true,
  });
  await Promise.all([owner.close(), member.close()]);
});
test("annotation revisions, author rights, private files and reading targets are enforced", async ({
  browser,
}) => {
  const { owner, member, group, note } = await lab(browser),
    file = await paper(member, note.id),
    annotation = {
      id: randomUUID(),
      version: 0,
      mutation_id: randomUUID(),
      shared: false,
      data: {
        kind: "highlight",
        page: 1,
        sha256: file.sha256,
        rects: [[0.1, 0.2, 0.3, 0.04]],
        quote: "Private observation",
        body: "Do not share",
        color: "yellow",
      },
    };
  const created = await api(
    member.request,
    `attachments/${file.id}/annotations`,
    annotation,
    "PUT",
  );
  expect(
    (
      await api(
        member.request,
        `attachments/${file.id}/annotations`,
        annotation,
        "PUT",
      )
    ).version,
  ).toBe(created.version);
  expect(
    await api(owner.request, `attachments/${file.id}/annotations`),
  ).toEqual([]);
  expect(
    (
      await owner.request.put(`/api/v1/attachments/${file.id}/annotations`, {
        headers: { origin },
        data: {
          ...annotation,
          version: 1,
          mutation_id: randomUUID(),
          deleted: true,
        },
      })
    ).status(),
  ).toBe(404);
  const shared = await api(
    member.request,
    `attachments/${file.id}/annotations`,
    { ...annotation, version: 1, mutation_id: randomUUID(), shared: true },
    "PUT",
  );
  expect(
    (
      await owner.request.put(`/api/v1/attachments/${file.id}/annotations`, {
        headers: { origin },
        data: {
          ...annotation,
          version: shared.version,
          mutation_id: randomUUID(),
          shared: true,
          data: { ...annotation.data, body: "Rewritten by admin" },
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await member.request.put(`/api/v1/attachments/${file.id}/annotations`, {
        headers: { origin },
        data: { ...annotation, version: 1, mutation_id: randomUUID() },
      })
    ).status(),
  ).toBe(409);
  const privateNote = await api(owner.request, "notes", {
      groupId: group.id,
      title: "Private paper",
      visibility: "private",
    }),
    secret = await paper(owner, privateNote.id);
  expect(
    (
      await member.request.get(`/api/v1/attachments/${secret.id}/meta`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await member.request.get(`/api/v1/attachments/${secret.id}/annotations`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await member.request.put("/api/v1/me/reading", {
        headers: { origin },
        data: {
          id: randomUUID(),
          group_id: group.id,
          kind: "bookmark",
          target_type: "note",
          target_id: privateNote.id,
          data: { label: "should not exist" },
          version: 0,
          mutation_id: randomUUID(),
        },
      })
    ).status(),
  ).toBe(404);
  await api(
    owner.request,
    `members/${(await api(member.request, "me")).user.id}?groupId=${group.id}`,
    undefined,
    "DELETE",
  );
  expect(
    (
      await member.request.get(`/api/v1/attachments/${file.id}/annotations`)
    ).status(),
  ).toBe(404);
  await Promise.all([owner.close(), member.close()]);
});
test("reference editing preserves citation keys and uncommon BibTeX fields", async ({
  browser,
}) => {
  const { owner, member, group, note } = await lab(browser);
  await api(
    member.request,
    `references?groupId=${group.id}`,
    {
      bibtex:
        "@inproceedings{stable2026,title={A {Quantum} result},year={2025},booktitle={Physics Lab},custom={Keep this field}}",
    },
    "PUT",
  );
  const ref = (await api(member.request, `references?groupId=${group.id}`))[0];
  await api(
    member.request,
    `references/${ref.id}`,
    {
      title: ref.title,
      authors: ref.authors,
      year: "2026",
      url: ref.url,
      doi: ref.doi,
      arxiv: ref.arxiv,
      venue: ref.venue,
      version: ref.version,
    },
    "PATCH",
  );
  const bib = await member.request.get(
    `/api/v1/references?groupId=${group.id}&format=bib`,
  );
  expect(await bib.text()).toContain("@inproceedings{stable2026");
  expect(await bib.text()).toContain("custom={Keep this field}");
  expect(await bib.text()).toContain("title={A {Quantum} result}");
  const page = await open(member, note.id);
  await page
    .getByRole("button", { name: "Reference library", exact: true })
    .click();
  await page
    .getByLabel("Reading status for stable2026")
    .selectOption("reading");
  await expect
    .poll(
      async () =>
        (await api(member.request, `me/reading?groupId=${group.id}`)).filter(
          (r: any) => r.kind === "reading",
        ).length,
    )
    .toBe(1);
  await page.getByLabel("Filter reading status").selectOption("read");
  await expect(page.locator(".reference-card")).toHaveCount(0);
  await page.getByLabel("Filter reading status").selectOption("reading");
  await expect(page.locator(".reference-card")).toHaveCount(1);
  page.once("dialog", (dialog) => void dialog.accept("Currently reading"));
  await page
    .getByRole("button", { name: "Save current filter", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Currently reading", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Filter reading status").selectOption("read");
  await page
    .getByRole("button", { name: "Currently reading", exact: true })
    .click();
  await expect(page.locator(".reference-card")).toHaveCount(1);
  await Promise.all([owner.close(), member.close()]);
});
test("saved heading links open the actual section in read and source modes", async ({
  browser,
}) => {
  const { owner, member, note } = await lab(browser),
    page = await open(member, note.id);
  await page.goto(`/?note=${note.id}#target-section`);
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const node = window.getSelection()?.anchorNode;
        return (
          (node instanceof Element ? node : node?.parentElement)?.closest(
            ".native-source-line, .cm-line, h1, h2, h3, h4, h5, h6",
          )?.textContent ?? ""
        );
      }),
    )
    .toContain("Target section");
  await page
    .getByRole("button", { name: "Bookmark this note section" })
    .click();
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Offline files & reading data", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("target-section");
  await Promise.all([owner.close(), member.close()]);
});
test("large typography and settings remain usable at mobile widths", async ({
  browser,
}) => {
  const { owner, member, note } = await lab(browser),
    page = await open(member, note.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Typography", exact: true }).click();
  await slider(page, "Interface font size", 22);
  await slider(page, "Note font size", 30);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.locator(".read-mount:not(.print-only) .prose")).toHaveCSS(
    "font-size",
    "30px",
  );
  await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reset all", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeInViewport();
  await expect
    .poll(() =>
      page.locator(".settings-navigation nav button").evaluateAll((buttons) => {
        const boxes = buttons.map((button) => button.getBoundingClientRect());
        return boxes.slice(1).every((box, i) => box.left >= boxes[i].right);
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/research-mobile-settings.png",
    fullPage: true,
  });
  await Promise.all([owner.close(), member.close()]);
});
test("opt-in PDF and private annotations survive an offline reload and sign-out clears other tabs", async ({
  browser,
  browserName,
}) => {
  test.skip(
    process.env.TEST_PRODUCTION !== "1",
    "Offline shell requires a production build.",
  );
  test.skip(
    browserName === "webkit",
    "This WebKit automation build also fails offline reload on a standalone cached service-worker page. Real Safari offline reload remains unverified; see docs/VERIFICATION.md.",
  );
  const { owner, member, note } = await lab(browser),
    file = await paper(member, note.id),
    page = await open(member, note.id);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await page
    .getByRole("button", { name: "quantum-paper.pdf", exact: false })
    .click();
  await expect(page.locator(".textLayer")).toContainText(
    "Quantum research paper",
  );
  await page.getByRole("button", { name: "Keep offline", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove offline copy", exact: true }),
  ).toBeVisible();
  await member.setOffline(true);
  await page.reload();
  await expect(page.locator(".textLayer")).toContainText(
    "Quantum research paper",
  );
  await page.getByRole("button", { name: "Page note", exact: true }).click();
  await page
    .getByLabel("Annotation note", { exact: true })
    .fill("Offline annotation survives.");
  await page
    .getByRole("button", { name: "Save privately", exact: true })
    .click();
  await expect(page.locator(".annotation-card")).toContainText(
    "Offline annotation survives.",
  );
  await page.reload();
  await expect(page.locator(".textLayer")).toContainText(
    "Quantum research paper",
  );
  await page.getByRole("button", { name: /1 annotations/ }).click();
  await expect(page.locator(".annotation-card")).toContainText(
    "Offline annotation survives.",
  );
  await member.setOffline(false);
  await expect
    .poll(
      async () =>
        (await api(member.request, `attachments/${file.id}/annotations`))
          .length,
    )
    .toBe(1);
  const other = await member.newPage();
  await other.goto(`/?note=${note.id}&paper=${file.id}`);
  await expect(other.locator(".textLayer")).toContainText(
    "Quantum research paper",
  );
  await member.setOffline(true);
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Account & group administration",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    other.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await indexedDB.databases()).filter((d) =>
            d.name?.endsWith(":research-v1"),
          ).length,
      ),
    )
    .toBe(0);
  await Promise.all([owner.close(), member.close()]);
});
