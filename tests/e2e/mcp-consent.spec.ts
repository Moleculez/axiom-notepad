import { expect, test, type Page } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  appearanceVariables,
  defaults,
} from "../../packages/shared/src/appearance";
import { interfaceStyles } from "../../packages/shared/src/interface-styles";
import { origin } from "./native-editor-helpers";
import { signInOwner } from "./auth";

const requestedScope =
  "openid offline_access workspace:read workspace:write workspace:manage";

async function consentGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(
      ".connection-consent-panel",
    )!;
    const footer = document.querySelector<HTMLElement>(
      ".connection-consent-footer",
    )!;
    const body = document.querySelector<HTMLElement>(
      ".connection-consent-body",
    )!;
    const footerBox = footer.getBoundingClientRect();
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(".connection-choice"),
    ).map((row) => {
      const checkbox = row
        .querySelector<HTMLInputElement>("input")!
        .getBoundingClientRect();
      const title = row.querySelector("strong")!;
      const range = document.createRange();
      range.setStart(title.firstChild!, 0);
      range.setEnd(title.firstChild!, 1);
      const text = range.getBoundingClientRect();
      return {
        alignment: Math.abs(
          (checkbox.top + checkbox.bottom) / 2 - (text.top + text.bottom) / 2,
        ),
        overlap: checkbox.right > text.left,
        clipped: row.scrollWidth > row.clientWidth + 1,
      };
    });
    return {
      panelClipped: panel.scrollWidth > panel.clientWidth + 1,
      pageClipped: document.documentElement.scrollWidth > innerWidth + 1,
      pageScrolls: document.documentElement.scrollHeight > innerHeight + 1,
      footerVisible: footerBox.top >= 0 && footerBox.bottom <= innerHeight,
      bodyScrolls: getComputedStyle(body).overflowY === "auto",
      rows,
    };
  });
  expect(geometry.panelClipped).toBe(false);
  expect(geometry.pageClipped).toBe(false);
  expect(geometry.pageScrolls).toBe(false);
  expect(geometry.footerVisible).toBe(true);
  expect(geometry.bodyScrolls).toBe(true);
  expect(
    geometry.rows.filter(
      (row) => row.overlap || row.clipped || row.alignment >= 4,
    ),
  ).toEqual([]);
  const footer = page.locator(".connection-consent-footer");
  const before = (await footer.boundingBox())!;
  await page
    .getByRole("region", { name: "Connection access details" })
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  expect(Math.abs((await footer.boundingBox())!.y - before.y)).toBeLessThan(1);
}

