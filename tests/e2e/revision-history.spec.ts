import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, origin, replaceSource } from "./native-editor-helpers";
test.beforeAll(() => {
  if (origin !== "http://localhost:3004")
    throw new Error("Revision acceptance uses isolated staging.");
});

for (const mode of ["light", "dark"] as const) {
  test(`unified research comparison retains atomic blocks in ${mode} appearance`, async ({
    browser,
  }) => {
    const initial =
      "# Result\n\n$$\nx^2\n$$\n\n| Parameter | Value |\n| --- | --- |\n| alpha | 1 |\n\nA measured result.[^source]\n\n[^source]: Reference evidence.\n";
    const f = await fixture(browser, initial);
    try {
      const prefs = await (
        await f.member.request.get("/api/v1/me/preferences-bundle")
      ).json();
      const configured = await f.member.request.patch(
        "/api/v1/me/preferences-bundle",
        {
          headers: { origin },
          data: {
            editor: prefs.editor,
            appearance: {
              version: prefs.appearance.version,
              preferences: {
                ...prefs.appearance.preferences,
                mode,
                themePack: mode === "dark" ? "technical-slate" : "default",
              },
            },
            mutationId: randomUUID(),
          },
        },
      );
      expect(configured.ok(), await configured.text()).toBe(true);
      if (mode === "dark")
        await f.page.addInitScript(() => {
          const state = window as unknown as { revisionSockets: WebSocket[] };
          state.revisionSockets = [];
          const NativeSocket = window.WebSocket;
          window.WebSocket = class extends NativeSocket {
            constructor(url: string | URL, protocols?: string | string[]) {
              super(url, protocols);
              if (String(url).startsWith("ws://localhost:1236"))
                state.revisionSockets.push(this);
            }
          };
        });
      await f.page.reload();
      await expect(f.page.locator(".ws-document-status")).toContainText(
        "Saved on server",
      );
      const base = "/api/v1/resources/" + f.note.id + "/history";
      const checkpoint = await f.member.request.post(base, {
        headers: { origin },
        data: { label: "Experiment 1", mutationId: randomUUID() },
      });
      expect(checkpoint.ok(), await checkpoint.text()).toBe(true);
      const revision = (await checkpoint.json()).id;
      const changed = initial
        .replace("x^2", "x^3")
        .replace("alpha | 1", "alpha | 2");
      await replaceSource(f.page, changed);
      await expect.poll(f.source).toBe(changed);
      await f.page
        .getByRole("button", { name: "Document history", exact: true })
        .click();
      const history = f.page.getByRole("region", {
        name: "Version history",
        exact: true,
      });
      await history
        .getByRole("combobox", { name: "Before revision" })
        .selectOption(revision);
      await history
        .getByRole("button", { name: "Side by side", exact: true })
        .click();
      const content = history.locator(".revision-unified");
      await expect(content.locator("h1")).toHaveCount(1);
      await expect(content.locator("table")).toHaveCount(2);
      await expect(content.locator("[data-math-state=ready]")).toHaveCount(2);
      await expect(content).toContainText("A measured result");
      await f.page.screenshot({
        path: test.info().outputPath(`research-comparison-${mode}.png`),
      });
      expect(
        await history.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      if (mode === "dark") {
        // Read markers must work over HTTP while the editing socket reconnects.
        // Server hashes still reject a marker for uncommitted local-only edits.
        await f.page.route("**/sync-token", (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Rehearsal reconnect pause" }),
          }),
        );
        const closed = await f.page.evaluate(async () => {
          const sockets = (
            window as unknown as { revisionSockets: WebSocket[] }
          ).revisionSockets.filter((s) => s.readyState === WebSocket.OPEN);
          await Promise.all(
            sockets.map(
              (s) =>
                new Promise<void>((resolve) => {
                  s.addEventListener("close", () => resolve(), { once: true });
                  s.close(4000, "Review reconnect rehearsal");
                }),
            ),
          );
          return sockets.length;
        });
        expect(closed).toBeGreaterThan(0);
      }
      await history
        .getByRole("button", { name: "Mark reviewed", exact: true })
        .click();
      await expect(f.page.locator(".ws-notice")).toContainText(
        "Review baseline saved",
      );
      await history
        .getByRole("combobox", { name: "Before revision" })
        .selectOption("seen");
      await history
        .getByRole("button", { name: "Source", exact: true })
        .click();
      await expect(history.locator(".revision-source-change")).toHaveCount(0);
      expect(await f.source()).toBe(changed);
      if (mode === "dark") await f.page.unroute("**/sync-token");
    } finally {
      await f.close();
    }
  });
}

