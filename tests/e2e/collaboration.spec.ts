import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signInOwner } from "./auth";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const JSZip = createRequire(import.meta.url)("jszip") as typeof import("jszip");

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
    headers: { origin },
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
    const login = await signInOwner(owner.request, origin);
    expect(login.ok()).toBeTruthy();
    ownerState = await owner.storageState();
  }
  const group = await api(owner.request, "groups", {
    name: "Verification " + randomUUID().slice(0, 8),
  });
  const invitation = await api(owner.request, "invitations", {
    groupId: group.id,
    email: `test-${randomUUID()}@axiom.test`,
  });
  const registered = await api(member.request, "register", {
    token: new URL(invitation.link).searchParams.get("invite"),
    name: "Test Researcher",
    password: "AxiomTestPassword2026!",
  });
  return { owner, member, group, memberId: registered.user.id };
}
async function open(context: BrowserContext, id: string) {
  const page = await context.newPage();
  await page.goto("/?note=" + id);
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(
    page.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Source", exact: true }).click();
  return page;
}

test("invitation-only accounts and note privacy hold across every access path", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser);
  const privateNote = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Private hypothesis",
    visibility: "private",
    body: "secret-hypothesis-7291",
  });
  const upload = await owner.request.post(
    `/api/v1/notes/${privateNote.id}/attachments`,
    {
      headers: { origin },
      multipart: {
        file: {
          name: "private.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("private data"),
        },
      },
    },
  );
  expect(upload.ok()).toBeTruthy();
  const attachment = await upload.json();
  for (const path of [
    `notes/${privateNote.id}`,
    `notes/${privateNote.id}/comments`,
    `notes/${privateNote.id}/history`,
    `attachments/${attachment.id}`,
  ])
    expect((await member.request.get("/api/v1/" + path)).status()).toBe(404);
  expect(
    (
      await member.request.post(`/api/v1/notes/${privateNote.id}/sync-token`, {
        headers: { origin },
      })
    ).status(),
  ).toBe(404);
  const workspace = await api(member.request, `workspace?groupId=${group.id}`);
  expect(workspace.notes).toHaveLength(0);
  expect(
    await api(member.request, `search?groupId=${group.id}&q=secret-hypothesis`),
  ).toEqual([]);
  expect(
    (
      await member.request.post("/api/v1/invitations", {
        headers: { origin },
        data: { groupId: group.id, email: "outsider@axiom.test" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await member.request.post("/api/auth/sign-up/email", {
        headers: { origin },
        data: {
          email: "no-invite@axiom.test",
          password: "AxiomTestPassword2026!",
          name: "No invitation",
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await owner.request.post("/api/v1/groups", {
        headers: { origin: "https://attacker.example" },
        data: { name: "Forbidden" },
      })
    ).status(),
  ).toBe(403);
  const outsider = await browser.newContext({ baseURL: origin });
  expect(
    (await outsider.request.get(`/api/v1/notes/${privateNote.id}`)).status(),
  ).toBe(401);
  await Promise.all([owner.close(), member.close(), outsider.close()]);
});

test("two editors converge, preserve offline edits, and revoke active membership", async ({
  browser,
}) => {
  const { owner, member, group, memberId } = await lab(browser);
  const note = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Concurrent derivation",
    body: "# Shared derivation\n\nInitial result.\n",
  });
  const [a, b] = await Promise.all([
    open(owner, note.id),
    open(member, note.id),
  ]);
  await Promise.all([
    a.getByTestId("note-editor").press("ControlOrMeta+End"),
    b.getByTestId("note-editor").press("ControlOrMeta+End"),
  ]);
  await Promise.all([
    a.keyboard.insertText("\nALICE-RESULT\n"),
    b.keyboard.insertText("\nBOB-RESULT\n"),
  ]);
  for (const page of [a, b]) {
    await expect(page.getByTestId("note-editor")).toContainText("ALICE-RESULT");
    await expect(page.getByTestId("note-editor")).toContainText("BOB-RESULT");
  }
  await member.setOffline(true);
  await b.getByTestId("note-editor").press("ControlOrMeta+End");
  await b.keyboard.insertText("\nOFFLINE-RESULT\n");
  await a.getByTestId("note-editor").press("ControlOrMeta+End");
  await a.keyboard.insertText("\nONLINE-RESULT\n");
  await member.setOffline(false);
  for (const page of [a, b]) {
    await expect(page.getByTestId("note-editor")).toContainText(
      "OFFLINE-RESULT",
    );
    await expect(page.getByTestId("note-editor")).toContainText(
      "ONLINE-RESULT",
    );
    await expect(
      page.getByText("Saved on server", { exact: true }),
    ).toBeVisible();
  }
  const saved = await api(owner.request, `notes/${note.id}`);
  expect(saved.body).toContain("OFFLINE-RESULT");
  await a.reload();
  await expect(a.getByTestId("note-editor")).toContainText("OFFLINE-RESULT");
  await api(
    owner.request,
    `members/${memberId}?groupId=${group.id}`,
    undefined,
    "DELETE",
  );
  await b.getByTestId("note-editor").press("ControlOrMeta+End");
  await b.keyboard.insertText("\nREVOKED-EDIT\n");
  await expect(
    b.getByText(/access unavailable|Access changed/).first(),
  ).toBeVisible();
  expect((await member.request.get(`/api/v1/notes/${note.id}`)).status()).toBe(
    404,
  );
  expect((await api(owner.request, `notes/${note.id}`)).body).not.toContain(
    "REVOKED-EDIT",
  );
  await Promise.all([owner.close(), member.close()]);
});

test("ten CRDT clients converge and local undo does not erase another author", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser);
  const note = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Ten-editor experiment",
    body: "Initial\n",
  });
  const token = await api(owner.request, `notes/${note.id}/sync-token`, {});
  const docs = Array.from({ length: 10 }, () => new Y.Doc()),
    providers: HocuspocusProvider[] = [];
  try {
    await Promise.all(
      docs.map(
        (doc) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Sync handshake timeout")),
              10000,
            );
            providers.push(
              new HocuspocusProvider({
                url: process.env.NEXT_PUBLIC_SYNC_URL || "ws://localhost:1234",
                name: token.room,
                token: token.token,
                document: doc,
                onSynced: () => {
                  clearTimeout(timer);
                  resolve();
                },
                onAuthenticationFailed: (e) => {
                  clearTimeout(timer);
                  reject(new Error(e.reason));
                },
              }),
            );
          }),
      ),
    );
    const undo = new Y.UndoManager(docs[0].getText("markdown"));
    docs.forEach((doc, i) =>
      doc.getText("markdown").insert(0, `AUTHOR-${i}\n`),
    );
    await expect
      .poll(
        () => new Set(docs.map((d) => d.getText("markdown").toString())).size,
      )
      .toBe(1);
    for (let i = 0; i < 10; i++)
      expect(docs[0].getText("markdown").toString()).toContain(`AUTHOR-${i}`);
    undo.undo();
    await expect
      .poll(() => docs[9].getText("markdown").toString())
      .not.toContain("AUTHOR-0");
    for (let i = 1; i < 10; i++)
      expect(docs[9].getText("markdown").toString()).toContain(`AUTHOR-${i}`);
    const confirmed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Save acknowledgement timeout")),
        10000,
      );
      providers[0].on("stateless", ({ payload }: { payload: string }) => {
        const message = JSON.parse(payload);
        if (message.type === "persisted" && message.id === "test-save") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    providers[0].sendStateless(
      JSON.stringify({ type: "save-check", id: "test-save" }),
    );
    await confirmed;
    expect((await api(owner.request, `notes/${note.id}`)).body).toBe(
      docs[0].getText("markdown").toString(),
    );
    undo.destroy();
  } finally {
    providers.forEach((p) => p.destroy());
    docs.forEach((d) => d.destroy());
    await Promise.all([owner.close(), member.close()]);
  }
});

