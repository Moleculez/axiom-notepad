import { test, expect, type BrowserContext } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { signInOwner } from "./auth";
import { createRequire } from "node:module";
import { defaults } from "../../packages/shared/src/appearance";
const sharp = createRequire(import.meta.url)(
  "sharp",
) as (typeof import("sharp"))["default"];

test("new pages reflow with maximum typography, dark theme and reduced motion", async ({
  browser,
}) => {
  const { context } = await account(browser),
    page = await context.newPage();
  try {
    const response = await context.request.patch("/api/v1/me/preferences", {
      headers: { origin },
      data: {
        mutationId: randomUUID(),
        version: 0,
        preferences: {
          ...defaults,
          uiSize: 22,
          uiScale: 1.5,
          proseSize: 30,
          mode: "dark",
          motion: "none",
        },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of [
        "home",
        "explorer",
        "projects",
        "research",
        "inbox",
        "people",
        "settings/profile",
        "settings/appearance",
      ]) {
        await page.goto("/workbench/" + route);
        await expect(
          page.getByRole("navigation", { name: "Current location" }),
        ).toBeVisible();
        await expect(
          page.locator(".ws-page:visible, .ws-explorer-main:visible").first(),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          route,
        ).toBe(true);
      }
      await page.screenshot({
        path: `data/workspace-dark-large-${viewport.width}.png`,
      });
    }
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await expect(page.locator(".ws-appbar")).toHaveCSS(
      "backdrop-filter",
      "none",
    );
  } finally {
    await context.close();
  }
});
const origin =
  process.env.TEST_APP_URL || process.env.APP_URL || "http://localhost:8080";
let state: Awaited<ReturnType<BrowserContext["storageState"]>>;
test.beforeAll(async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: origin });
  const response = await signInOwner(owner.request, origin);
  expect(response.ok(), await response.text()).toBeTruthy();
  state = await owner.storageState();
  await owner.close();
});
async function account(
  browser: import("@playwright/test").Browser,
  serviceWorkers: "allow" | "block" = "allow",
) {
  const owner = await browser.newContext({
      baseURL: origin,
      storageState: state,
    }),
    context = await browser.newContext({ baseURL: origin, serviceWorkers });
  const group = await (
    await owner.request.post("/api/v1/groups", {
      headers: { origin },
      data: { name: "Workbench " + randomUUID().slice(0, 6) },
    })
  ).json();
  const email = `workbench-${randomUUID()}@axiom.test`,
    password = "AxiomWorkspace2026!";
  const invitation = await (
    await owner.request.post("/api/v1/invitations", {
      headers: { origin },
      data: { groupId: group.id, email },
    })
  ).json();
  const registered = await context.request.post("/api/v1/register", {
    headers: { origin },
    data: {
      token: new URL(invitation.link).searchParams.get("invite"),
      name: "Ada Researcher",
      password,
    },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  const spaces = await (await context.request.get("/api/v1/spaces")).json();
  await owner.close();
  return { context, email, password, group, spaces };
}
async function createNote(
  context: BrowserContext,
  spaceId: string,
  name: string,
  body: string,
) {
  const response = await context.request.post("/api/v1/resources", {
    headers: { origin },
    data: { spaceId, kind: "note", name, body },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test("routed shell, Explorer dialogs, appearance and navigation work at desktop widths", async ({
  browser,
}) => {
  const { context, spaces } = await account(browser),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/workbench/home");
    await expect(
      page.getByRole("navigation", { name: "Current location" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /next idea, Ada/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Workspace pages", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Explorer Notes, folders and files/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Personal space", exact: true }),
    ).toBeVisible();
    await page.locator(".ws-explorer-main summary").click();
    await page.getByRole("button", { name: "Folder", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox(),
      viewport = page.viewportSize()!;
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(
      3,
    );
    expect(
      Math.abs(box!.y + box!.height / 2 - viewport.height / 2),
    ).toBeLessThan(3);
    await dialog.getByLabel("Folder name").fill("Experiments");
    await dialog.getByRole("button", { name: "Create folder" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Experiments Folder", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Experiments Folder", exact: true })
      .dblclick();
    await expect(page).toHaveURL(/folder=/);
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Personal space", exact: true }),
    ).toBeVisible();
    await page.goto("/workbench/settings/appearance");
    await expect(
      page.getByRole("heading", { name: "Theme", exact: true }),
    ).toBeVisible();
    await page.goto(
      `/workbench/explorer?space=${spaces.find((space: any) => space.kind === "personal").id}`,
    );
    await expect(
      page.getByRole("heading", { name: "Personal space", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Experiments Folder", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: "data/workspace-explorer-desktop.png" });
    // Retain the old narrow-screen check as opt-in; this release is desktop-only.
    if (process.env.TEST_MOBILE === "1") {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page.getByRole("navigation", { name: "Current location" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Toggle workspace sidebar" })
        .click();
      await expect(
        page.getByRole("complementary", { name: "Context navigation" }),
      ).toBeVisible();
      await page.screenshot({ path: "data/workspace-explorer-mobile.png" });
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
test("research editor retains local undo across document tabs and scopes split-pane shortcuts", async ({
  browser,
}) => {
  const { context, spaces } = await account(browser),
    personal = spaces.find((space: any) => space.kind === "personal"),
    page = await context.newPage();
  const first = await createNote(
      context,
      personal.id,
      "Derivation A",
      "# First principle\n\n## A nested assumption\n\n### Detail\n\nEnergy $E=mc^2$.\n",
    ),
    second = await createNote(
      context,
      personal.id,
      "Derivation B",
      "# Another result\n\nEvidence.\n",
    );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(`/workbench/notes/${first.id}`);
    await expect(page.getByTestId("note-editor")).toContainText(
      "First principle",
    );
    await expect(page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByTestId("note-editor").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("\nRetained tab edit.");
    await expect(page.getByTestId("note-editor")).toContainText(
      "Retained tab edit.",
    );
    // Native History API navigation is shared with the persistent layout.
    await page.evaluate((id) => {
      history.pushState(null, "", "/workbench/notes/" + id);
      window.dispatchEvent(new Event("popstate"));
    }, second.id);
    await expect(page.getByTestId("note-editor")).toContainText(
      "Another result",
    );
    await page
      .getByRole("button", { name: "Recent work", exact: true })
      .click();
    await page
      .locator(".workspace-recent-open")
      .filter({ hasText: "Derivation A" })
      .click();
    await expect(page.getByTestId("note-editor")).toContainText(
      "Retained tab edit.",
    );
    await page.getByTestId("note-editor").click();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("note-editor")).not.toContainText(
      "Retained tab edit.",
    );
    await page.keyboard.press("ControlOrMeta+/");
    await expect(
      page.getByRole("button", { name: "Write", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Recent work", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Open Derivation B in split view",
        exact: true,
      })
      .click();
    await expect(page.getByTestId("note-editor")).toHaveCount(2);
    await page
      .locator(".ws-document-pane")
      .last()
      .getByTestId("note-editor")
      .click();
    await page.keyboard.press("ControlOrMeta+/");
    await expect(
      page
        .locator(".ws-document-pane")
        .last()
        .getByRole("button", { name: "Source", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page
        .locator(".ws-document-pane")
        .first()
        .getByRole("button", { name: "Write", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Close split view", exact: true })
      .click();
    const contextResponse = await context.request.get(
      `/api/v1/notes/${first.id}/context`,
    );
    expect(contextResponse.ok(), await contextResponse.text()).toBeTruthy();
    await page.screenshot({ path: "data/workspace-editor-desktop.png" });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
test("project task status updates preserve details and task forms stay useful", async ({
  browser,
}) => {
  const { context, group } = await account(browser),
    page = await context.newPage();
  try {
    const response = await context.request.post("/api/v1/projects", {
      headers: { origin },
      data: { groupId: group.id, name: "Reproducible physics" },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const project = await response.json();
    const task = await (
      await context.request.post(`/api/v1/projects/${project.id}/tasks`, {
        headers: { origin },
        data: {
          title: "Check dimensions",
          body: "Preserve the dimensional argument",
          priority: "high",
          labels: ["verification"],
          estimateHours: 3,
          dueOn: "2026-12-12",
        },
      })
    ).json();
    await page.goto(`/workbench/projects/${project.id}/tasks`);
    await expect(
      page.getByRole("button", { name: "Check dimensions", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Status of Check dimensions")
      .selectOption("in_progress");
    await expect(
      page
        .getByRole("region", { name: "In progress", exact: true })
        .getByRole("button", { name: "Check dimensions", exact: true }),
    ).toBeVisible();
    const stored = await (
      await context.request.get(`/api/v1/tasks/${task.id}`)
    ).json();
    expect(stored.body).toBe("Preserve the dimensional argument");
    expect(Number(stored.estimate_hours)).toBe(3);
    expect(stored.priority).toBe("high");
    expect(stored.due_on).toBe("2026-12-12");
    expect(stored.labels).toEqual(["verification"]);
    await page
      .getByRole("button", { name: "Check dimensions", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByLabel("Details & acceptance criteria"),
    ).toHaveValue("Preserve the dimensional argument");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await page.screenshot({ path: "data/workspace-project-desktop.png" });
  } finally {
    await context.close();
  }
});
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.toUpperCase().replace(/=+$/, ""))
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(
      (bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)),
    ),
    counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest(),
    offset = digest.at(-1)! & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
test("two-step setup and recovery-code sign-in are complete without exposing session tokens", async ({
  browser,
}) => {
  const { context, email, password } = await account(browser),
    page = await context.newPage();
  try {
    await page.goto("/workbench/settings/security");
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Current password")
      .fill(password);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Continue", exact: true })
      .click();
    const secret = await page
      .getByLabel("Authenticator setup key")
      .inputValue();
    const backup = await page
      .locator(".ws-recovery-codes code")
      .first()
      .textContent();
    await page.getByLabel("I stored these codes in a safe place.").check();
    await page.getByLabel("Six-digit authenticator code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify and enable" }).click();
    await expect(
      page.getByRole("button", { name: "Disable verification", exact: true }),
    ).toBeVisible();
    const security = await (
      await context.request.get("/api/v1/me/security")
    ).json();
    expect(security.twoFactorEnabled).toBe(true);
    expect(security.sessions.every((session: any) => !session.token)).toBe(
      true,
    );
    await context.clearCookies();
    await page.goto("/workbench/home");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Enter workspace" }).click();
    await expect(
      page.getByRole("heading", { name: "One more step." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Use a recovery code instead" })
      .click();
    await page.getByLabel("Recovery code", { exact: true }).fill(backup!);
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(
      page.getByRole("navigation", { name: "Current location" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("profile photo changes refresh the toolbar, recover from failed images and preserve unsaved fields", async ({
  browser,
}, info) => {
  // Keep injected image failures observable instead of going through the offline worker.
  const { context } = await account(browser, "block"),
    page = await context.newPage();
  try {
    await page.goto("/workbench/settings/profile");
    const toolbarAvatar = page.locator(".ws-account-avatar"),
      toolbarImage = toolbarAvatar.locator("img");
    await expect(toolbarAvatar).toHaveText("AR");
    await expect(toolbarImage).toHaveCount(0);
    await page
      .getByLabel("Full name", { exact: true })
      .fill("Ada — Quantum Research");
    await page
      .getByLabel("Institution or affiliation")
      .fill("Unsaved laboratory draft");
    const photo = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#527ca0" },
    })
      .png()
      .toBuffer();
    const uploaded = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/me/avatar") &&
        response.request().method() === "POST",
    );
    await page.locator('.ws-profile-photo input[type="file"]').setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: photo,
    });
    const response = await uploaded;
    expect(response.ok()).toBeTruthy();
    const savedPhoto = await response.json();
    // The toolbar must refresh immediately, not wait for the 15-second session poll.
    await expect(toolbarImage).toHaveAttribute("src", savedPhoto.image, {
      timeout: 5000,
    });
    await expect
      .poll(() =>
        toolbarImage.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(toolbarAvatar).toHaveCSS("width", "30px");
    await expect(toolbarAvatar).toHaveCSS("height", "30px");
    await expect(toolbarAvatar).toHaveCSS("border-radius", "50%");
    await expect(toolbarImage).toHaveCSS("object-fit", "cover");
    await expect(page.getByLabel("Full name", { exact: true })).toHaveValue(
      "Ada — Quantum Research",
    );
    await expect(page.getByLabel("Institution or affiliation")).toHaveValue(
      "Unsaved laboratory draft",
    );
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await context.request.get("/api/v1/me/profile")).json()).name,
      )
      .toBe("Ada — Quantum Research");
    await page.getByLabel("Account menu", { exact: true }).click();
    await expect(page.locator(".ws-account-menu > div strong")).toHaveText(
      "Ada — Quantum Research",
      { timeout: 5000 },
    );
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByLabel("Institution or affiliation")).toHaveValue(
      "Unsaved laboratory draft",
    );
    const profile = await (
      await context.request.get("/api/v1/me/profile")
    ).json();
    await expect(toolbarImage).toHaveAttribute("src", profile.image);
    const avatar = await context.request.get(profile.image);
    expect(avatar.headers()["content-type"]).toBe("image/webp");
    expect(avatar.headers()["cache-control"]).toContain("no-store");

    // An unavailable image uses initials instead of a broken image icon.
    const avatarRoute = /\/api\/v1\/people\/[^/]+\/avatar\?/;
    let failedRequests = 0;
    await page.route(avatarRoute, (route) => {
      failedRequests++;
      return route.fulfill({ status: 404, body: "Avatar unavailable" });
    });
    await page.reload();
    await expect.poll(() => failedRequests).toBeGreaterThan(0);
    await expect(toolbarImage).toHaveCount(0);
    await expect(toolbarAvatar).toHaveText("A—");
    await page.unroute(avatarRoute);

    // Replacing a failed photo resets the fallback and uses its new versioned URL.
    const replacement = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/me/avatar") &&
        response.request().method() === "POST",
    );
    await page.locator('.ws-profile-photo input[type="file"]').setInputFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: await sharp({
        create: { width: 8, height: 8, channels: 3, background: "#a07060" },
      })
        .png()
        .toBuffer(),
    });
    const replaced = await replacement;
    expect(replaced.ok()).toBeTruthy();
    const newPhoto = await replaced.json();
    expect(newPhoto.image).not.toBe(profile.image);
    await expect(toolbarImage).toHaveAttribute("src", newPhoto.image, {
      timeout: 5000,
    });
    await expect
      .poll(() =>
        toolbarImage.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.screenshot({
      path: info.outputPath("toolbar-profile-photo.png"),
      animations: "disabled",
    });
  } finally {
    await context.close();
  }
});

test("workspace events update another window without replacing an open draft", async ({
  browser,
}) => {
  const { context, group } = await account(browser),
    page = await context.newPage();
  try {
    const response = await context.request.post("/api/v1/projects", {
      headers: { origin },
      data: { groupId: group.id, name: "Shared laboratory" },
    });
    const project = await response.json();
    await page.goto(`/workbench/projects/${project.id}/tasks`);
    await expect(
      page.getByRole("heading", { name: "Shared laboratory", exact: true }),
    ).toBeVisible();
    const remote = await browser.newContext({
      baseURL: origin,
      storageState: await context.storageState(),
    });
    try {
      const created = await remote.request.post(
        `/api/v1/projects/${project.id}/tasks`,
        {
          headers: { origin },
          data: { title: "Remote reproducibility check" },
        },
      );
      expect(created.ok(), await created.text()).toBeTruthy();
      await expect(
        page.getByRole("button", {
          name: "Remote reproducibility check",
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "Remote reproducibility check",
          exact: true,
        })
        .click();
      await page
        .getByRole("dialog")
        .getByLabel("Details & acceptance criteria")
        .fill("Keep this local draft");
      const another = await remote.request.post(
        `/api/v1/projects/${project.id}/tasks`,
        { headers: { origin }, data: { title: "Another remote task" } },
      );
      expect(another.ok()).toBeTruthy();
      await expect(
        page.getByRole("button", { name: "Another remote task", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("dialog").getByLabel("Details & acceptance criteria"),
      ).toHaveValue("Keep this local draft");
    } finally {
      await remote.close();
    }
  } finally {
    await context.close();
  }
});

test("modern workspace reloads private offline notes using only account-neutral cached shells", async ({
  browser,
  browserName,
}) => {
  test.skip(
    process.env.TEST_PRODUCTION !== "1",
    "Requires the built offline shell.",
  );
  test.skip(
    browserName === "webkit",
    "This automation build has an independently reproduced service-worker offline reload failure; real Safari is not certified.",
  );
  const { context, spaces, email } = await account(browser),
    page = await context.newPage();
  const personal = spaces.find((space: any) => space.kind === "personal");
  const phrase = "Private offline experiment " + randomUUID();
  const note = await createNote(
    context,
    personal.id,
    "Offline research",
    "# A private observation\n\n" + phrase + "\n",
  );
  try {
    await page.goto(`/workbench/notes/${note.id}`);
    await expect(page.locator(".ws-document-status")).toContainText(
      "Saved on server",
    );
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    const cacheAudit = await page.evaluate(
      async ({ phrase, email }) => {
        const names = (await caches.keys()).filter((name) =>
          name.startsWith("axiom-shell-"),
        );
        const shells: string[] = [];
        let leaked = false,
          unsafe = false;
        for (const name of names)
          for (const request of await (await caches.open(name)).keys()) {
            const path = new URL(request.url).pathname;
            if (path.startsWith("/api/") || path.includes("?")) unsafe = true;
            if (path === "/" || path === "/workbench") {
              shells.push(path);
              const html = await (await caches.match(request))!.text();
              leaked ||= html.includes(phrase) || html.includes(email);
            }
          }
        return { shells, leaked, unsafe };
      },
      { phrase, email },
    );
    expect(cacheAudit.shells).toEqual(
      expect.arrayContaining(["/", "/workbench"]),
    );
    expect(cacheAudit.leaked).toBe(false);
    expect(cacheAudit.unsafe).toBe(false);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("note-editor")).toContainText(phrase);
    await page.getByRole("button", { name: "Source", exact: true }).click();
    await page.getByTestId("note-editor").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("\nObserved while disconnected.");
    await expect(page.locator(".ws-document-status")).toContainText(
      "Saved locally · offline",
    );
    await context.setOffline(false);
    await expect(page.locator(".ws-document-status")).toContainText(
      "Saved on server",
      { timeout: 30000 },
    );
    await expect
      .poll(
        async () =>
          (await (await context.request.get(`/api/v1/notes/${note.id}`)).json())
            .body,
      )
      .toContain("Observed while disconnected.");
  } finally {
    await context.setOffline(false);
    await context.close();
  }
});
