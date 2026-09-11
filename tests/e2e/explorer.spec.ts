import {
  test,
  expect,
  type APIRequestContext,
  type Browser,
} from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { signInOwner } from "./auth";
import { createRequire } from "node:module";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
const JSZip = createRequire(import.meta.url)("jszip") as typeof import("jszip");
const origin =
  process.env.TEST_APP_URL || process.env.APP_URL || "http://localhost:8080";

test("quota reservations serialize admission and reject stale or oversubscribed limits", async ({
  browser,
}) => {
  const { owner, member } = await lab(browser);
  try {
    const personal = (await api(member.request, "spaces")).find(
      (space: any) => space.kind === "personal",
    );
    await api(
      member.request,
      `storage/${personal.id}`,
      { quotaBytes: 1000, expectedQuotaBytes: null },
      "PATCH",
    );
    const attempts = await Promise.all(
      [0, 1].map((index) =>
        member.request.post("/api/v1/uploads", {
          headers: { origin },
          data: {
            id: randomUUID(),
            spaceId: personal.id,
            name: `reserved-${index}.txt`,
            bytes: 800,
          },
        }),
      ),
    );
    expect(attempts.map((response) => response.status()).sort()).toEqual([
      201, 413,
    ]);
    const accepted = await attempts
      .find((response) => response.status() === 201)!
      .json();
    expect(
      (
        await member.request.patch(`/api/v1/storage/${personal.id}`, {
          headers: { origin },
          data: { quotaBytes: 500, expectedQuotaBytes: 1000 },
        })
      ).status(),
    ).toBe(413);
    expect(
      Number((await api(member.request, `storage/${personal.id}`)).quotaBytes),
    ).toBe(1000);
    expect(
      (
        await member.request.patch(`/api/v1/storage/${personal.id}`, {
          headers: { origin },
          data: { quotaBytes: 2000, expectedQuotaBytes: null },
        })
      ).status(),
    ).toBe(409);
    await api(member.request, `uploads/${accepted.id}/cancel`, {});
    await api(
      member.request,
      `storage/${personal.id}`,
      { quotaBytes: 500, expectedQuotaBytes: 1000 },
      "PATCH",
    );
  } finally {
    await owner.close();
    await member.close();
  }
});