test("snapshots restore into a new generation and trash can be recovered", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser);
  const note = await api(owner.request, "notes", {
    groupId: group.id,
    title: "History test",
    body: "Original theorem.",
  });
  const page = await open(owner, note.id),
    checkpoint = await api(owner.request, `notes/${note.id}/history`, {
      label: "Accepted theorem",
    });
  await page.getByTestId("note-editor").press("ControlOrMeta+End");
  await page.keyboard.insertText("\nLater revision.");
  await expect(
    page.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  await api(owner.request, `notes/${note.id}/restore-version`, {
    snapshotId: checkpoint.id,
  });
  const restored = await api(owner.request, `notes/${note.id}`);
  expect(restored.generation).toBe(2);
  expect(restored.body).toBe("Original theorem.");
  const history = await api(owner.request, `notes/${note.id}/history`);
  expect(history.some((v: any) => v.label === "Before restore")).toBeTruthy();
  await api(
    owner.request,
    `notes/${note.id}`,
    { title: "Renamed theorem", version: restored.version },
    "PATCH",
  );
  expect(
    (
      await owner.request.patch(`/api/v1/notes/${note.id}`, {
        headers: { origin },
        data: { title: "Stale rename", version: restored.version },
      })
    ).status(),
  ).toBe(409);
  await page.close();
  await api(owner.request, `notes/${note.id}`, undefined, "DELETE");
  expect((await owner.request.get(`/api/v1/notes/${note.id}`)).status()).toBe(
    404,
  );
  await api(owner.request, `notes/${note.id}/restore-trash`, {});
  expect((await api(owner.request, `notes/${note.id}`)).body).toBe(
    "Original theorem.",
  );
  await Promise.all([owner.close(), member.close()]);
});