test("history compares without mutation, names milestones, and safely restores", async ({
  browser,
}) => {
  const f = await fixture(browser, "# Study\n\nFirst result.\n");
  try {
    const checkpoint = await f.member.request.post(
      "/api/v1/resources/" + f.note.id + "/history",
      {
        headers: { origin },
        data: { label: "First milestone", mutationId: randomUUID() },
      },
    );
    expect(checkpoint.ok(), await checkpoint.text()).toBeTruthy();
    const saved = await checkpoint.json();
    await replaceSource(f.page, "# Study\n\nRevised result with $x^2$.\n");
    await expect.poll(f.source).toContain("Revised result");
    await f.page
      .getByRole("button", { name: "Document history", exact: true })
      .click();
    const history = f.page.getByRole("region", {
      name: "Version history",
      exact: true,
    });
    await expect(history).toBeVisible();
    await expect(
      history.getByRole("button", { name: /First milestone/ }),
    ).toBeVisible();
    await expect(history.locator(".revision-word")).not.toHaveCount(0);
    expect(await f.source()).toContain("Revised result");
    await history
      .getByRole("button", { name: "Side by side", exact: true })
      .click();
    await expect(history.locator(".revision-unified h1")).toHaveCount(1);
    await expect(history.locator(".revision-unified")).toContainText(
      "First result",
    );
    await expect(history.locator(".revision-unified")).toContainText(
      "Revised result",
    );
    await f.page.screenshot({
      path: test.info().outputPath("version-history-unified.png"),
    });
    await history.getByRole("button", { name: "Source", exact: true }).click();
    await expect(history.locator(".revision-source-add")).toContainText([
      "Revised",
    ]);
    await history.getByRole("button", { name: "Unified", exact: true }).click();
    await f.page.screenshot({
      path: test.info().outputPath("version-history-source.png"),
    });
    await history.getByRole("button", { name: "Rename", exact: true }).click();
    const dialog = f.page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("Reviewed assumptions");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      history.getByRole("button", { name: /Reviewed assumptions/ }),
    ).toBeVisible();
    await history
      .getByRole("button", { name: "Restore before", exact: true })
      .click();
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "Restore revision", exact: true })
      .click();
    await expect(history).not.toBeVisible();
    await expect.poll(f.source).toBe("# Study\n\nFirst result.\n");
    const rows = await (
      await f.member.request.get("/api/v1/resources/" + f.note.id + "/history")
    ).json();
    expect(rows.items.some((v: any) => v.label === "Before restore")).toBe(
      true,
    );
    expect(
      rows.items.some(
        (v: any) => v.id === saved.id && v.label === "Reviewed assumptions",
      ),
    ).toBe(true);
    await f.page.screenshot({
      path: test.info().outputPath("version-history-restored.png"),
    });
  } finally {
    await f.close();
  }
});

test("restore rejects stale source and rename uses metadata compare-and-swap", async ({
  browser,
}) => {
  const f = await fixture(browser, "Baseline\n");
  const base = "/api/v1/resources/" + f.note.id + "/history";
  try {
    const created = await f.member.request.post(base, {
      headers: { origin },
      data: { label: "Original", mutationId: randomUUID() },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { id } = await created.json();
    const before = await (await f.member.request.get(base + "/current")).json();
    await replaceSource(f.page, "Newer collaborator content\n");
    await expect.poll(f.source).toBe("Newer collaborator content\n");
    const stale = await f.member.request.post(base + "/" + id + "/restore", {
      headers: { origin },
      data: {
        mutationId: randomUUID(),
        generation: before.generation,
        expectedHash: before.hash,
      },
    });
    expect(stale.status()).toBe(409);
    for (const status of [200, 409]) {
      const renamed = await f.member.request.patch(base + "/" + id, {
        headers: { origin },
        data: { label: "Updated", version: 1, mutationId: randomUUID() },
      });
      expect(renamed.status(), await renamed.text()).toBe(status);
    }
    expect(await f.source()).toBe("Newer collaborator content\n");
  } finally {
    await f.close();
  }
});

test("previous-visit comparison stays fixed while the current draft changes", async ({
  browser,
}) => {
  const f = await fixture(browser, "At the previous visit.\n");
  try {
    const base = "/api/v1/resources/" + f.note.id;
    await expect
      .poll(
        async () =>
          (await (await f.member.request.get(base + "/review-baseline")).json())
            ?.body,
      )
      .toBe("At the previous visit.\n");
    await replaceSource(f.page, "Changed since that visit.\n");
    await expect.poll(f.source).toBe("Changed since that visit.\n");
    await f.page.reload();
    await expect(f.page.getByTestId("note-editor")).toBeVisible();
    await expect(f.page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await f.page
      .getByRole("button", { name: "Document history", exact: true })
      .click();
    const history = f.page.getByRole("region", { name: "Version history" });
    await history
      .getByRole("combobox", { name: "Before revision" })
      .selectOption("seen");
    await history.getByRole("button", { name: "Source", exact: true }).click();
    await expect(history.locator(".revision-source-grid")).toContainText(
      "previous visit",
    );
    await expect(history.locator(".revision-source-grid")).toContainText(
      "Changed since",
    );
    expect(await f.source()).toBe("Changed since that visit.\n");
  } finally {
    await f.close();
  }
});
