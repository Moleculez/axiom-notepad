import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  createEncoder,
  writeVarString,
  writeVarUint,
  toUint8Array,
} from "lib0/encoding";
import type { WebSocketRoute } from "@playwright/test";
import { fixture, origin } from "./native-editor-helpers";

test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Canvas safety acceptance requires isolated port 3004.");
});
const api = async (
  request: APIRequestContext,
  path: string,
  data?: unknown,
  method = data === undefined ? "GET" : "POST",
) => {
  const result = await request.fetch(`/api/v1/${path}`, {
    headers: { origin },
    data,
    method,
    // The disconnect test crosses Next's idle keep-alive deadline. Retry only
    // a reset GET socket, never a mutation or a failed HTTP response.
    maxRetries: method === "GET" ? 1 : 0,
  });
  expect(result.ok(), await result.text()).toBe(true);
  return result.json();
};
const card = {
  id: "target",
  type: "text",
  text: "A research assumption.",
  x: 0,
  y: 0,
  width: 340,
  height: 220,
};
test("document-level disconnect reauthorizes automatically and on explicit reconnect without losing cards", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Reconnect acceptance");
  try {
    const space = (await api(f.member.request, "spaces")).find(
      (s: any) => s.group_id === f.group.id,
    );
    const project = await api(f.member.request, "files/new", {
      type: "canvas",
      name: "Reconnect board",
      spaceId: space.id,
      source: JSON.stringify({ nodes: [card], edges: [] }),
      mutationId: randomUUID(),
    });
    let socket: WebSocketRoute | undefined;
    await f.page.routeWebSocket(/:1236\/?$/, (route) => {
      socket = route;
      route.connectToServer();
    });
    await f.page.goto(`/workbench/tools/canvas/${project.id}`);
    await expect(f.page.locator(".canvas-status")).toContainText(
      "Saved on server",
    );
    const closeDocument = () => {
      const packet = createEncoder();
      writeVarString(packet, `${project.id}:1`);
      writeVarUint(packet, 7); // Hocuspocus document CLOSE, not a network-wide disconnect.
      writeVarString(packet, "Acceptance: reconnect this room");
      socket!.send(Buffer.from(toUint8Array(packet)));
    };
    closeDocument();
    await expect(
      f.page.getByRole("button", { name: "Reconnect canvas" }),
    ).toBeVisible();
    await f.page.getByRole("button", { name: "Reconnect canvas" }).click();
    await expect(f.page.locator(".canvas-status")).toContainText(
      "Saved on server",
    );
    await expect(
      f.page.getByRole("button", { name: "Add text card", exact: true }),
    ).toBeEnabled();
    closeDocument();
    await expect(
      f.page.getByRole("button", { name: "Reconnect canvas" }),
    ).toBeVisible();
    await expect(f.page.locator(".canvas-status")).toContainText(
      "Saved on server",
      { timeout: 10000 },
    );
    expect(
      JSON.parse((await api(f.member.request, `notes/${project.id}`)).body)
        .nodes,
    ).toHaveLength(1);
    await expect(f.page.locator('[data-canvas-node="target"]')).toContainText(
      card.text,
    );
  } finally {
    await f.close();
  }
});
async function membership(
  f: Awaited<ReturnType<typeof fixture>>,
  changes: Record<string, unknown>,
) {
  const me = await api(f.member.request, "me"),
    members = await api(f.owner.request, `group-admin/${f.group.id}/members`);
  const member = members.items.find((m: any) => m.id === me.user.id);
  const result = await api(
    f.owner.request,
    `group-admin/${f.group.id}/members`,
    {
      mutationId: randomUUID(),
      items: [{ id: member.id, version: member.version }],
      ...changes,
    },
    "PATCH",
  );
  expect(result.results.every((r: any) => r.ok)).toBe(true);
}

test("commenters discuss cards while canvas edits remain disabled", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Commenter acceptance");
  try {
    const space = (await api(f.member.request, "spaces")).find(
      (s: any) => s.group_id === f.group.id,
    );
    const project = await api(f.member.request, "files/new", {
      type: "canvas",
      name: "Review board",
      spaceId: space.id,
      source: JSON.stringify({ nodes: [card], edges: [] }),
      mutationId: randomUUID(),
    });
    await membership(f, { contentRole: "commenter" });
    await f.page.goto(`/workbench/tools/canvas/${project.id}`);
    await expect(
      f.page.getByRole("button", { name: "Add text card", exact: true }),
    ).toBeDisabled();
    await f.page
      .locator('[data-canvas-node="target"]')
      .click({ button: "right", position: { x: 30, y: 15 } });
    await f.page
      .getByRole("menuitem", { name: "Discuss card", exact: true })
      .click();
    await f.page
      .getByLabel("Write a comment")
      .fill("Please justify this assumption.");
    await f.page
      .locator(".resource-discussion")
      .getByRole("button", { name: "Comment", exact: true })
      .click();
    await expect(f.page.locator(".resource-comment-list")).toContainText(
      "Please justify this assumption.",
    );
    const comments = await api(
      f.member.request,
      `resource-comments/${project.id}`,
    );
    expect(comments[0].anchor).toEqual({
      kind: "canvas-node",
      nodeId: "target",
    });
    const denied = await f.member.request.post("/api/v1/files/new", {
      headers: { origin },
      data: {
        type: "canvas",
        name: "Forbidden edit",
        spaceId: space.id,
        mutationId: randomUUID(),
      },
    });
    // The workspace API deliberately hides unauthorized mutation targets.
    expect(denied.status()).toBe(404);
  } finally {
    await f.close();
  }
});

