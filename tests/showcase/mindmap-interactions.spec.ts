import { test, expect, type Page } from "@playwright/test";
import { mindmapId } from "../../apps/showcase/src/samples";

// Disposable guest contexts only; never authenticate, call APIs or edit dev data.
const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, baseURL }) => {
  const entries: string[] = [];
  failures.set(page, entries);
  page.on("pageerror", (error) => entries.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (
      /^https?:/.test(url) &&
      (!url.startsWith(new URL(baseURL!).origin) ||
        /\/api\/|\/sync(?:\b|\/)|\.env/.test(url))
    )
      entries.push(url);
  });
  page.on("websocket", (socket) => entries.push(socket.url()));
});
test.afterEach(async ({ page }) => expect(failures.get(page)).toEqual([]));

async function start(page: Page) {
  await page.goto(`./#mindmap&note=${mindmapId}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("tree", { name: "Markdown hierarchy" }),
  ).toBeVisible();
}
async function source(page: Page): Promise<string> {
  return page.evaluate(
    (id) =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("axiom-showcase-v1", 1);
        request.onsuccess = () => {
          const database = request.result;
          const item = database
            .transaction("documents", "readonly")
            .objectStore("documents")
            .get(id);
          item.onsuccess = () => {
            resolve(item.result?.source ?? "");
            database.close();
          };
          item.onerror = () => {
            reject(item.error);
            database.close();
          };
        };
        request.onerror = () => reject(request.error);
      }),
    mindmapId,
  );
}
async function openSource(page: Page) {
  const toggle = page.getByRole("button", { name: "Source", exact: true });
  if ((await toggle.getAttribute("aria-pressed")) !== "true")
    await toggle.click();
  await expect(page.locator(".mindmap-source-pane")).toBeVisible();
}
async function replaceSource(page: Page, value: string) {
  await openSource(page);
  await page.locator(".mindmap-source-pane .cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(value);
  await expect.poll(() => source(page)).toBe(value);
  await page
    .getByRole("button", { name: "Close map source", exact: true })
    .click();
}

test("modifier deselection keeps the remaining active task and shortcut target", async ({
  page,
}) => {
  await start(page);
  const original = "# Root\n\n- [ ] Alpha\n- [ ] Beta\n- [ ] Gamma\n";
  await replaceSource(page, original);
  const alpha = page.getByRole("treeitem", {
    name: "Incomplete task: Alpha",
    exact: true,
  });
  const beta = page.getByRole("treeitem", {
    name: "Incomplete task: Beta",
    exact: true,
  });
  const gamma = page.getByRole("treeitem", {
    name: "Incomplete task: Gamma",
    exact: true,
  });
  await alpha.click();
  await beta.click({ modifiers: ["ControlOrMeta"] });
  await gamma.click({ modifiers: ["ControlOrMeta"] });
  await beta.click({ modifiers: ["ControlOrMeta"] });
  await expect(alpha).toHaveAttribute("aria-selected", "true");
  await expect(gamma).toHaveAttribute("aria-selected", "true");
  await expect(beta).toHaveAttribute("aria-selected", "false");
  await expect(gamma).toBeFocused();
  await gamma.click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator('.mindmap-node[aria-selected="true"]')).toHaveCount(
    1,
  );
  await expect(alpha).toHaveAttribute("aria-selected", "true");
  await expect(alpha).toBeFocused();
  await alpha.press("t");
  await expect
    .poll(() => source(page))
    .toBe(original.replace("[ ] Alpha", "[x] Alpha"));
  await page
    .getByRole("button", { name: "Undo map edit", exact: true })
    .click();
  await expect.poll(() => source(page)).toBe(original);
});

test("reverse search starts at the last match and wraps without changing source", async ({
  page,
}) => {
  await start(page);
  const original = "# Root\n\n- Match Alpha\n- Match Beta\n- Match Gamma\n";
  await replaceSource(page, original);
  const search = page.getByRole("searchbox", { name: "Find in mind map" });
  await search.fill("Match");
  await search.press("Shift+Enter");
  await expect(
    page.getByRole("treeitem", { name: "Match Gamma", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
  await expect(
    page.getByRole("treeitem", { name: "Match Alpha", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => source(page)).toBe(original);
});

test("unapplied labels survive mode and link navigation until explicitly accepted", async ({
  page,
}) => {
  await start(page);
  const original = "# Root\n\n- Alpha\n- Beta\n";
  await replaceSource(page, original);
  await page.getByRole("treeitem", { name: "Alpha", exact: true }).dblclick();
  const field = page.getByRole("textbox", {
    name: "Edit map node label",
    exact: true,
  });
  await field.fill("Applied label");
  await page.getByRole("button", { name: "Document", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Keep your node edit?",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(field).toHaveValue("Applied label");
  await expect.poll(() => source(page)).toBe(original);
  await page.getByRole("button", { name: "Document", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Apply and leave", exact: true })
    .click();
  await expect(page.locator(".mindmap-surface")).toHaveCount(0);
  await expect
    .poll(() => source(page))
    .toBe(original.replace("Alpha", "Applied label"));
  await page.getByRole("button", { name: "Mind map", exact: true }).click();
  await page
    .getByRole("treeitem", { name: "Applied label", exact: true })
    .dblclick();
  await field.fill("Discarded draft");
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page.locator(".mindmap-surface")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Discard and leave", exact: true })
    .click();
  await expect(page.locator(".mindmap-surface")).toHaveCount(0);
  await expect
    .poll(() => source(page))
    .toBe(original.replace("Alpha", "Applied label"));
});

test("browser history preserves a dirty label and conflicting source never gets overwritten", async ({
  page,
}) => {
  await start(page);
  const original = "# Root\n\n- Alpha\n- Beta\n";
  await replaceSource(page, original);
  await page.getByRole("button", { name: "Document", exact: true }).click();
  await page.getByRole("button", { name: "Mind map", exact: true }).click();
  await page.getByRole("treeitem", { name: "Alpha", exact: true }).dblclick();
  const field = page.getByRole("textbox", {
    name: "Edit map node label",
    exact: true,
  });
  await field.fill("Unapplied history label");
  await page.evaluate(() => history.back());
  const dialog = page.getByRole("dialog", {
    name: "Keep your node edit?",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".mindmap-surface")).toBeVisible();
  await dialog.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(field).toHaveValue("Unapplied history label");
  await openSource(page);
  await page.locator(".mindmap-source-pane .cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(
    original.replace("Alpha", "Changed elsewhere"),
  );
  await expect
    .poll(() => source(page))
    .toBe(original.replace("Alpha", "Changed elsewhere"));
  await page.getByRole("button", { name: "Document", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Apply and leave", exact: true })
    .click();
  await expect(dialog).toContainText("changed elsewhere");
  await expect(
    dialog.getByRole("textbox", { name: "Unsaved node label" }),
  ).toHaveValue("Unapplied history label");
  await expect
    .poll(() => source(page))
    .toBe(original.replace("Alpha", "Changed elsewhere"));
  await dialog.getByRole("button", { name: "Stay", exact: true }).click();
});

test("accepting one draft rechecks the next navigation blocker", async ({
  page,
}) => {
  await start(page);
  const original = "# Root\n\n- Alpha\n";
  await replaceSource(page, original);
  await page.getByRole("treeitem", { name: "Alpha", exact: true }).dblclick();
  await page
    .getByRole("textbox", { name: "Edit map node label" })
    .fill("Saved first draft");
  await page.evaluate(() => {
    const state = window as typeof window & {
      secondDraftProceed?: () => void;
      secondDraftCount?: number;
    };
    window.addEventListener("axiom:before-navigate", (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      state.secondDraftCount = (state.secondDraftCount ?? 0) + 1;
      state.secondDraftProceed = (
        event as CustomEvent<{ proceed: () => void }>
      ).detail.proceed;
    });
  });
  await page.getByRole("button", { name: "Document", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Keep your node edit?" })
    .getByRole("button", { name: "Apply and leave", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { secondDraftCount?: number })
            .secondDraftCount,
      ),
    )
    .toBe(1);
  await expect(page.locator(".mindmap-surface")).toBeVisible();
  await expect
    .poll(() => source(page))
    .toBe(original.replace("Alpha", "Saved first draft"));
  await page.evaluate(() =>
    (
      window as typeof window & { secondDraftProceed?: () => void }
    ).secondDraftProceed?.(),
  );
  await expect(page.locator(".mindmap-surface")).toHaveCount(0);
});

test("stationary edge panning refreshes the branch under the pointer", async ({
  page,
}) => {
  await start(page);
  const original =
    "# Root\n\n- Parent\n  - Child\n- Target Alpha\n- Target Beta\n- Target Gamma\n";
  await replaceSource(page, original);
  await page
    .getByRole("button", { name: "Reset zoom to 100 percent", exact: true })
    .click();
  const viewport = (await page.locator(".mindmap-viewport").boundingBox())!;
  const alpha = page.getByRole("treeitem", {
    name: "Target Alpha",
    exact: true,
  });
  const before = (await alpha.boundingBox())!;
  const y = viewport.y + viewport.height - 18;
  await page.mouse.move(viewport.x + 24, viewport.y + 24);
  await page.mouse.down();
  await page.mouse.move(
    viewport.x + 24,
    viewport.y + 24 + y - before.y - before.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  const target = (await alpha.boundingBox())!;
  const child = (await page
    .getByRole("treeitem", { name: "Child", exact: true })
    .boundingBox())!;
  const x = target.x + target.width / 2;
  await page.mouse.move(child.x + child.width / 2, child.y + child.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 5 });
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ x, y }) => {
            const node = document
              .elementFromPoint(x, y)
              ?.closest<HTMLElement>("[data-map-node]");
            return (
              node?.getAttribute("aria-label") === "Target Beta" &&
              !!node.dataset.mapDrop
            );
          },
          { x, y },
        ),
      { timeout: 6000, intervals: [20, 20, 40] },
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(() => source(page)).toBe(original);
});

test("adding a branch from research results reveals its ordinary label editor", async ({
  page,
}) => {
  await start(page);
  const original =
    "# Root\n\n## Methods\n\n$$x^2$$\n\n## Other work\n\nUnrelated paragraph\n";
  await replaceSource(page, original);
  await page
    .getByRole("button", { name: "Research lens", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Equations", exact: true }).click();
  await page
    .getByRole("button", { name: "Focus results", exact: true })
    .click();
  await expect(
    page.getByRole("treeitem", { name: "Other work", exact: true }),
  ).toHaveCount(0);
  const methods = page.getByRole("treeitem", { name: "Methods", exact: true });
  await methods.focus();
  await methods.press("ControlOrMeta+Enter");
  const field = page.getByRole("textbox", {
    name: "Edit map node label",
    exact: true,
  });
  await expect(field).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Research lens", exact: true }),
  ).toContainText("Equations");
  await expect(
    page.getByRole("treeitem", { name: "Other work", exact: true }),
  ).toBeVisible();
  await field.fill("New method");
  await field.press("Enter");
  await expect.poll(() => source(page)).toContain("### New method\n");
  await expect(page.locator(".mindmap-retained-draft")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Undo map edit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Undo map edit", exact: true })
    .click();
  await expect.poll(() => source(page)).toBe(original);
});

test("a folded first quotation does not collide with its synthetic root", async ({
  page,
}) => {
  await start(page);
  const original =
    "> First paragraph\n>\n> Second paragraph\n\nOutside quote\n";
  await replaceSource(page, original);
  const quote = page.getByRole("treeitem", { name: "Quotation", exact: true });
  const root = page.locator('.mindmap-node[data-kind="root"]');
  await quote.hover();
  await page
    .getByRole("button", { name: "Fold Quotation", exact: true })
    .click();
  await expect(quote).toHaveAttribute("aria-expanded", "false");
  await expect(root).toHaveAttribute("aria-expanded", "true");
  await root.focus();
  await root.press("ArrowRight");
  await expect(quote).toBeFocused();
  await quote.press("ArrowRight");
  await expect(quote).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("treeitem", { name: "First paragraph", exact: true }),
  ).toBeVisible();
  await expect.poll(() => source(page)).toBe(original);
});