test("Markdown archive round-trip preserves attachments, projects, hierarchy, and citations", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser);
  const zip = new JSZip();
  zip.file(
    "notes/claim.md",
    "# Claim\n\n[Proof](proof.md) and [paper](../attachments/paper.pdf#page=2). [@paper2026]\n",
  );
  zip.file("notes/proof.md", "> [!PROOF]\n> A complete argument.\n");
  zip.file("attachments/paper.pdf", "%PDF-1.7\nroundtrip attachment");
  zip.file(
    "references.bib",
    "@article{paper2026,title={The original paper},author={A. Author},year={2026}}",
  );
  zip.file(
    "manifest.json",
    JSON.stringify({
      format: "axiom-notebook",
      version: 1,
      projects: [{ id: "p", name: "Imported mathematics" }],
      notes: [
        {
          id: "a",
          file: "notes/claim.md",
          title: "Imported claim",
          projectId: "p",
          tags: ["theory"],
        },
        {
          id: "b",
          file: "notes/proof.md",
          title: "Imported proof",
          projectId: "p",
          parentId: "a",
        },
      ],
    }),
  );
  const file = {
    name: "notebook.zip",
    mimeType: "application/zip",
    buffer: await zip.generateAsync({ type: "nodebuffer" }),
  };
  const preview = await owner.request.post(
    `/api/v1/import?groupId=${group.id}&preview=true`,
    { headers: { origin }, multipart: { file } },
  );
  expect(preview.ok(), await preview.text()).toBeTruthy();
  expect((await preview.json()).attachments).toBe(1);
  expect(
    (await api(owner.request, `workspace?groupId=${group.id}`)).notes,
  ).toHaveLength(0);
  const imported = await owner.request.post(
    `/api/v1/import?groupId=${group.id}`,
    { headers: { origin }, multipart: { file } },
  );
  expect(imported.ok(), await imported.text()).toBeTruthy();
  const workspace = await api(owner.request, `workspace?groupId=${group.id}`),
    claim = workspace.notes.find((n: any) => n.title === "Imported claim"),
    proof = workspace.notes.find((n: any) => n.title === "Imported proof");
  expect(proof.parent_id).toBe(claim.id);
  expect(claim.tags).toEqual(["theory"]);
  expect(workspace.references).toHaveLength(1);
  expect(workspace.projects).toHaveLength(1);
  expect((await api(owner.request, `notes/${claim.id}`)).body).toContain(
    `[[${proof.id}|Proof]]`,
  );
  const attachments = await api(owner.request, `notes/${claim.id}/attachments`);
  expect(
    (
      await owner.request.get(`/api/v1/attachments/${attachments[0].id}`)
    ).headers()["content-type"],
  ).toBe("application/pdf");
  const exported = await owner.request.get(
    `/api/v1/export?groupId=${group.id}`,
  );
  expect(exported.ok(), await exported.text()).toBeTruthy();
  const archive = await JSZip.loadAsync(await exported.body()),
    manifest = JSON.parse(await archive.file("manifest.json")!.async("string"));
  expect(manifest.attachments).toHaveLength(1);
  expect(manifest.projects).toHaveLength(1);
  expect(await archive.file(`notes/${claim.id}.md`)!.async("string")).toContain(
    proof.id + ".md",
  );
  const again = await owner.request.post(`/api/v1/import?groupId=${group.id}`, {
    headers: { origin },
    multipart: { file: { ...file, buffer: await exported.body() } },
  });
  expect(again.ok(), await again.text()).toBeTruthy();
  expect(
    (await api(owner.request, `workspace?groupId=${group.id}`)).notes,
  ).toHaveLength(4);
  await Promise.all([owner.close(), member.close()]);
});