test("file cards follow new versions, retain explicit pins and stop previewing after permission loss", async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  const f = await fixture(browser, "# Reference access acceptance");
  try {
    const spaces = await api(f.member.request, "spaces"),
      team = spaces.find((s: any) => s.group_id === f.group.id),
      personal = spaces.find((s: any) => s.kind === "personal");
    const upload = async (body: string, resourceId?: string) => {
      const id = randomUUID(),
        bytes = Buffer.from(body);
      await api(f.owner.request, "uploads", {
        id,
        spaceId: team.id,
        name: "measurement.txt",
        bytes: bytes.length,
        resourceId,
      });
      const chunk = await f.owner.request.put(
        `/api/v1/uploads/${id}/chunks/1`,
        {
          headers: { origin, "content-type": "application/octet-stream" },
          data: bytes,
        },
      );
      expect(chunk.ok()).toBe(true);
      await api(f.owner.request, `uploads/${id}/complete`, {});
      await expect
        .poll(async () => (await api(f.owner.request, `uploads/${id}`)).status)
        .toBe("complete");
      return (await api(f.owner.request, `uploads/${id}`)).resourceId as string;
    };
    const file = await upload("Original measurement: 42"),
      version = (await api(f.owner.request, `files/${file}/versions`))[0].id;
    const nodes = [0, 1].map((i) => ({
      id: i ? "latest" : "pinned",
      type: "file",
      file: "measurement.txt",
      resourceId: file,
      ...(i ? {} : { versionId: version }),
      x: i * 400,
      y: 0,
      width: 350,
      height: 300,
    }));
    const project = await api(f.member.request, "files/new", {
      type: "canvas",
      name: "Personal references",
      spaceId: personal.id,
      source: JSON.stringify({ nodes, edges: [] }),
      mutationId: randomUUID(),
    });
    await f.page.goto(`/workbench/tools/canvas/${project.id}`);
    await expect(f.page.locator('[data-canvas-node="latest"]')).toContainText(
      "Original measurement: 42",
    );
    await upload("Revised measurement: 84", file);
    await expect(f.page.locator('[data-canvas-node="latest"]')).toContainText(
      "Revised measurement: 84",
    );
    await expect(f.page.locator('[data-canvas-node="pinned"]')).toContainText(
      "Original measurement: 42",
    );
    const pinned = await api(
        f.member.request,
        `resources/${file}/card-preview?version=${version}`,
      ),
      live = await api(f.member.request, `resources/${file}/card-preview`);
    expect(pinned.revision).toBe(version);
    expect(live.revision).not.toBe(version);
    await membership(f, { remove: true });
    await expect
      .poll(async () =>
        (
          await f.member.request.get(`/api/v1/resources/${file}/card-preview`)
        ).status(),
      )
      .toBe(404);
    await expect(
      f.page.locator('[data-canvas-node="latest"] .canvas-preview-notice'),
    ).toBeVisible();
    await expect(
      f.page.locator('[data-canvas-node="latest"]'),
    ).not.toContainText("Revised measurement: 84");
    await f.page.screenshot({
      path: info.outputPath("canvas-permission-loss.png"),
      fullPage: true,
    });
  } finally {
    await f.close();
  }
});

test("replaced dataset clears old journals across tabs without touching unrelated site data", async ({
  browser,
}, info) => {
  const f = await fixture(browser, "# Old dataset acceptance"),
    second = await f.member.newPage();
  try {
    await second.goto(`/workbench/notes/${f.note.id}`);
    await expect(second.getByTestId("note-editor")).toBeVisible();
    const identity = await api(f.member.request, "instance");
    await f.page.evaluate(async (stale) => {
      localStorage.setItem("unrelated-preference", "keep");
      sessionStorage.setItem("axiom:old-transient", "remove");
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("axiom:old-dataset-fixture", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("entries");
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
      await caches.open("axiom-old-dataset-fixture");
      localStorage.setItem("axiom:dataset", stale);
    }, randomUUID());
    for (const page of [f.page, second]) {
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("axiom:dataset")))
        .toBe(identity.datasetId);
      await expect(page.getByTestId("note-editor")).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("axiom:session")))
        .toBeNull();
      expect(
        await page.evaluate(() => localStorage.getItem("unrelated-preference")),
      ).toBe("keep");
    }
    expect(
      await f.page.evaluate(async () =>
        (await indexedDB.databases()).some(
          (db) => db.name === "axiom:old-dataset-fixture",
        ),
      ),
    ).toBe(false);
    expect(
      await f.page.evaluate(async () =>
        (await caches.keys()).includes("axiom-old-dataset-fixture"),
      ),
    ).toBe(false);
    expect(
      await f.page.evaluate(() =>
        sessionStorage.getItem("axiom:old-transient"),
      ),
    ).toBeNull();
    await f.page.screenshot({
      path: info.outputPath("dataset-replacement-signed-out.png"),
      fullPage: true,
    });
  } finally {
    await second.close();
    await f.close();
  }
});
