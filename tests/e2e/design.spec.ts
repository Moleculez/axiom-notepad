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
import {
  defaults,
  modernAppearance,
  preferencesSchema,
} from "../../packages/shared/src/appearance";

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
async function fixture(
  browser: Browser,
  body = "# Research\n\nA calm space for rigorous thought. $E=mc^2$\n\n## Methods\n\nSupporting evidence.\n",
) {
  const owner = await browser.newContext({
    baseURL: origin,
    storageState: ownerState,
  });
  if (!ownerState) {
    const response = await signInOwner(owner.request, origin);
    expect(response.ok(), await response.text()).toBeTruthy();
    ownerState = await owner.storageState();
  }
  const group = await api(owner.request, "groups", {
    name: "Design verification " + randomUUID().slice(0, 8),
  });
  const invite = await api(owner.request, "invitations", {
    groupId: group.id,
    email: `design-${randomUUID()}@axiom.test`,
  });
  const member = await browser.newContext({ baseURL: origin });
  const user = await api(member.request, "register", {
    token: new URL(invite.link).searchParams.get("invite"),
    name: "Design Researcher",
    password: "AxiomDesignPassword2026!",
  });
  const note = await api(member.request, "notes", {
    groupId: group.id,
    title: "Geometry of discovery",
    body,
  });
  const page = await member.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const open = async () => {
    await page.goto("/?note=" + note.id);
    await expect(page.getByTestId("note-editor")).toBeVisible();
    await expect(
      page.getByText("Saved on server", { exact: true }),
    ).toBeVisible();
  };
  const close = async () => {
    expect(errors).toEqual([]);
    await Promise.all([owner.close(), member.close()]);
  };
  return { owner, member, group, user, note, page, open, close };
}
async function centered(page: Page) {
  // Resizing an open top-layer window settles on the next browser layout frame.
  await expect
    .poll(async () =>
      page.getByRole("dialog").evaluate((element) => {
        const box = element.getBoundingClientRect();
        return Math.max(
          Math.abs(box.x + box.width / 2 - innerWidth / 2),
          Math.abs(box.y + box.height / 2 - innerHeight / 2),
        );
      }),
    )
    .toBeLessThan(2);
  const bounds = await page.getByRole("dialog").boundingBox();
  const viewport = page.viewportSize()!;
  expect(
    Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2),
  ).toBeLessThan(2);
  expect(
    Math.abs(bounds!.y + bounds!.height / 2 - viewport.height / 2),
  ).toBeLessThan(2);
  expect(bounds!.width).toBeLessThanOrEqual(viewport.width - 16);
  expect(bounds!.height).toBeLessThanOrEqual(viewport.height - 16);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("nested TOC navigates source, caret, scrolling and deep links without changing Markdown", async ({
  browser,
}) => {
  const paragraph =
    "A reproducible argument connects its assumptions with the evidence. ".repeat(
      15,
    ) + "\n\n";
  const body = [
    "# Research",
    "## Methods",
    "#### Assumptions",
    "##### Evidence",
    "### Results",
    "## Methods",
    "# Appendix",
    "### Supplemental",
    "## References",
  ]
    .map((h) => h + "\n\n" + paragraph.repeat(3))
    .join("\n");
  const f = await fixture(browser, body),
    { page } = f;
  await f.open();
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  const heading = (name: string) =>
    toc.locator(".toc-link").filter({ hasText: new RegExp(`^${name}$`) });
  await expect(toc.locator(".toc-link")).toHaveCount(9);
  const root = await heading("Research").boundingBox(),
    child = await heading("Methods").first().boundingBox(),
    grandchild = await heading("Assumptions").boundingBox();
  expect(child!.x - root!.x).toBe(16);
  expect(grandchild!.x - child!.x).toBe(16);
  await expect(toc.locator('[aria-current="location"]')).toHaveText("Research");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const editor = page.getByTestId("note-editor");
  const original = (await api(f.member.request, `notes/${f.note.id}`)).body;
  await heading("Evidence").click();
  await expect(toc.locator('[aria-current="location"]')).toHaveText("Evidence");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const node = getSelection()?.anchorNode;
        return (node instanceof Element ? node : node?.parentElement)
          ?.closest(".native-source-line, .cm-line")
          ?.textContent?.trimEnd();
      }),
    )
    .toBe("##### Evidence");
  await editor.press("ControlOrMeta+Home");
  await expect(toc.locator('[aria-current="location"]')).toHaveText("Research");
  await editor.press("ControlOrMeta+End");
  await expect(toc.locator('[aria-current="location"]')).toHaveText(
    "References",
  );
  for (const mode of ["Write", "Source", "Read"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await heading("Research").click();
    await page
      .locator(".document-scroll")
      .hover({ position: { x: 100, y: 250 } });
    // Firefox caps an individual wheel event to roughly one viewport. Exercise
    // real wheel scrolling until the final section, without assuming a delta.
    await expect
      .poll(
        async () => {
          await page.mouse.wheel(0, 10000);
          return toc.locator('[aria-current="location"]').textContent();
        },
        { intervals: [100, 200, 300] },
      )
      .toBe("References");
    await heading("Methods").nth(1).click();
    await expect(heading("Methods").nth(1)).toHaveAttribute(
      "aria-current",
      "location",
    );
  }
  await toc.getByRole("button", { name: "Collapse all", exact: true }).click();
  await expect(heading("Evidence")).toBeHidden();
  await page.evaluate(() => {
    location.hash = "evidence";
  });
  await expect(heading("Evidence")).toBeVisible();
  await expect(heading("Evidence")).toHaveAttribute("aria-current", "location");
  await expect(
    toc.getByRole("button", { name: "Collapse Assumptions", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  const other = await api(f.member.request, "notes", {
    groupId: f.group.id,
    title: "Second outline",
    body: "## A flush root\n\n#### A real child\n",
  });
  await expect(
    toc.getByRole("button", { name: "Expand Appendix", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.evaluate((id) => {
    history.pushState(null, "", "/?note=" + id);
    dispatchEvent(new PopStateEvent("popstate"));
  }, other.id);
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue(
    "Second outline",
  );
  await page.evaluate((id) => {
    history.pushState(null, "", "/?note=" + id);
    dispatchEvent(new PopStateEvent("popstate"));
  }, f.note.id);
  await expect(
    toc.getByRole("button", { name: "Expand Appendix", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Source", exact: true }).click();
  expect((await api(f.member.request, `notes/${f.note.id}`)).body).toBe(
    original,
  );
  await page.screenshot({ path: "test-results/design-outline.png" });
  await f.close();
});

test("dialogs center, trap focus and distinguish padding, backdrop and drag gestures", async ({
  browser,
}) => {
  const f = await fixture(browser),
    { page } = f;
  await f.open();
  const opener = page.getByRole("button", {
    name: "Appearance settings",
    exact: true,
  });
  await opener.click();
  await centered(page);
  await page.screenshot({ path: "test-results/design-settings-desktop.png" });
  await expect(page.getByRole("dialog").locator("h2").first()).toHaveCSS(
    "font-family",
    /system-ui/,
  );
  await page.getByRole("button", { name: "Typography", exact: true }).click();
  await page
    .getByLabel("Note text font", { exact: true })
    .selectOption("sourceSerif");
  await expect(page.getByRole("dialog").locator("h2").first()).toHaveCSS(
    "font-family",
    /system-ui/,
  );
  await page.getByRole("button", { name: "Apply", exact: true }).focus();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(opener).toBeFocused();
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await centered(page);
  let bounds = (await page.getByRole("dialog").boundingBox())!;
  await page.mouse.click(bounds.x + 6, bounds.y + 70);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.mouse.move(bounds.x + 6, bounds.y + 70);
  await page.mouse.down();
  await page.mouse.move(2, 2);
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(page.getByRole("dialog")).toBeHidden();
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 900, height: 900 },
    { width: 768, height: 720 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await opener.click();
    await centered(page);
    await expect(
      page.getByRole("button", { name: "Apply", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeInViewport();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "New note", exact: true })
      .first()
      .click();
    await centered(page);
    await expect(
      page.getByRole("dialog").locator(".dialog-footer"),
    ).toBeInViewport();
    bounds = (await page.getByRole("dialog").boundingBox())!;
    const footer = (await page
      .getByRole("dialog")
      .locator(".dialog-footer")
      .boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(
      bounds.y + bounds.height + 1,
    );
    await page.keyboard.press("Escape");
  }
  await f.close();
});

test("modern appearance has an account-scoped revision-safe restore point and preserves custom metrics", async ({
  browser,
}) => {
  const f = await fixture(browser),
    { page } = f;
  const old = preferencesSchema.parse({
    schemaVersion: 1,
    mode: "dark",
    proseSize: 24,
    uiSize: 17,
    motion: "none",
    shadows: "none",
    readingWidth: 85,
    darkColors: { accent: "#abcdef" },
  });
  await api(
    f.member.request,
    "me/preferences",
    { preferences: old, version: 0, mutationId: randomUUID() },
    "PATCH",
  );
  await f.open();
  const opener = page.getByRole("button", {
    name: "Appearance settings",
    exact: true,
  });
  await opener.click();
  await page
    .getByRole("button", { name: "Try the modern look", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await api(f.member.request, "me/preferences")).preferences.lightPreset,
    )
    .toBe("frost");
  const saved = await api(f.member.request, "me/preferences");
  expect(saved.preferences).toEqual(modernAppearance(old));
  expect(saved.previousPreferences).toEqual(old);
  expect(
    (await api(f.owner.request, "me/preferences")).previousPreferences,
  ).not.toEqual(old);
  const stale = await f.member.request.patch("/api/v1/me/preferences", {
    headers: { origin },
    data: {
      preferences: defaults,
      version: saved.version - 1,
      mutationId: randomUUID(),
      savePrevious: true,
    },
  });
  expect(stale.status()).toBe(409);
  expect(
    (await api(f.member.request, "me/preferences")).previousPreferences,
  ).toEqual(old);
  const legacy = await f.member.request.patch("/api/v1/me/preferences", {
    headers: { origin },
    data: {
      preferences: { ...old, schemaVersion: 1 },
      version: saved.version,
      mutationId: randomUUID(),
    },
  });
  expect(legacy.status()).toBe(426);
  const another = await browser.newContext({
    baseURL: origin,
    storageState: await f.member.storageState(),
  });
  const second = await another.newPage();
  await second.goto("/?note=" + f.note.id);
  await second
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  await second
    .getByRole("button", { name: "Restore previous appearance", exact: true })
    .click();
  await second.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await api(f.member.request, "me/preferences")).preferences.uiFont,
    )
    .toBe("inter");
  const restored = await api(f.member.request, "me/preferences");
  expect(restored.preferences).toEqual(old);
  expect(restored.previousPreferences).toEqual(modernAppearance(old));
  const mutationId = randomUUID();
  const request = {
    preferences: defaults,
    version: restored.version,
    mutationId,
    savePrevious: true,
  };
  const once = await api(f.member.request, "me/preferences", request, "PATCH");
  const twice = await api(
    f.member.request,
    "me/preferences",
    { ...request, version: once.version },
    "PATCH",
  );
  expect(twice).toEqual(once);
  expect(twice.previousPreferences).toEqual(old);
  await another.close();
  await f.close();
});

test("legacy local appearance queues normalize and retain restore intent and device overrides", async ({
  browser,
}) => {
  const f = await fixture(browser),
    { page } = f;
  const old = preferencesSchema.parse({
    schemaVersion: 1,
    proseSize: 21,
    mode: "light",
    darkPreset: "midnight",
    lineHeight: 2,
  });
  const record = await api(
    f.member.request,
    "me/preferences",
    { preferences: old, version: 0, mutationId: randomUUID() },
    "PATCH",
  );
  await f.open();
  const legacy = { ...old, schemaVersion: 1 } as Record<string, unknown>;
  delete legacy.material;
  delete legacy.glassIntensity;
  await page.evaluate(
    ({ userId, record, legacy, mutationId }) => {
      localStorage.removeItem(`axiom:preferences-bundle:${userId}`); // Model an actual pre-bundle installation.
      localStorage.setItem(
        `axiom:preferences:${userId}`,
        JSON.stringify({
          base: { ...record, preferences: legacy },
          preferences: { ...legacy, proseSize: 26 },
          device: { uiScale: 1.15, panelWidth: 340 },
          mutationId,
          savePrevious: true,
        }),
      );
    },
    { userId: f.user.user.id, record, legacy, mutationId: randomUUID() },
  );
  await page.reload();
  await expect
    .poll(
      async () =>
        (await api(f.member.request, "me/preferences")).preferences.proseSize,
    )
    .toBe(26);
  const saved = await api(f.member.request, "me/preferences");
  expect(saved.preferences).toEqual({ ...old, proseSize: 26 });
  expect(saved.previousPreferences).toEqual(old);
  const cache = await page.evaluate(
    (userId) =>
      JSON.parse(localStorage.getItem(`axiom:preferences-bundle:${userId}`)!),
    f.user.user.id,
  );
  expect(cache.values.appearance.schemaVersion).toBe(2);
  expect(cache.device).toEqual({ uiScale: 1.15, panelWidth: 340 });
  expect(saved.preferences.uiScale).toBe(1);
  await f.close();
});

test("glass fallbacks, maximum text and zoom-sized windows remain usable", async ({
  browser,
  browserName,
}) => {
  const f = await fixture(browser),
    { page } = f;
  await api(
    f.member.request,
    "me/preferences",
    {
      preferences: {
        ...defaults,
        uiSize: 22,
        uiScale: 1.5,
        proseSize: 30,
        motion: "none",
      },
      version: 0,
      mutationId: randomUUID(),
    },
    "PATCH",
  );
  await f.open();
  await page
    .getByRole("button", { name: "Appearance settings", exact: true })
    .click();
  for (const viewport of [
    { width: 720, height: 500 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await centered(page);
    await expect(
      page.getByRole("button", { name: "Apply", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeInViewport();
    expect(
      await page.locator(".settings-content").evaluate((el) => el.clientHeight),
    ).toBeGreaterThan(40);
    await page.screenshot({
      path: `test-results/design-settings-${viewport.width}.png`,
    });
  }
  await page.getByText("Advanced appearance", { exact: true }).click();
  await page
    .getByLabel("Navigation surfaces", { exact: true })
    .selectOption("solid");
  await expect(page.locator(".topbar")).toHaveCSS("backdrop-filter", "none");
  await page
    .getByLabel("Navigation surfaces", { exact: true })
    .selectOption("glass");
  await page
    .getByRole("button", {
      name: "Use High contrast · light theme",
      exact: true,
    })
    .click();
  await expect(page.locator(".topbar")).toHaveCSS("backdrop-filter", "none");
  await page
    .getByRole("button", { name: "Use Frost theme", exact: true })
    .click();
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await expect(page.locator(".topbar")).toHaveCSS("backdrop-filter", "none");
  await expect
    .poll(() =>
      page
        .getByRole("dialog")
        .evaluate((element) =>
          parseFloat(getComputedStyle(element).animationDuration),
        ),
    )
    .toBeLessThanOrEqual(0.00001);
  await page.emulateMedia({ forcedColors: "none" });
  if (browserName === "chromium") {
    const cdp = await f.member.newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    });
    await expect(page.locator(".topbar")).toHaveCSS("backdrop-filter", "none");
    await cdp.detach();
  }
  await f.close();
});