test("visual math, callouts, table-cell editing, comments and theme work in the browser", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser),
    errors: string[] = [];
  const original =
    "## Results\n\nAn **important** relation: $E=mc^2$.\n\n$$\nE=mc^2\\label{energy}\n$$\n\n| Variable | Value |\n| --- | --- |\n| rate | 1 |\n\n> [!THEOREM] Stability\n> The energy is conserved.\n";
  const note = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Visual research editor",
    body: original,
  });
  const page = await open(owner, note.id);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    page.locator('.research-editor [data-math-state="ready"] svg').first(),
  ).toBeVisible();
  const candidate = await page
    .locator('.axiom-editor[data-engine="milkdown"]')
    .count();
  if (candidate)
    await expect(
      page.locator('.axiom-callout[aria-label="Stability"]'),
    ).toBeVisible();
  else
    await expect(
      page.locator(".research-editor .callout-title > span"),
    ).toHaveText("Stability");
  await page.locator(".research-editor td").filter({ hasText: /^1$/ }).click();
  if (candidate) {
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("2");
  } else
    await page
      .locator('.native-table-block [data-active-cell="true"]')
      .fill("2");
  await expect
    .poll(async () => (await api(owner.request, `notes/${note.id}`)).body)
    .toBe(original.replace("| rate | 1 |", "| rate | 2 |"));
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await expect(page.getByTestId("note-editor")).toContainText("**important**");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(
    page.locator(".read-mount:not(.print-only) .equation-number"),
  ).toHaveText("(1)");
  const comment = await api(member.request, `notes/${note.id}/comments`, {
    body: "Can we state the boundary conditions?",
  });
  await page.getByRole("tab", { name: "Comments", exact: true }).click();
  await expect(
    page.getByText("Can we state the boundary conditions?", { exact: true }),
  ).toBeVisible();
  await api(
    owner.request,
    `comments/${comment.id}`,
    { resolved: true },
    "PATCH",
  );
  if (await page.getByRole("button", { name: "Use dark theme" }).isVisible())
    await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "test-results/research-dark.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await Promise.all([owner.close(), member.close()]);
});

test("PDF attachments render in the protected paper reader", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser);
  const note = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Paper reading",
    body: "A paper to discuss.",
  });
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const content = "BT /F1 20 Tf 40 440 Td (Axiom paper reader) Tj ET";
  objects.push(
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  );
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const upload = await owner.request.post(
    `/api/v1/notes/${note.id}/attachments`,
    {
      headers: { origin },
      multipart: {
        file: {
          name: "research-paper.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(pdf),
        },
      },
    },
  );
  expect(upload.ok()).toBeTruthy();
  const page = await open(owner, note.id);
  await page
    .getByRole("button", { name: "research-paper.pdf", exact: false })
    .click();
  await expect(page.locator(".pdf-toolbar")).toContainText("1 / 1");
  await expect
    .poll(() =>
      page
        .locator(".pdf-canvas canvas")
        .evaluate((canvas: HTMLCanvasElement) => canvas.width),
    )
    .toBeGreaterThan(400);
  await page.getByRole("button", { name: "Link this page" }).click();
  await expect(page.getByTestId("note-editor")).toContainText("#page=1");
  await Promise.all([owner.close(), member.close()]);
});

test("cached notes survive an offline production reload and resynchronize", async ({
  browser,
}) => {
  test.skip(
    process.env.TEST_PRODUCTION !== "1",
    "Service workers are intentionally disabled in development.",
  );
  const { owner, member, group } = await lab(browser);
  const note = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Offline notebook",
    body: "# Offline work\n\nInitial state.\n",
  });
  const page = await open(owner, note.id);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await owner.setOffline(true);
  await page.getByTestId("note-editor").press("ControlOrMeta+End");
  await page.keyboard.insertText("\nDurable offline observation.\n");
  await expect(
    page.getByText("Saved locally · offline", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("note-editor")).toContainText(
    "Durable offline observation.",
  );
  await page.getByRole("button", { name: "Source", exact: true }).click();
  await page.getByTestId("note-editor").press("ControlOrMeta+End");
  await page.keyboard.insertText("\n\n$x^2$ offline calculation.\n");
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(
    page.locator('.read-mount:not(.print-only) [data-math-state="ready"] svg'),
  ).toBeVisible();
  await owner.setOffline(false);
  await expect(
    page.getByText("Saved on server", { exact: true }),
  ).toBeVisible();
  expect((await api(owner.request, `notes/${note.id}`)).body).toContain(
    "Durable offline observation.",
  );
  expect(errors).toEqual([]);
  await Promise.all([owner.close(), member.close()]);
});

