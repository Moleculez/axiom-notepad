import {
  test,
  expect,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pluginManifestSchema } from "../../packages/shared/src/plugins";
import { APPEARANCE_SCHEMA } from "../../packages/shared/src/appearance";
import { signInOwner } from "./auth";

const origin = process.env.TEST_APP_URL || "http://localhost:3004";
const JSZip = createRequire(import.meta.url)("jszip") as typeof import("jszip");
let state: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;
async function fixture(
  browser: Browser,
  bundle?: string,
  capabilities: string[] = [],
) {
  const context = await browser.newContext({
    baseURL: origin,
    storageState: state,
    viewport: { width: 1500, height: 960 },
  });
  if (!state) {
    process.env.TEST_OWNER_EMAIL = "extensions@axiom.local";
    process.env.TEST_OWNER_PASSWORD = "ExtensionsTest2026!";
    const login = await signInOwner(context.request, origin);
    expect(login.ok(), await login.text()).toBe(true);
    state = await context.storageState();
  }
  const call = async (path: string, data?: unknown, method = "POST") => {
    const response = await context.request.fetch("/api/v1/" + path, {
      method,
      headers: { origin },
      data,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const spaces = await call("spaces", undefined, "GET");
  const space = spaces.find((s: any) => s.kind === "personal");
  const registry = await call("plugins", undefined, "GET");
  let p = registry.catalog.find((p: any) => p.manifest.id === "axiom.journal");
  if (bundle) {
    const id =
      "test.extension-" +
      createHash("sha256").update(bundle).digest("hex").slice(0, 16);
    const manifest = pluginManifestSchema.parse({
      format: "axiom-plugin",
      apiVersion: 1,
      id,
      name: "Sandbox " + id.slice(-8),
      version: "1.0.0",
      description: "Isolated acceptance fixture.",
      author: "Axiom test fixture",
      license: "MIT",
      entry: "main.js",
      capabilities,
      commands: [
        {
          id: id + ".run",
          title: "Run sandbox check",
          description: "Test only",
        },
      ],
    });
    const zip = new JSZip();
    const date = new Date("2026-01-01T00:00:00Z");
    zip.file("manifest.json", JSON.stringify(manifest), { date });
    zip.file("main.js", bundle, { date });
    const response = await context.request.post("/api/v1/plugins/packages", {
      headers: { origin, "content-type": "application/zip" },
      data: await zip.generateAsync({ type: "nodebuffer" }),
    });
    expect(response.ok(), await response.text()).toBe(true);
    p = await response.json();
  }
  const existing = registry.installations.find(
    (i: any) => i.plugin_id === p.manifest.id,
  );
  const installed =
    existing?.package_hash === p.hash
      ? existing
      : await call("plugins/installations", {
          packageHash: p.hash,
          expectedRevision: existing?.revision,
        });
  let current = (await call("plugins", undefined, "GET")).installations.find(
    (i: any) => i.id === installed.id,
  );
  if (!current.enabled) {
    await call(
      "plugins/installations/" + current.id,
      { revision: current.revision, enabled: true },
      "PATCH",
    );
    current = (await call("plugins", undefined, "GET")).installations.find(
      (i: any) => i.id === current.id,
    );
  }
  const oldGrant = (await call("plugins", undefined, "GET")).grants.find(
    (g: any) => g.installation_id === current.id && g.space_id === space.id,
  );
  await call("plugins/grants", {
    installationId: current.id,
    installationRevision: current.revision,
    spaceId: space.id,
    capabilities: p.manifest.capabilities,
    grantRevision: oldGrant?.revision,
  });
  const page = await context.newPage(),
    errors: string[] = [],
    requests: string[] = [],
    logs: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") logs.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().includes("/plugin-sandbox")) requests.push(request.url());
  });
  await page.goto("/workbench/settings/extensions");
  await page.getByRole("button", { name: "Installed", exact: true }).click();
  await page
    .locator(".extension-directory-item")
    .filter({ hasText: p.manifest.name })
    .click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "Choose a workspace" });
  await chooser.getByLabel("Workspace").selectOption(space.id);
  await chooser
    .getByRole("button", { name: "Run command", exact: true })
    .click();
  return {
    context,
    page,
    space,
    current,
    call,
    errors,
    requests,
    logs,
  };
}