test("a token issued before downgrade cannot write through the collaboration socket", async ({
  browser,
}) => {
  const { owner, member, group, memberId } = await lab(browser);
  const doc = new Y.Doc();
  let provider: HocuspocusProvider | undefined;
  try {
    const project = await api(owner.request, "projects", {
      groupId: group.id,
      name: "Socket permissions",
    });
    const full = await api(owner.request, `projects/${project.id}`);
    const note = await api(owner.request, "resources", {
      spaceId: full.space_id,
      kind: "note",
      name: "Protected derivation",
      body: "Authoritative source\n",
    });
    await api(owner.request, `projects/${project.id}/members`, {
      userId: memberId,
      role: "editor",
    });
    const token = await api(member.request, `notes/${note.id}/sync-token`, {});
    await api(owner.request, `projects/${project.id}/members`, {
      userId: memberId,
      role: "viewer",
    });
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(
        () => fail(new Error("Read-only socket handshake timed out")),
        10000,
      );
      provider = new HocuspocusProvider({
        url: process.env.NEXT_PUBLIC_SYNC_URL || "ws://localhost:1234",
        name: token.room,
        token: token.token,
        document: doc,
        onSynced: () => {
          clearTimeout(timer);
          done();
        },
        onAuthenticationFailed: (event) => {
          clearTimeout(timer);
          fail(new Error(event.reason));
        },
      });
    });
    doc.getText("markdown").insert(0, "UNAUTHORIZED WRITE\n");
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(
        () =>
          fail(new Error("Read-only verification acknowledgment timed out")),
        10000,
      );
      provider!.on("stateless", ({ payload }: { payload: string }) => {
        const message = JSON.parse(payload);
        if (message.id === "viewer-check") {
          clearTimeout(timer);
          expect(message.type).toBe("persisted");
          done();
        }
      });
      provider!.sendStateless(
        JSON.stringify({ type: "save-check", id: "viewer-check" }),
      );
    });
    expect((await api(owner.request, `notes/${note.id}`)).body).toBe(
      "Authoritative source\n",
    );
    await api(owner.request, `projects/${project.id}/members`, {
      userId: memberId,
      remove: true,
    });
    expect(
      (
        await member.request.post(`/api/v1/notes/${note.id}/sync-token`, {
          headers: { origin },
          data: {},
        })
      ).status(),
    ).toBe(404);
  } finally {
    provider?.destroy();
    doc.destroy();
    await owner.close();
    await member.close();
  }
});
let ownerState:
  | Awaited<
      ReturnType<import("@playwright/test").BrowserContext["storageState"]>
    >
  | undefined;
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
    expect(login.ok(), await login.text()).toBeTruthy();
    ownerState = await owner.storageState();
  }
  const group = await api(owner.request, "groups", {
    name: "Explorer " + randomUUID().slice(0, 8),
  });
  const invitation = await api(owner.request, "invitations", {
    groupId: group.id,
    email: `explorer-${randomUUID()}@axiom.test`,
  });
  const registered = await api(member.request, "register", {
    token: new URL(invitation.link).searchParams.get("invite"),
    name: "Explorer researcher",
    password: "AxiomTestPassword2026!",
  });
  return { owner, member, group, memberId: registered.user.id };
}
test("personal work survives departure and cannot be read by a group administrator", async ({
  browser,
}) => {
  const { owner, member, group, memberId } = await lab(browser);
  try {
    const spaces = await api(member.request, "spaces");
    const personal = spaces.find((s: any) => s.kind === "personal");
    const folder = await api(member.request, "resources", {
      mutationId: randomUUID(),
      spaceId: personal.id,
      kind: "folder",
      name: "Private research",
    });
    const input = {
      mutationId: randomUUID(),
      spaceId: personal.id,
      parentId: folder.id,
      kind: "note",
      name: "Private calculation",
      body: "# Personal\n\nNever group readable.",
    };
    const note = await api(member.request, "resources", input);
    expect((await api(member.request, "resources", input)).id).toBe(note.id);
    expect(
      (await owner.request.get("/api/v1/resources/" + note.id)).status(),
    ).toBe(404);
    expect((await owner.request.get("/api/v1/notes/" + note.id)).status()).toBe(
      404,
    );
    await api(
      owner.request,
      `members/${memberId}?groupId=${group.id}`,
      undefined,
      "DELETE",
    );
    expect((await api(member.request, `notes/${note.id}`)).body).toContain(
      "Never group readable",
    );
    const listing = await api(
      member.request,
      `resources?spaceId=${personal.id}&parentId=${folder.id}`,
    );
    expect(listing.items.map((r: any) => r.id)).toContain(note.id);
  } finally {
    await owner.close();
    await member.close();
  }
});
test("project roles protect listings, REST mutations, tasks and inherited resources", async ({
  browser,
}) => {
  const { owner, member, group, memberId } = await lab(browser);
  try {
    const project = await api(owner.request, "projects", {
      groupId: group.id,
      name: "Restricted project",
    });
    const full = await api(owner.request, `projects/${project.id}`);
    const note = await api(owner.request, "resources", {
      spaceId: full.space_id,
      kind: "note",
      name: "Restricted derivation",
    });
    expect(
      (await member.request.get(`/api/v1/projects/${project.id}`)).status(),
    ).toBe(404);
    expect(
      (await member.request.get(`/api/v1/notes/${note.id}`)).status(),
    ).toBe(404);
    await api(owner.request, `projects/${project.id}/members`, {
      userId: memberId,
      role: "viewer",
    });
    const seen = await api(member.request, `notes/${note.id}`);
    expect(seen.role).toBe("viewer");
    expect(
      (
        await member.request.patch(`/api/v1/notes/${note.id}`, {
          headers: { origin },
          data: { version: seen.version, title: "Forbidden" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await member.request.post(`/api/v1/notes/${note.id}/comments`, {
          headers: { origin },
          data: { body: "Forbidden" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (await api(member.request, `notes/${note.id}/sync-token`, {})).readOnly,
    ).toBe(true);
    await api(owner.request, `projects/${project.id}/members`, {
      userId: memberId,
      role: "commenter",
    });
    expect(
      (
        await api(member.request, `notes/${note.id}/comments`, {
          body: "A permitted review comment",
        })
      ).id,
    ).toBeTruthy();
    const task = await api(owner.request, `projects/${project.id}/tasks`, {
      title: "Prove convergence",
      assigneeId: memberId,
    });
    expect((await api(member.request, `tasks/${task.id}`)).title).toBe(
      "Prove convergence",
    );
    expect(
      (
        await member.request.patch(`/api/v1/tasks/${task.id}`, {
          headers: { origin },
          data: { version: task.version, status: "done" },
        })
      ).status(),
    ).toBe(404);
    await api(owner.request, `projects/${project.id}/members`, {
      userId: memberId,
      remove: true,
    });
    expect(
      (await member.request.get(`/api/v1/tasks/${task.id}`)).status(),
    ).toBe(404);
    expect(
      (await api(member.request, "inbox")).some(
        (e: any) => e.task_id === task.id,
      ),
    ).toBe(false);
  } finally {
    await owner.close();
    await member.close();
  }
});
test("Explorer pagination, stale writes, cycles and recoverable subtree trash", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser);
  try {
    const space = (await api(owner.request, "spaces")).find(
      (s: any) => s.kind === "team" && s.group_id === group.id,
    );
    const folder = await api(owner.request, "resources", {
      spaceId: space.id,
      kind: "folder",
      name: "Experiments",
    });
    const child = await api(owner.request, "resources", {
      spaceId: space.id,
      parentId: folder.id,
      kind: "folder",
      name: "Results",
    });
    for (const name of ["Alpha", "Beta", "Gamma"])
      await api(owner.request, "resources", {
        spaceId: space.id,
        parentId: child.id,
        kind: "note",
        name,
      });
    const first = await api(
      owner.request,
      `resources?spaceId=${space.id}&parentId=${child.id}&limit=2`,
    );
    const second = await api(
      owner.request,
      `resources?spaceId=${space.id}&parentId=${child.id}&limit=2&cursor=${first.nextCursor}`,
    );
    expect([...first.items, ...second.items].map((r: any) => r.name)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(
      (
        await owner.request.patch(`/api/v1/resources/${folder.id}`, {
          headers: { origin },
          data: { version: folder.version, parentId: child.id },
        })
      ).status(),
    ).toBe(400);
    await api(
      owner.request,
      `resources/${child.id}`,
      { version: child.version, name: "Findings" },
      "PATCH",
    );
    expect(
      (
        await owner.request.patch(`/api/v1/resources/${child.id}`, {
          headers: { origin },
          data: { version: child.version, name: "Stale" },
        })
      ).status(),
    ).toBe(409);
    await api(owner.request, `resources/${folder.id}/trash`, {
      version: folder.version,
    });
    const trashed = await api(owner.request, `resources/${folder.id}`);
    expect(trashed.deleted_at).toBeTruthy();
    await api(owner.request, `resources/${folder.id}/restore`, {
      version: trashed.version,
    });
    expect(
      (
        await api(
          owner.request,
          `resources?spaceId=${space.id}&parentId=${child.id}`,
        )
      ).items,
    ).toHaveLength(3);
  } finally {
    await owner.close();
    await member.close();
  }
});
test("resumable uploads are checksummed, private, range-readable and versioned", async ({
  browser,
}) => {
  const { owner, member } = await lab(browser);
  try {
    const space = (await api(owner.request, "spaces")).find(
      (s: any) => s.kind === "personal",
    );
    const uploadId = randomUUID(),
      data = Buffer.alloc(8 * 1024 * 1024 + 37, 65),
      sha = createHash("sha256").update(data).digest("hex");
    const started = await api(owner.request, "uploads", {
      id: uploadId,
      spaceId: space.id,
      name: "measurements.txt",
      bytes: data.length,
      sha256: sha,
    });
    expect(started.chunkBytes).toBe(8 * 1024 * 1024);
    const put = (part: number, chunk: Buffer) =>
      owner.request.put(`/api/v1/uploads/${uploadId}/chunks/${part}`, {
        headers: { origin, "content-type": "application/octet-stream" },
        data: chunk,
      });
    const first = data.subarray(0, started.chunkBytes);
    expect((await put(1, first)).ok()).toBeTruthy();
    expect((await put(1, first)).ok()).toBeTruthy();
    expect((await put(1, Buffer.alloc(first.length, 66))).status()).toBe(409);
    expect(
      (await api(owner.request, `uploads/${uploadId}`)).chunks,
    ).toHaveLength(1);
    expect(
      (
        await owner.request.post(`/api/v1/uploads/${uploadId}/complete`, {
          headers: { origin },
          data: {},
        })
      ).status(),
    ).toBe(409);
    expect((await put(2, data.subarray(started.chunkBytes))).ok()).toBeTruthy();
    await api(owner.request, `uploads/${uploadId}/complete`, {});
    let completed: any;
    await expect
      .poll(
        async () => {
          completed = await api(owner.request, `uploads/${uploadId}`);
          return completed.status;
        },
        { timeout: 30000 },
      )
      .toBe("complete");
    const file = await api(owner.request, `resources/${completed.resourceId}`);
    const range = await owner.request.get(`/api/v1/files/${file.id}/content`, {
      headers: { range: "bytes=0-9" },
    });
    expect(range.status()).toBe(206);
    expect(await range.body()).toEqual(data.subarray(0, 10));
    expect(
      (
        await member.request.get(
          `/api/v1/attachments/${file.current_version_id}`,
        )
      ).status(),
    ).toBe(404);
    const versions = await api(owner.request, `files/${file.id}/versions`);
    expect(versions[0].sha256).toBe(sha);
    expect(
      (
        await owner.request.get(`/api/v1/files/${file.id}/content`, {
          headers: { range: "bytes=999999999999-" },
        })
      ).status(),
    ).toBe(416);
  } finally {
    await owner.close();
    await member.close();
  }
});

test("manual cleanup protects pinned revisions and restoration creates an immutable version", async ({
  browser,
}) => {
  const { owner, member } = await lab(browser);
  try {
    const space = (await api(owner.request, "spaces")).find(
      (s: any) => s.kind === "personal",
    );
    const upload = async (contents: string, resourceId?: string) => {
      const id = randomUUID(),
        data = Buffer.from(contents);
      await api(owner.request, "uploads", {
        id,
        spaceId: space.id,
        name: "version-test.txt",
        bytes: data.length,
        resourceId,
      });
      expect(
        (
          await owner.request.put(`/api/v1/uploads/${id}/chunks/1`, {
            headers: { origin, "content-type": "application/octet-stream" },
            data,
          })
        ).ok(),
      ).toBeTruthy();
      await api(owner.request, `uploads/${id}/complete`, {});
      let finished: any;
      await expect
        .poll(
          async () => {
            finished = await api(owner.request, `uploads/${id}`);
            return finished.status;
          },
          { timeout: 30000 },
        )
        .toBe("complete");
      return api(owner.request, `resources/${finished.resourceId}`);
    };
    const first = await upload("original evidence"),
      firstId = first.current_version_id;
    await api(owner.request, "resources", {
      spaceId: space.id,
      kind: "note",
      name: "Pinned evidence",
      body: `[Original data](/api/v1/attachments/${firstId})`,
    });
    const next = await upload("newer evidence", first.id),
      nextId = next.current_version_id;
    const usage = await api(owner.request, `files/${first.id}/usage`);
    expect(usage.references).toBe(1);
    expect(usage.sources[0].name).toBe("Pinned evidence");
    const denied = await owner.request.post(
      `/api/v1/files/${first.id}/purge-version`,
      {
        headers: { origin },
        data: {
          version: next.version,
          versionId: firstId,
          confirmation: "DELETE VERSION",
        },
      },
    );
    expect(denied.status()).toBe(409);
    expect(
      (await member.request.get(`/api/v1/files/${first.id}/usage`)).status(),
    ).toBe(404);
    await api(owner.request, `files/${first.id}/restore-version`, {
      version: next.version,
      versionId: firstId,
    });
    const restored = await api(owner.request, `resources/${first.id}`);
    expect(restored.current_version_id).not.toBe(firstId);
    expect(
      await (
        await owner.request.get(`/api/v1/files/${first.id}/content`)
      ).text(),
    ).toBe("original evidence");
    expect(
      await (await owner.request.get(`/api/v1/attachments/${firstId}`)).text(),
    ).toBe("original evidence");
    await api(owner.request, `files/${first.id}/purge-version`, {
      version: restored.version,
      versionId: nextId,
      confirmation: "DELETE VERSION",
    });
    expect(
      (await owner.request.get(`/api/v1/attachments/${nextId}`)).status(),
    ).toBe(404);
    expect(await api(owner.request, `files/${first.id}/versions`)).toHaveLength(
      2,
    );
    const fresh = await api(owner.request, `resources/${first.id}`);
    await api(owner.request, `resources/${first.id}/trash`, {
      version: fresh.version,
    });
    const trash = await api(owner.request, `resources/${first.id}`);
    expect(
      (
        await owner.request.post(`/api/v1/resources/${first.id}/purge`, {
          headers: { origin },
          data: { version: trash.version, confirmation: "DELETE FOREVER" },
        })
      ).status(),
    ).toBe(409);
    const folder = await api(owner.request, "resources", {
      spaceId: space.id,
      kind: "folder",
      name: "Disposable test folder",
    });
    await api(owner.request, "resources", {
      spaceId: space.id,
      parentId: folder.id,
      kind: "note",
      name: "Disposable test note",
      body: "Temporary test content",
    });
    await api(owner.request, `resources/${folder.id}/trash`, {
      version: folder.version,
    });
    const trashed = await api(owner.request, `resources/${folder.id}`);
    expect(
      (
        await api(owner.request, `resources/${folder.id}/purge`, {
          version: trashed.version,
          confirmation: "DELETE FOREVER",
        })
      ).removed,
    ).toBe(2);
    expect(
      (await owner.request.get(`/api/v1/resources/${folder.id}`)).status(),
    ).toBe(404);
  } finally {
    await owner.close();
    await member.close();
  }
});

test("portable exports stream a real archive and are denied after membership revocation", async ({
  browser,
}) => {
  const { owner, member, group, memberId } = await lab(browser);
  try {
    const space = (await api(member.request, "spaces")).find(
      (s: any) => s.kind === "team" && s.group_id === group.id,
    );
    const note = await api(member.request, "resources", {
      spaceId: space.id,
      kind: "note",
      name: "Portable theorem",
      body: "# Theorem\n\nA portable derivation: $E=mc^2$.",
    });
    const created = await api(member.request, "exports", {
      spaceId: space.id,
      resourceIds: [note.id],
    });
    let item: any;
    await expect
      .poll(
        async () => {
          item = (await api(member.request, "exports")).find(
            (e: any) => e.id === created.id,
          );
          return item.status === "failed" ? item.error : item.status;
        },
        { timeout: 30000 },
      )
      .toBe("ready");
    const response = await member.request.get(
      `/api/v1/exports/${item.id}/download`,
    );
    expect(response.status()).toBe(200);
    const zip = await JSZip.loadAsync(await response.body());
    const manifest = JSON.parse(
      await zip.file("workspace-manifest.json")!.async("string"),
    );
    expect(manifest.resources[0].id).toBe(note.id);
    expect(
      await zip.file(manifest.resources[0].path)!.async("string"),
    ).toContain("$E=mc^2$");
    expect(
      (await owner.request.get(`/api/v1/exports/${item.id}/download`)).status(),
    ).toBe(404);
    await api(
      owner.request,
      `members/${memberId}?groupId=${group.id}`,
      undefined,
      "DELETE",
    );
    expect(
      (
        await member.request.get(`/api/v1/exports/${item.id}/download`)
      ).status(),
    ).toBe(404);
    await api(member.request, `exports/${item.id}/remove`, {});
    expect(
      (await api(member.request, "exports")).some((e: any) => e.id === item.id),
    ).toBe(false);
  } finally {
    await owner.close();
    await member.close();
  }
});

test("cross-space copies preserve exact evidence and moves require explicit audience consent", async ({
  browser,
}) => {
  const { owner, member, group } = await lab(browser);
  try {
    const spaces = await api(member.request, "spaces"),
      personal = spaces.find((s: any) => s.kind === "personal"),
      team = spaces.find(
        (s: any) => s.kind === "team" && s.group_id === group.id,
      );
    const uploadId = randomUUID(),
      contents = Buffer.from("Private evidence copied by explicit choice");
    await api(member.request, "uploads", {
      id: uploadId,
      spaceId: personal.id,
      name: "evidence.txt",
      bytes: contents.length,
    });
    expect(
      (
        await member.request.put(`/api/v1/uploads/${uploadId}/chunks/1`, {
          headers: { origin, "content-type": "application/octet-stream" },
          data: contents,
        })
      ).ok(),
    ).toBeTruthy();
    await api(member.request, `uploads/${uploadId}/complete`, {});
    let upload: any;
    await expect
      .poll(
        async () => {
          upload = await api(member.request, `uploads/${uploadId}`);
          return upload.status;
        },
        { timeout: 30000 },
      )
      .toBe("complete");
    const file = await api(member.request, `resources/${upload.resourceId}`),
      originalVersion = file.current_version_id;
    const note = await api(member.request, "resources", {
      spaceId: personal.id,
      kind: "note",
      name: "Shared by choice",
      body: `[Evidence](/api/v1/attachments/${originalVersion})`,
    });
    expect(
      (
        await member.request.post(`/api/v1/resources/${note.id}/copy`, {
          headers: { origin },
          data: { version: note.version, destinationSpaceId: team.id },
        })
      ).status(),
    ).toBe(409);
    const copied = await api(member.request, `resources/${note.id}/copy`, {
      version: note.version,
      destinationSpaceId: team.id,
      confirmAudience: true,
    });
    const shared = await api(owner.request, `notes/${copied.id}`);
    const newVersion = shared.body.match(
      /\/api\/v1\/attachments\/([\da-f-]{36})/,
    )[1];
    expect(newVersion).not.toBe(originalVersion);
    expect(
      await (
        await owner.request.get(`/api/v1/attachments/${newVersion}`)
      ).body(),
    ).toEqual(contents);
    expect(
      (
        await owner.request.get(`/api/v1/attachments/${originalVersion}`)
      ).status(),
    ).toBe(404);
    expect((await owner.request.get(`/api/v1/notes/${note.id}`)).status()).toBe(
      404,
    );
    expect((await api(member.request, `notes/${note.id}`)).body).toContain(
      originalVersion,
    );
    const folder = await api(member.request, "resources", {
      spaceId: personal.id,
      kind: "folder",
      name: "Share this folder",
    });
    const child = await api(member.request, "resources", {
      spaceId: personal.id,
      parentId: folder.id,
      kind: "note",
      name: "Stable note identity",
      body: "# Preserved\n\nCloud document state.",
    });
    await api(member.request, `resources/${folder.id}/transfer`, {
      version: folder.version,
      destinationSpaceId: team.id,
      confirmAudience: true,
    });
    const moved = await api(owner.request, `notes/${child.id}`);
    expect(moved.generation).toBe(1);
    expect(moved.body).toContain("Cloud document state");
    expect((await api(owner.request, `resources/${child.id}`)).parent_id).toBe(
      folder.id,
    );
    expect((await api(owner.request, `resources/${folder.id}`)).space_id).toBe(
      team.id,
    );
  } finally {
    await owner.close();
    await member.close();
  }
});