test("MCP consent aligns native choices, preserves filtered selection and fixes footer ownership across styles", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const spaces = Array.from({ length: 24 }, (_, index) => ({
    id: randomUUID(),
    name:
      index === 0
        ? "Quantum materials and collaborative computational physics research"
        : `Research workspace ${index}`,
    kind: index === 0 ? "team" : "personal",
    role: index === 0 ? "editor" : "viewer",
  }));
  const client = {
    name: "Research assistant for collaborative mathematical and scientific discovery",
    client_id: "client-" + "a".repeat(110),
    uri: "https://assistant.example.test/" + "research-".repeat(22),
  };
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      json: {
        user: { id: randomUUID(), email: "researcher@consent.example.test" },
        groups: [],
      },
    }),
  );
  await page.route("**/api/v1/spaces", (route) =>
    route.fulfill({ json: spaces }),
  );
  await page.route("**/api/v1/connections/client?*", (route) =>
    route.fulfill({ json: client }),
  );
  const params = new URLSearchParams({
    client_id: client.client_id,
    scope: requestedScope,
  });
  await page.goto(`/connect?${params}`);
  const allow = page.getByRole("button", {
    name: "Allow connection",
    exact: true,
  });
  const deny = page.getByRole("button", { name: "Deny", exact: true });
  await expect(allow).toBeDisabled();
  const workspace = page.getByRole("checkbox", {
    name: spaces[0].name,
    exact: true,
  });
  await workspace.focus();
  await page.keyboard.press("Space");
  await expect(workspace).toBeChecked();
  await expect(allow).toBeEnabled();
  const search = page.getByRole("searchbox", {
    name: "Find a workspace to share",
  });
  await search.fill("No workspace matches this phrase");
  await expect(
    page.getByText("No matching workspaces. Try another search."),
  ).toBeVisible();
  await expect(page.locator(".connection-selected-count")).toHaveText(
    "1 workspace selected",
  );
  await expect(allow).toBeEnabled();
  await page.getByRole("button", { name: "Clear workspace search" }).click();
  await expect(workspace).toBeChecked();
  const read = page.getByRole("checkbox", {
    name: "Read files and research",
    exact: true,
  });
  const manage = page.getByRole("checkbox", {
    name: "Manage groups and workspaces",
    exact: true,
  });
  await expect(read).toBeChecked();
  await expect(read).toBeDisabled();
  await manage.uncheck();

  for (const { id } of interfaceStyles) {
    for (const mode of ["light", "dark"] as const) {
      await page.setViewportSize({
        width: mode === "dark" ? 1100 : 1440,
        height: 900,
      });
      const variables = appearanceVariables(
        {
          ...defaults,
          interfaceStyle: id,
          mode,
          uiSize: mode === "dark" ? 22 : 15,
          radius: 0,
          shadows: "none",
          motion: "none",
        },
        mode === "dark",
      );
      await page.evaluate(
        ({ variables, id, mode }) => {
          const root = document.documentElement;
          Object.entries(variables).forEach(([key, value]) =>
            root.style.setProperty(key, value),
          );
          root.dataset.interfaceStyle = id;
          root.dataset.theme = mode;
          root.dataset.motion = "none";
          root.style.colorScheme = mode;
          document.querySelector<HTMLElement>(
            ".connection-consent-body",
          )!.scrollTop = 0;
        },
        { variables, id, mode },
      );
      await expect(page.locator(".connection-consent-panel")).toHaveCSS(
        "border-radius",
        "0px",
      );
      await expect(page.locator(".connection-choice").first()).toHaveCSS(
        "font-size",
        mode === "dark" ? "22px" : "15px",
      );
      await expect
        .poll(() =>
          page
            .locator(".connection-choice-copy strong")
            .evaluateAll((titles) => [
              ...new Set(
                titles.map((title) => getComputedStyle(title).fontSize),
              ),
            ]),
        )
        .toEqual([mode === "dark" ? "22px" : "15px"]);
      await expect(
        page.locator(".connection-choice-copy strong").first(),
      ).toHaveCSS(
        "color",
        await page.evaluate((color) => {
          const sample = document.createElement("span");
          sample.style.color = color;
          return sample.style.color;
        }, variables["--text"]),
      );
      await page.evaluate(() => document.fonts.ready);
      await consentGeometry(page);
      await page
        .getByRole("region", { name: "Connection access details" })
        .evaluate((element) => {
          element.scrollTop = 0;
        });
      await allow.focus();
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: info.outputPath(`mcp-consent-${id}-${mode}.png`),
      });
    }
  }
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await manage.focus();
  await expect(manage).toBeFocused();
  await page.keyboard.press("Space");
  await expect(manage).toBeChecked();
  await page.keyboard.press("Space");
  await expect(manage).not.toBeChecked();
  await consentGeometry(page);
  await page.screenshot({
    path: info.outputPath("mcp-consent-forced-colors.png"),
  });
  await page.emulateMedia({ forcedColors: "none" });

  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let grants = 0;
  const grantBodies: unknown[] = [];
  const decisions: { accept: boolean; scope: string; oauth_query: string }[] =
    [];
  await page.route("**/api/v1/connections/consent", async (route) => {
    grants++;
    grantBodies.push(route.request().postDataJSON());
    if (grants === 1) {
      await hold;
      await route.fulfill({
        status: 503,
        json: { error: "Connection interrupted. Try again." },
      });
    } else await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/auth/oauth2/consent", (route) => {
    decisions.push(route.request().postDataJSON());
    return route.fulfill({ json: { url: `${origin}/consent-test-return` } });
  });
  await page.route("**/consent-test-return", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "Authorization returned to the client.",
    }),
  );
  await allow.focus();
  const idle = (await allow.boundingBox())!;
  try {
    await page.keyboard.press("Enter");
    await expect(allow).toHaveAttribute("aria-busy", "true");
    await expect(deny).toBeDisabled();
    await expect(workspace).toBeDisabled();
    await expect(manage).toBeDisabled();
    expect((await allow.boundingBox())!.width).toBeCloseTo(idle.width, 1);
    expect(decisions).toHaveLength(0);
  } finally {
    release();
  }
  await expect(
    page.locator(".connection-consent-footer").getByRole("alert"),
  ).toContainText("Connection interrupted. Try again.");
  await expect(workspace).toBeChecked();
  await expect(manage).not.toBeChecked();
  await expect(allow).toBeEnabled();
  await consentGeometry(page);
  await allow.click();
  await page.waitForURL("**/consent-test-return");
  expect(grantBodies[1]).toMatchObject({
    clientId: client.client_id,
    spaceIds: [spaces[0].id],
    scopes: ["workspace:read", "workspace:write"],
  });
  expect(decisions[0]).toEqual({
    accept: true,
    scope: "workspace:read workspace:write openid offline_access",
    oauth_query: params.toString(),
  });
  await page.goto(`/connect?${params}`);
  await expect(allow).toBeDisabled();
  await deny.click();
  await page.waitForURL("**/consent-test-return");
  expect(decisions[1].accept).toBe(false);
  expect(grants).toBe(2);
  expect(errors).toEqual([]);
});