test("native journal panel, exact review and disable stop execution", async ({
  browser,
}) => {
  const f = await fixture(browser);
  try {
    const panel = f.page.getByRole("complementary", {
      name: "Extension inspector",
    });
    await expect(panel.getByLabel("Markdown content")).toBeVisible();
    await expect(panel.getByLabel("Markdown content")).toContainText(
      "## Today’s focus",
    );
    await expect(f.page.locator("iframe.plugin-sandbox-frame")).toHaveAttribute(
      "sandbox",
      "allow-scripts",
    );
    await panel
      .getByLabel("File name")
      .fill("Browser review " + randomUUID().slice(0, 6));
    await panel
      .getByRole("button", { name: "Prepare for review", exact: true })
      .click();
    await expect(
      panel.getByRole("button", { name: "Review proposed journal" }),
      "Current plugin panel: " + (await panel.innerText()),
    ).toBeVisible({ timeout: 10000 });
    await panel
      .getByRole("button", { name: "Review proposed journal" })
      .click();
    await expect(f.page.getByRole("dialog", { name: /review/i })).toBeVisible();
    await expect(
      f.page.getByText(/Nothing has been created|Create Research/).first(),
    ).toBeVisible();
    await f.page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog" })
      .click();
    await f.call(
      "plugins/installations/" + f.current.id,
      { revision: f.current.revision, enabled: false },
      "PATCH",
    );
    await f.page.reload();
    await expect(f.page.locator("iframe.plugin-sandbox-frame")).toHaveCount(0);
    await expect(
      f.page.getByRole("heading", {
        name: "Extensions",
        level: 1,
        exact: true,
      }),
    ).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally {
    await f.context.close();
  }
});

test("opaque worker blocks DOM, storage, network and remote imports", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    [
      "export default {async run(api){",
      "const violations=[];addEventListener('securitypolicyviolation',e=>violations.push(e.effectiveDirective));",
      "const checks=[];const add=(name,blocked)=>checks.push({kind:'text',text:name+': '+(blocked?'blocked':'FAILED')});",
      "add('DOM',typeof document==='undefined');add('Parent',typeof parent==='undefined');",
      "add('Streaming APIs',['EventSource','WebTransport'].every(n=>globalThis[n]===undefined&&Object.getOwnPropertyDescriptor(globalThis,n)?.configurable===false));",
      "add('Child workers',['Worker','SharedWorker'].every(n=>globalThis[n]===undefined&&Object.getOwnPropertyDescriptor(globalThis,n)?.writable===false));",
      "try{await new Promise((resolve,reject)=>{const r=indexedDB.open('test');r.onsuccess=resolve;r.onerror=()=>reject(r.error);});add('Storage',false);}catch{add('Storage',true);}",
      "try{await fetch('https://extensions-network-test.invalid/probe');add('Fetch',false);}catch{add('Fetch',true);}",
      "try{const blocked=await new Promise(resolve=>{const s=new WebSocket('wss://extensions-network-test.invalid');s.onerror=()=>resolve(true);s.onopen=()=>{s.close();resolve(false);};setTimeout(()=>resolve(false),1000);});add('WebSocket',blocked);}catch{add('WebSocket',true);}",
      "try{await import('https://extensions-network-test.invalid/probe.js');add('Import',false);}catch{add('Import',true);}",
      "await new Promise(resolve=>setTimeout(resolve,100));if(violations.some(v=>v.startsWith('connect-src'))&&violations.some(v=>v.startsWith('script-src')))checks.push({kind:'text',text:'CSP directives confirmed in worker'});",
      "await api.render({title:'Isolation check',blocks:checks});}};",
    ].join("\n"),
  );
  try {
    const panel = f.page.getByRole("complementary", {
      name: "Extension inspector",
    });
    for (const name of [
      "DOM",
      "Parent",
      "Streaming APIs",
      "Child workers",
      "Storage",
      "Fetch",
      "WebSocket",
      "Import",
    ])
      await expect(
        panel.getByText(name + ": blocked", { exact: true }),
        f.logs.join("\n"),
      ).toBeVisible();
    await expect(panel.getByText(/FAILED/)).toHaveCount(0);
    // Worker CSP events are delivered to different realms across browsers.
    // Inspect browser-reported directive violations, not just rejected fetches
    // (which could also result from DNS or CORS).
    await expect
      .poll(
        async () =>
          (await panel
            .getByText("CSP directives confirmed in worker", { exact: true })
            .count()) > 0 ||
          (f.logs.some((m) => m.includes("connect-src")) &&
            f.logs.some((m) => m.includes("script-src"))),
      )
      .toBe(true);
    expect(f.errors).toEqual([]);
  } finally {
    await f.context.close();
  }
});