test("templates, link completion, graph navigation, and mobile layout are usable", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser);
  const related = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Related theorem",
    body: "## Lemma\n\nA supporting result.\n",
  });
  const page = await open(owner, related.id);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page
    .getByRole("button", { name: "Mathematical derivation", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Note title", { exact: true })
    .fill("Derived result");
  await page.getByRole("button", { name: "Create note", exact: true }).click();
  await expect(page.getByTestId("note-editor")).toContainText(
    "Definitions and assumptions",
  );
  const id = new URL(page.url()).searchParams.get("note")!;
  await page.getByTestId("note-editor").press("ControlOrMeta+End");
  await page.keyboard.insertText("\n[[Related");
  await page.getByRole("option").filter({ hasText: "Related theorem" }).click();
  await expect(page.getByTestId("note-editor")).toContainText(
    `[[${related.id}|Related theorem]]`,
  );
  await expect
    .poll(async () => (await api(owner.request, `notes/${id}`)).body)
    .toContain(related.id);
  await page
    .getByRole("button", { name: "Knowledge graph", exact: true })
    .click();
  await expect(page.locator(".graph-edge")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Open Related theorem", exact: true })
    .press("Enter");
  await expect(page.getByTestId("note-editor")).toContainText(
    "A supporting result.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(page.locator(".context-panel")).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/mobile-note.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await page
    .getByRole("button", { name: "Knowledge graph", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Knowledge graph" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/mobile-graph.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await Promise.all([owner.close(), member.close()]);
});

test("HTML export includes offline SVG math, authorized images and safe markup", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser);
  const imageNote = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Figure storage",
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const uploaded = await owner.request.post(
    `/api/v1/notes/${imageNote.id}/attachments`,
    {
      headers: { origin },
      multipart: {
        file: { name: "figure.png", mimeType: "image/png", buffer: png },
      },
    },
  );
  expect(uploaded.ok()).toBeTruthy();
  const attachment = await uploaded.json();
  const note = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Export <research>",
    body: `## Energy\n\n$$\nE=mc^2\\label{energy}\n$$\n\n![Figure](/api/v1/attachments/${attachment.id})\n\n<script>alert(1)</script>\n`,
  });
  const response = await owner.request.get(
    `/api/v1/notes/${note.id}/export?format=html`,
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.headers()["cache-control"]).toBe("no-store");
  const html = await response.text();
  expect(html).toContain("Export &lt;research&gt;");
  expect(html).toContain("<svg");
  expect(html).toContain("<math");
  expect(html).not.toContain("data-math-request");
  expect(html).not.toContain("url(fonts/");
  expect(html).toContain(`data:image/png;base64,${png.toString("base64")}`);
  expect(html).not.toContain("<script>");
  const page = await owner.newPage();
  await page.setContent(html);
  await expect(page.locator('[data-math-state="ready"] svg')).toBeVisible();
  await expect(page.locator(".equation-number")).toHaveText("(1)");
  await expect
    .poll(() =>
      page.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1);
  await Promise.all([owner.close(), member.close()]);
});

test("device-storage failure is visible without losing the editable in-memory copy", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser);
  const note = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Device quota failure",
    body: "Local recovery\n",
  });
  const page = await open(member, note.id);
  await member.setOffline(true);
  await page.evaluate(() => {
    IDBObjectStore.prototype.add = function () {
      throw new DOMException(
        "Simulated quota exhaustion",
        "QuotaExceededError",
      );
    };
  });
  await page.getByTestId("note-editor").press("ControlOrMeta+End");
  await page.keyboard.insertText("Retained in memory.");
  await expect(
    page.getByText("Device storage unavailable · export your edits", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("note-editor")).toContainText(
    "Retained in memory.",
  );
  await member.setOffline(false);
  await expect(
    page.getByText("Saved on server · device storage unavailable", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await api(owner.request, `notes/${note.id}`)).body).toContain(
    "Retained in memory.",
  );
  await Promise.all([owner.close(), member.close()]);
});