test("MCP consent keeps real signed OAuth, narrowed grants and denial intact", async ({
  browser,
  playwright,
}, info) => {
  test.setTimeout(120000);
  const context = await browser.newContext({
    baseURL: origin,
    serviceWorkers: "block",
  });
  const external = await playwright.request.newContext({ baseURL: origin });
  try {
    const signedIn = await signInOwner(context.request, origin);
    expect(signedIn.ok(), await signedIn.text()).toBe(true);
    const groupResponse = await context.request.post("/api/v1/groups", {
      headers: { origin },
      data: { name: `Consent acceptance ${randomUUID().slice(0, 8)}` },
    });
    expect(groupResponse.ok(), await groupResponse.text()).toBe(true);
    const group = await groupResponse.json();
    const spaces = await (await context.request.get("/api/v1/spaces")).json();
    const space = spaces.find(
      (value: { group_id: string; kind: string }) =>
        value.group_id === group.id && value.kind === "team",
    );
    const registration = await external.post("/api/auth/oauth2/register", {
      data: {
        client_name: "Consent acceptance client",
        application_type: "native",
        redirect_uris: ["http://127.0.0.1:8591/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: requestedScope,
      },
    });
    expect(registration.ok(), await registration.text()).toBe(true);
    const client = await registration.json();
    const page = await context.newPage();
    await page.route("http://127.0.0.1:8591/callback**", (route) =>
      route.fulfill({ body: "Returned to client." }),
    );
    for (const accept of [true, false]) {
      const verifier = randomBytes(32).toString("base64url");
      const state = randomUUID();
      const params = new URLSearchParams({
        client_id: client.client_id,
        response_type: "code",
        redirect_uri: "http://127.0.0.1:8591/callback",
        scope: requestedScope,
        resource: `${origin}/mcp`,
        state,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      });
      const authorization = await context.request.get(
        `/api/auth/oauth2/authorize?${params}`,
        { maxRedirects: 0 },
      );
      expect(authorization.status(), await authorization.text()).toBe(302);
      await page.goto(authorization.headers().location);
      if (accept) {
        await page
          .getByRole("checkbox", { name: space.name, exact: true })
          .check();
        await page
          .getByRole("checkbox", {
            name: "Manage groups and workspaces",
            exact: true,
          })
          .uncheck();
        for (const mode of ["light", "dark"] as const) {
          const variables = appearanceVariables(
            { ...defaults, mode },
            mode === "dark",
          );
          await page.evaluate(
            ({ variables, mode }) => {
              Object.entries(variables).forEach(([key, value]) =>
                document.documentElement.style.setProperty(key, value),
              );
              document.documentElement.dataset.theme = mode;
              document.documentElement.style.colorScheme = mode;
            },
            { variables, mode },
          );
          await page
            .getByRole("button", { name: "Allow connection", exact: true })
            .focus();
          await page.mouse.move(0, 0);
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({
            path: info.outputPath(`mcp-consent-current-${mode}.png`),
          });
        }
        await page
          .getByRole("button", { name: "Allow connection", exact: true })
          .click();
      } else
        await page.getByRole("button", { name: "Deny", exact: true }).click();
      await page.waitForURL("http://127.0.0.1:8591/callback**");
      const callback = new URL(page.url());
      expect(callback.searchParams.get("state")).toBe(state);
      if (!accept) {
        expect(callback.searchParams.get("error")).toBe("access_denied");
        expect(callback.searchParams.has("code")).toBe(false);
        continue;
      }
      expect(callback.searchParams.get("error")).toBeNull();
      const tokenResponse = await external.post("/api/auth/oauth2/token", {
        form: {
          grant_type: "authorization_code",
          code: callback.searchParams.get("code")!,
          code_verifier: verifier,
          client_id: client.client_id,
          redirect_uri: "http://127.0.0.1:8591/callback",
          resource: `${origin}/mcp`,
        },
      });
      expect(tokenResponse.ok(), await tokenResponse.text()).toBe(true);
      const token = await tokenResponse.json();
      expect(token.scope.split(" ")).toContain("workspace:read");
      expect(token.scope.split(" ")).not.toContain("workspace:manage");
      const connections = await (
        await context.request.get("/api/v1/connections")
      ).json();
      expect(
        connections.connections.find(
          (value: { client_id: string }) =>
            value.client_id === client.client_id,
        ),
      ).toMatchObject({
        space_ids: [space.id],
        scopes: ["workspace:read", "workspace:write"],
      });
    }
  } finally {
    await context.close();
    await external.dispose();
  }
});

test("MCP consent explains unavailable workspaces and never enables approval without a selection", async ({
  page,
}) => {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      json: { user: { email: "researcher@consent.example.test" }, groups: [] },
    }),
  );
  await page.route("**/api/v1/spaces", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/connections/client?*", (route) =>
    route.fulfill({
      json: { name: "Read-only research client", client_id: "read-only" },
    }),
  );
  await page.goto("/connect?client_id=read-only&scope=workspace:read");
  await expect(
    page.getByText("No accessible workspaces are available for this account."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Allow connection", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Deny", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".connection-permissions input")).toHaveCount(1);
  await expect(page.locator(".connection-session-access")).toHaveCount(0);
  await consentGeometry(page);
});