test("package/category switches retain configuration; one exit guard and stale saves stay safe", async ({
  browser,
}) => {
  const f = await fixture(
    browser,
    "export default {async run(api){await api.render({title:'Draft retention',blocks:[{kind:'text',text:'Native configuration fixture'}]});}};",
  );
  try {
    await expect(
      f.page.getByText("Native configuration fixture", { exact: true }),
    ).toBeVisible();
    await f.page.getByRole("button", { name: "Close extension panel" }).click();
    const shortcut = f.page.getByLabel("Run sandbox check shortcut", {
      exact: true,
    });
    await shortcut.fill("Mod-k");
    await f.page
      .getByRole("button", { name: "Available", exact: true })
      .click();
    await f.page
      .locator(".extension-directory-item")
      .filter({ hasText: "Research Journal" })
      .first()
      .click();
    await f.page
      .getByRole("button", { name: "Installed", exact: true })
      .click();
    await f.page
      .locator(".extension-directory-item")
      .filter({ hasText: f.current.manifest.name })
      .click();
    await expect(shortcut).toHaveValue("Mod-k");
    await f.page.getByRole("link", { name: "Profile", exact: true }).click();
    await f.page.getByRole("link", { name: "Extensions", exact: true }).click();
    await expect(shortcut).toHaveValue("Mod-k");
    await f.page
      .getByRole("button", { name: "Back to workspace", exact: true })
      .click();
    const guard = f.page.getByRole("dialog", {
      name: "Keep your unsaved settings?",
    });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Stay in settings" }).click();
    await f.page.getByRole("button", { name: "Save configuration" }).click();
    await expect(
      f.page.getByText(/Reserved by the workspace|Already used by/),
    ).toBeVisible();
    await shortcut.fill("Alt-Shift-F9");
    await f.page
      .getByRole("switch", { name: "Enabled for your account" })
      .click();
    await expect(
      f.page.getByRole("switch", { name: "Enabled for your account" }),
    ).not.toBeChecked();
    await expect(
      f.page.getByText("This installation changed while you were editing.", {
        exact: false,
      }),
    ).toBeVisible();
    await f.page.getByRole("button", { name: "Save configuration" }).click();
    await expect(
      f.page.getByText("The installation changed. Refresh before saving.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(shortcut).toHaveValue("Alt-Shift-F9");
    await f.page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(shortcut).toHaveValue("");
    await expect(
      f.page.getByRole("button", { name: "Save configuration" }),
    ).toBeDisabled();
    expect(f.errors).toEqual([]);
  } finally {
    await f.context.close();
  }
});

test("one inspector owner preserves extension and assistant drafts", async ({
  browser,
}) => {
  const f = await fixture(browser);
  try {
    const extension = f.page.getByRole("complementary", {
        name: "Extension inspector",
      }),
      assistant = f.page.getByRole("complementary", {
        name: "Workspace research assistant",
      });
    await expect(extension.getByLabel("Markdown content")).toBeVisible();
    await extension
      .getByLabel("Markdown content")
      .fill("# Retained extension draft\n\nNot applied.\n");
    await f.page
      .getByRole("button", { name: "Open research assistant" })
      .click();
    await expect(assistant).toBeVisible();
    await expect(extension).toBeHidden();
    await assistant
      .getByLabel("Assistant request")
      .fill("An unsent assistant draft.");
    await f.page.getByRole("button", { name: "Search workspace" }).click();
    await f.page
      .getByRole("combobox", { name: "Global search" })
      .fill("> Show extension inspector");
    await f.page
      .getByRole("option", { name: /Show extension inspector/ })
      .click();
    await expect(extension).toBeVisible();
    await expect(assistant).toBeHidden();
    await expect(extension.getByLabel("Markdown content")).toHaveValue(
      "# Retained extension draft\n\nNot applied.\n",
    );
    await f.page
      .getByRole("button", { name: "Open research assistant" })
      .click();
    await expect(assistant.getByLabel("Assistant request")).toHaveValue(
      "An unsent assistant draft.",
    );
    await expect(extension).toBeHidden();
    expect(f.errors).toEqual([]);
  } finally {
    await f.context.close();
  }
});

test("runaway worker terminates without freezing application navigation", async ({
  browser,
}) => {
  const f = await fixture(browser, "export default {run(){while(true){}}};");
  try {
    await expect(
      f.page.getByText("Extension stopped responding and was terminated."),
    ).toBeVisible({ timeout: 15000 });
    await f.page.getByRole("button", { name: "Search workspace" }).click();
    await expect(f.page.getByRole("dialog", { name: /Search/ })).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally {
    await f.context.close();
  }
});

for (const [label, bundle, message] of [
  [
    "oversized payload",
    "export default {run(){postMessage({type:'render',id:1,panel:'x'.repeat(9*1024*1024)});}}",
    "Extension message is too large.",
  ],
  [
    "sparse array",
    "export default {run(){postMessage({type:'render',id:1,panel:new Array(100001)});}}",
    "Extension array exceeds its structure budget.",
  ],
  [
    "message flood",
    "export default {run(){for(let i=0;i<120;i++)postMessage({type:'heartbeat'});}}",
    "Extension message rate exceeded.",
  ],
] as const)
  test(`trusted relay stops ${label} before native UI interpretation`, async ({
    browser,
  }) => {
    const f = await fixture(browser, bundle);
    try {
      await expect(f.page.getByText(message, { exact: false })).toBeVisible({
        timeout: 15000,
      });
      await expect(f.page.locator("iframe.plugin-sandbox-frame")).toHaveCount(
        0,
      );
      await f.page.getByRole("button", { name: "Search workspace" }).click();
      await expect(
        f.page.getByRole("dialog", { name: /Search/ }),
      ).toBeVisible();
      expect(f.errors).toEqual([]);
    } finally {
      await f.context.close();
    }
  });

test("matched frames keep footers visible in all interface styles and large text", async ({
  browser,
}) => {
  const f = await fixture(browser);
  try {
    await f.page.getByRole("button", { name: "Close extension panel" }).click();
    for (const mode of ["light", "dark"])
      for (const interfaceStyle of [
        "axiom",
        "material",
        "fluent",
        "editorial",
        "macos",
      ]) {
        const record = await (
          await f.context.request.get("/api/v1/me/preferences", {
            headers: { "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA) },
          })
        ).json();
        const response = await f.context.request.patch(
          "/api/v1/me/preferences",
          {
            headers: {
              origin,
              "X-Axiom-Appearance-Schema": String(APPEARANCE_SCHEMA),
            },
            data: {
              version: record.version,
              mutationId: randomUUID(),
              preferences: {
                ...record.preferences,
                mode,
                interfaceStyle,
                uiSize: 20,
                radius: 0,
                shadows: "none",
              },
            },
          },
        );
        expect(response.ok(), await response.text()).toBe(true);
        // Wait for the application and its actual theme, not unrelated load
        // events from background streams or optional runtime assets.
        await f.page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
        await expect(
          f.page.getByRole("region", { name: "Extension details" }),
        ).toBeVisible();
        await expect(f.page.locator("html")).toHaveAttribute(
          "data-interface-style",
          interfaceStyle,
        );
        await expect(f.page.locator("html")).toHaveAttribute(
          "data-theme",
          mode,
        );
        const geometry = await f.page
          .locator(".extensions-layout")
          .evaluate((e) => ({
            bottom: e.getBoundingClientRect().bottom,
            viewport: window.innerHeight,
          }));
        expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.bottom).toBeGreaterThan(geometry.viewport - 100);
        if (["axiom", "editorial", "fluent"].includes(interfaceStyle))
          await f.page.screenshot({
            path:
              "test-results/plugins/" +
              test.info().project.name +
              "-" +
              interfaceStyle +
              "-" +
              mode +
              ".png",
          });
      }
    await f.page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await f.page
      .getByRole("button", { name: "Available", exact: true })
      .focus();
    await expect(
      f.page.getByRole("button", { name: "Available", exact: true }),
    ).toBeFocused();
    await f.page.screenshot({
      path:
        "test-results/plugins/" + test.info().project.name + "-settings.png",
    });
    expect(f.errors).toEqual([]);
  } finally {
    await f.context.close();
  }
});
