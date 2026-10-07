import { expect, test, type Page } from "@playwright/test";
import { canvasSchema } from "../../packages/shared/src/canvas";
import {
  canvasId,
  researchId,
  imagePath,
  sampleCanvas,
} from "../../apps/showcase/src/samples";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, baseURL }) => {
  const found: string[] = [];
  errors.set(page, found);
  page.on("pageerror", (error) => found.push(error.message));
  page.on("websocket", (socket) => found.push(socket.url()));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (
      /^https?:/.test(url) &&
      (!url.startsWith(new URL(baseURL!).origin) ||
        /\/api\/|\/sync(?:\b|\/)|\.env/.test(url))
    ) {
      found.push(url);
      return route.abort();
    }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
async function source(page: Page, id: string): Promise<string> {
  return page.evaluate(
    (id) =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("axiom-showcase-v1", 1);
        request.onsuccess = () => {
          const db = request.result,
            item = db
              .transaction("documents", "readonly")
              .objectStore("documents")
              .get(id);
          item.onsuccess = () => {
            resolve(item.result?.source ?? "");
            db.close();
          };
          item.onerror = () => {
            reject(item.error);
            db.close();
          };
        };
        request.onerror = () => reject(request.error);
      }),
    id,
  );
}
test("a 50-image gallery scans visual DOM a constant number of times and keeps placement identity", async ({
  page,
}, info) => {
  await page.goto(`./#editor&note=${researchId}`);
  await page.getByRole("button", { name: "Source", exact: true }).click();
  const text =
    "# Figures\n\n" +
    Array.from(
      { length: 50 },
      (_, index) => `![Figure ${index}](${imagePath})`,
    ).join("\n\n");
  const field = page.locator(".demo-document-scroll .cm-content");
  await field.click();
  await field.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
  await expect.poll(() => source(page, researchId)).toBe(text);
  await page.getByRole("button", { name: "Read", exact: true }).click();
  const images = page.locator(
    '.demo-document-scroll [data-visual-kind="image"] img',
  );
  await expect(images).toHaveCount(50);
  await images.first().scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      images.first().evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    const evidence = { queries: 0, placements: [] as string[] };
    (window as unknown as { visualAudit: typeof evidence }).visualAudit =
      evidence;
    const query = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function (
      this: Element,
      selector: string,
    ) {
      if (selector === "[data-visual-kind]") evidence.queries++;
      return query.call(this, selector);
    } as typeof query;
    window.addEventListener(
      "axiom:visual-open",
      (event) => {
        evidence.placements = (
          event as CustomEvent<{ items: { id: string }[] }>
        ).detail.items.map((item) => item.id);
      },
      { once: true },
    );
  });
  await images.first().dblclick();
  await expect(page.getByRole("dialog")).toContainText("Image viewer");
  const evidence = await page.evaluate(
    () =>
      (
        window as unknown as {
          visualAudit: { queries: number; placements: string[] };
        }
      ).visualAudit,
  );
  expect(evidence.queries).toBeLessThanOrEqual(8);
  expect(evidence.placements).toHaveLength(50);
  expect(new Set(evidence.placements).size).toBe(50);
  expect(await source(page, researchId)).toBe(text);
  await info.attach("visual-scan-counter", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
});