test("offline sign-out clears this account in every tab and revokes the session on reconnect", async ({
  browser,
}) => {
  test.skip(
    process.env.TEST_PRODUCTION !== "1",
    "Offline shell requires a production build.",
  );
  const { owner, member, group } = await lab(browser);
  const note = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Local sign-out",
    body: "Do not resurrect this session.\n",
  });
  const page = await open(member, note.id);
  const other = await open(member, note.id);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await member.setOffline(true);
  await page
    .getByRole("button", { name: "Settings & members", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await expect(
    other.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  await member.setOffline(false);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("axiom:pending-signout")),
    )
    .toBeNull();
  expect((await member.request.get("/api/v1/me")).status()).toBe(401);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter(
        (key) =>
          key.startsWith("axiom:note:") || key.startsWith("axiom:workspace:"),
      ),
    ),
  ).toEqual([]);
  await Promise.all([owner.close(), member.close()]);
});

test("concurrent hierarchy changes cannot create a cycle", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser);
  const a = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Node A",
  });
  const b = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Node B",
  });
  const results = await Promise.all(
    [
      [a, b],
      [b, a],
    ].map(([child, parent]) =>
      owner.request.patch(`/api/v1/notes/${child.id}`, {
        headers: { origin },
        data: { parentId: parent.id, version: child.version },
      }),
    ),
  );
  expect(results.map((r) => r.status()).sort()).toEqual([200, 400]);
  await Promise.all([owner.close(), member.close()]);
});

test("research diagrams render and discussion anchors track edits", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser);
  const note = await api(owner.request, "notes", {
    groupId: group.id,
    title: "Method and assumptions",
    body: "Boundary conditions matter.\n\n```mermaid\nflowchart LR\nA[Question] --> B[Experiment]\nB --> C[Evidence]\n```\n",
  });
  const page = await open(owner, note.id);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByTestId("note-editor").press("ControlOrMeta+Home");
  await page.getByTestId("note-editor").press("Shift+End");
  // Commenting remains available when the optional formatting bar is hidden.
  await page.keyboard.press("ControlOrMeta+Alt+Shift+m");
  await expect(page.locator(".comment-selection")).toContainText(
    "Boundary conditions matter.",
  );
  await page
    .getByLabel("Write a comment")
    .fill("State the assumptions explicitly.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(page.locator(".comment-thread")).toContainText(
    "State the assumptions explicitly.",
  );
  const comment = (await api(owner.request, `notes/${note.id}/comments`))[0];
  expect(comment.anchor.quote).toBe("Boundary conditions matter.");
  await page.getByTestId("note-editor").press("ControlOrMeta+Home");
  await page.keyboard.insertText("New context.\n\n");
  await page.locator(".comment-quote").click();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("Boundary conditions matter.");
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    page.locator(".research-editor [data-mermaid] svg"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(
    page.locator(".read-mount:not(.print-only) [data-mermaid] svg"),
  ).toBeVisible();
  if (await page.getByRole("button", { name: "Use dark theme" }).isVisible())
    await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(
    page.locator(".read-mount:not(.print-only) [data-mermaid] svg"),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/diagram-discussion.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await Promise.all([owner.close(), member.close()]);
});

test("one-time account recovery works in a signed-in browser and revokes old sessions", async ({
  browser,
}) => {
  const { owner, member } = await lab(browser);
  const identity = await api(member.request, "me");
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/ops/admin.ts",
      "--recover",
      "--email",
      identity.user.email,
    ],
    { env: process.env },
  );
  const link = stdout.match(/https?:\/\/\S+\?reset=[a-f0-9]+/)?.[0];
  expect(!!link).toBe(true);
  const token = new URL(link!).searchParams.get("reset")!;
  const page = await member.newPage();
  await page.goto(link!);
  await expect(
    page.getByRole("button", { name: "Update password", exact: true }),
  ).toBeVisible();
  const password = "RecoveredAxiomPassword2026!";
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Update password", exact: true })
    .click();
  await expect(
    page.getByText("Password updated. You can sign in now.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  expect(new URL(page.url()).searchParams.has("reset")).toBe(false);
  expect((await member.request.get("/api/v1/me")).status()).toBe(401);
  const reused = await member.request.post("/api/auth/reset-password", {
    headers: { origin },
    data: { token, newPassword: password },
  });
  expect(reused.ok()).toBe(false);
  const oldPassword = await member.request.post("/api/auth/sign-in/email", {
    headers: { origin },
    data: { email: identity.user.email, password: "AxiomTestPassword2026!" },
  });
  expect(oldPassword.status()).toBe(401);
  const signedIn = await member.request.post("/api/auth/sign-in/email", {
    headers: { origin },
    data: { email: identity.user.email, password },
  });
  expect(signedIn.ok()).toBe(true);
  await Promise.all([owner.close(), member.close()]);
});