test("Canvas coalesces pointer bursts, commits the final release once and cancels without a source write", async ({
  page,
}, info) => {
  await page.goto(`./#canvas&note=${canvasId}`);
  const card = page.locator('[data-canvas-node="question"]');
  await expect(card).toBeVisible();
  await expect(
    page.locator('[data-canvas-node="model"] [data-math-state="ready"]'),
  ).toBeVisible();
  // Initial Yjs seeding normalizes JSON field order and schedules a durable
  // flush. A prior initial-store save may briefly report saved before the
  // seeded Canvas update flushes; require the actual normalized initial bytes,
  // not only the status label, before taking the strict gesture baseline.
  const initialized = JSON.stringify(canvasSchema.parse(sampleCanvas));
  await expect.poll(() => source(page, canvasId)).toBe(initialized);
  await expect(page.locator(".canvas-status")).toContainText(
    "Saved on this device",
  );
  const original = await source(page, canvasId);
  const originalNode = JSON.parse(original).nodes.find(
    (node: { id: string }) => node.id === "question",
  );
  const box = (await card.locator(".canvas-card-toolbar").boundingBox())!;
  const start = { x: box.x + 30, y: box.y + box.height / 2 };
  const zoom = await page
    .locator(".canvas-world")
    .evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).a,
    );
  // Synthetic burst: keep pointer capture native for ordinary pointers, but
  // supply capture ownership for this explicit browser-local fixture pointer.
  await page.evaluate(
    ({ start }) => {
      const captured = new WeakMap<Element, Set<number>>();
      const set = Element.prototype.setPointerCapture,
        has = Element.prototype.hasPointerCapture,
        release = Element.prototype.releasePointerCapture;
      Element.prototype.setPointerCapture = function (id) {
        if (id !== 4242) return set.call(this, id);
        captured.set(this, new Set([id]));
      };
      Element.prototype.hasPointerCapture = function (id) {
        return id === 4242 ? !!captured.get(this)?.has(id) : has.call(this, id);
      };
      Element.prototype.releasePointerCapture = function (id) {
        if (id !== 4242) return release.call(this, id);
        captured.get(this)?.delete(id);
      };
      const card = document.querySelector(
        '[data-canvas-node="question"] .canvas-card-toolbar',
      )!;
      const board = document.querySelector(".canvas-board")!;
      const event = (type: string, x: number) =>
        new PointerEvent(type, {
          pointerId: 4242,
          clientX: x,
          clientY: start.y,
          button: 0,
          buttons: 1,
          isPrimary: true,
          bubbles: true,
        });
      card.dispatchEvent(event("pointerdown", start.x));
      for (let index = 1; index <= 100; index++)
        board.dispatchEvent(event("pointermove", start.x + index));
    },
    { start },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await source(page, canvasId)).toBe(original);
  await page.evaluate(
    ({ start }) =>
      document.querySelector(".canvas-board")!.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 4242,
          clientX: start.x + 140,
          clientY: start.y,
          button: 0,
          buttons: 0,
          isPrimary: true,
          bubbles: true,
        }),
      ),
    { start },
  );
  await expect
    .poll(
      async () =>
        JSON.parse(await source(page, canvasId)).nodes.find(
          (node: { id: string }) => node.id === "question",
        ).x,
    )
    .toBe(Math.round(originalNode.x + 140 / zoom));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  // Canvas stores semantic JSON. Its existing source-backed Undo can serialize
  // object fields in another order without changing any card/edge value.
  await expect
    .poll(async () => JSON.parse(await source(page, canvasId)))
    .toEqual(JSON.parse(original));
  const afterUndo = await source(page, canvasId);
  await page.evaluate(
    ({ start }) => {
      const card = document.querySelector(
        '[data-canvas-node="question"] .canvas-card-toolbar',
      )!;
      const board = document.querySelector(".canvas-board")!;
      const event = (type: string, x: number) =>
        new PointerEvent(type, {
          pointerId: 4242,
          clientX: x,
          clientY: start.y,
          button: 0,
          buttons: 1,
          isPrimary: true,
          bubbles: true,
        });
      card.dispatchEvent(event("pointerdown", start.x));
      board.dispatchEvent(event("pointermove", start.x + 250));
      board.dispatchEvent(event("pointercancel", start.x + 250));
    },
    { start },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await source(page, canvasId)).toBe(afterUndo);
  await info.attach("canvas-final-sample", {
    body: JSON.stringify({
      pointerBurst: 100,
      previewSourceWrites: 0,
      finalScreenDelta: 140,
      zoom,
      singleUndoRestoredCanvas: true,
      cancellationSourceWrites: 0,
    }),
    contentType: "application/json",
  });
});
