import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/tests/editor-lab/index.html");
  await page.evaluate(() => window.editorLabReady);
});

test("a delayed research snapshot or stale callback cannot cross a workspace lifetime", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const user = crypto.randomUUID(),
      groupA = crypto.randomUUID(),
      groupB = crypto.randomUUID();
    localStorage.setItem(
      "axiom:session",
      JSON.stringify({ user: { id: user } }),
    );
    const online = Object.getOwnPropertyDescriptor(navigator, "onLine");
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const path = "/apps/web/lib/research-store.ts",
      research = await import(/* @vite-ignore */ path);
    for (const [id, groupId] of [
      ["a", groupA],
      ["b", groupB],
    ])
      await research.storeResearch(user, {
        key: `reading:${id}`,
        kind: "reading",
        groupId,
        pending: false,
        value: { id },
      });
    const pending: (() => void)[] = [],
      transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<typeof transaction>
    ) {
      const tx = transaction.apply(this, args);
      if (this.name !== `axiom:${user}:research-v1` || args[1] !== "readonly")
        return tx;
      // Preserve the real atomic IDB snapshot; delay only promise completion,
      // so an old request can settle after a newer workspace has rendered.
      return new Proxy(tx, {
        set(target, property, value) {
          if (property === "oncomplete") {
            target.oncomplete = (event) =>
              pending.push(() => value.call(target, event));
            return true;
          }
          return Reflect.set(target, property, value, target);
        },
        get(target, property) {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
    const fixturePath = "/tests/editor-lab/research-lifetime-fixture.ts",
      { researchLifetimeFixture } = await import(
        /* @vite-ignore */ fixturePath
      );
    const fixture = researchLifetimeFixture(user, groupA);
    const until = async (condition: () => boolean) => {
      const start = performance.now();
      while (!condition()) {
        if (performance.now() - start > 5000)
          throw new Error("Research lifetime fixture timed out.");
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
    };
    try {
      await until(() => pending.length === 1 && !!fixture.snapshot());
      const staleRefresh = fixture.snapshot()!.refresh;
      fixture.render(user, groupB);
      await until(
        () => pending.length === 2 && fixture.snapshot()?.groupId === groupB,
      );
      pending[1]();
      await until(() => fixture.snapshot()!.entries[0]?.value.id === "b");
      pending[0]();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const afterOldCompletion = fixture
        .snapshot()!
        .entries.map((entry: { value: { id: string } }) => entry.value.id);
      await staleRefresh();
      const requestsAfterStaleCallback = pending.length;
      return {
        afterOldCompletion,
        requestsAfterStaleCallback,
        status: fixture.snapshot()!.status,
      };
    } finally {
      fixture.close();
      IDBDatabase.prototype.transaction = transaction;
      if (online) Object.defineProperty(navigator, "onLine", online);
      else Reflect.deleteProperty(navigator, "onLine");
    }
  });
  expect(result.afterOldCompletion).toEqual(["b"]);
  expect(result.requestsAfterStaleCallback).toBe(2);
  expect(result.status).toBe("");
});

test("atomic legacy upgrade retains binary checksums and drafts but routine reads clone no PDF bytes", async ({
  page,
  browserName,
}, info) => {
  const report = await page.evaluate(
    async ({ supportsLegacyBlob }) => {
      const user = crypto.randomUUID(),
        group = crypto.randomUUID();
      localStorage.setItem(
        "axiom:session",
        JSON.stringify({ user: { id: user } }),
      );
      const name = `axiom:${user}:research-v1`;
      const binary = Uint8Array.from(
        { length: 2 * 1024 * 1024 },
        (_, i) => i % 251,
      );
      const bytesHash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", binary)),
      ).join(",");
      const meta = (id: string) => ({
        id,
        name: `${id}.pdf`,
        note_id: "note",
        group_id: group,
        mime: "application/pdf",
        sha256: bytesHash,
        bytes: binary.length,
        visibility: "private" as const,
        role: "member" as const,
      });
      const reading = {
        key: "reading:pending",
        kind: "reading",
        groupId: group,
        pending: true,
        error: "Keep recovery text",
        value: {
          id: "pending",
          mutation_id: "original",
          data: { note: "Unsynced research" },
        },
      };
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("items", { keyPath: "key" });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("items", "readwrite"),
            store = tx.objectStore("items");
          for (const id of ["one", "two", "three"])
            store.put({
              key: `pdf:${id}`,
              kind: "pdf",
              groupId: group,
              meta: meta(id),
              bytes: binary,
              savedAt: "2026-01-01",
            });
          const legacy = {
            key: "pdf:blob",
            kind: "pdf",
            groupId: group,
            meta: meta("blob"),
            savedAt: "2025-01-01",
          };
          // WebKit's ephemeral context cannot persist Blobs (its transaction may
          // never finish). Axiom pinned typed arrays there before this upgrade.
          // Exercise legacy Blobs in Chromium/Firefox and the typed-array path
          // in every engine, rather than claiming unsupported Blob acceptance.
          store.put({
            ...legacy,
            ...(supportsLegacyBlob
              ? { blob: new Blob([binary]) }
              : { bytes: binary }),
          });
          store.put(reading);
          store.put({
            key: "annotation:other",
            kind: "annotation",
            groupId: "another-workspace",
            pending: true,
            value: { id: "other", data: { body: "Separate draft" } },
          });
          tx.onabort = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      });
      const path = "/apps/web/lib/research-store.ts";
      const research = await import(/* @vite-ignore */ path);
      const summaries = await research.researchSummaries(user);
      const entries = await research.researchEntries(user);
      const scoped = await research.researchEntries(user, undefined, group);
      const single = await research.cachedPaper(user, "two");
      const legacy = await research.cachedPaper(user, "blob");
      const exported = await research.allResearch(user);
      const version = await new Promise<number>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          resolve(db.version);
          db.close();
        };
      });
      let routinePayloadReads = 0;
      const original = IDBObjectStore.prototype.get,
        originalAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.get = function (
        ...args: Parameters<typeof original>
      ) {
        if (this.name === "paper-bytes") routinePayloadReads++;
        return original.apply(this, args);
      };
      IDBObjectStore.prototype.getAll = function (
        ...args: Parameters<typeof originalAll>
      ) {
        if (this.name === "paper-bytes") routinePayloadReads++;
        return originalAll.apply(this, args);
      };
      try {
        for (let i = 0; i < 20; i++) {
          await research.researchSummaries(user);
          await research.researchEntries(user, "reading", group);
          await research.updateResearch(
            user,
            reading.key,
            (entry: Record<string, unknown>) => ({ ...entry, pending: true }),
          );
        }
      } finally {
        IDBObjectStore.prototype.get = original;
        IDBObjectStore.prototype.getAll = originalAll;
      }
      return {
        version,
        summaries: summaries.map(
          (p: { key: string; bytes?: Uint8Array; blob?: Blob }) => ({
            key: p.key,
            binary: p.bytes !== undefined || p.blob !== undefined,
          }),
        ),
        entryKeys: entries.map((e: { key: string }) => e.key),
        scoped,
        routinePayloadReads,
        chosenHash: Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", single.bytes)),
        ).join(","),
        legacyHash: Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              legacy.blob ? await legacy.blob.arrayBuffer() : legacy.bytes,
            ),
          ),
        ).join(","),
        exportBinaryCount: exported.filter(
          (e: { bytes?: Uint8Array; blob?: Blob }) => e.bytes || e.blob,
        ).length,
        bytesHash,
        blobSupported: supportsLegacyBlob,
      };
    },
    { supportsLegacyBlob: browserName !== "webkit" },
  );
  expect(report.version).toBe(2);
  expect(report.summaries.every((s: { binary: boolean }) => !s.binary)).toBe(
    true,
  );
  expect(report.entryKeys).toEqual(["annotation:other", "reading:pending"]);
  expect(report.scoped).toHaveLength(1);
  expect(report.scoped[0]).toMatchObject({
    pending: true,
    error: "Keep recovery text",
    value: { mutation_id: "original", data: { note: "Unsynced research" } },
  });
  expect(report.routinePayloadReads).toBe(0);
  expect(report.chosenHash).toBe(report.bytesHash);
  expect(report.legacyHash).toBe(report.bytesHash);
  expect(report.exportBinaryCount).toBe(4);
  await info.attach("metadata-read-counter", {
    body: JSON.stringify({
      version: report.version,
      routinePayloadReads: report.routinePayloadReads,
      migratedPapers: report.exportBinaryCount,
      legacyBlobSupported: report.blobSupported,
    }),
    contentType: "application/json",
  });
});

test("failed migration is atomic; blocked upgrades and callback errors retain old papers", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const user = crypto.randomUUID();
    localStorage.setItem(
      "axiom:session",
      JSON.stringify({ user: { id: user } }),
    );
    const name = `axiom:${user}:research-v1`;
    const bytes = Uint8Array.of(7, 8, 9),
      entry = {
        key: "pdf:keep",
        kind: "pdf",
        groupId: "group",
        meta: { id: "keep" },
        bytes,
        savedAt: "then",
      };
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () =>
        request.result
          .createObjectStore("items", { keyPath: "key" })
          .put(entry);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const path = "/apps/web/lib/research-store.ts",
      research = await import(/* @vite-ignore */ path);
    // Keep the legacy tab connection open. A rejected blocked request must not
    // later write/upgrade when the other tab finally releases its connection.
    let blocked = "";
    try {
      await research.researchSummaries(user);
    } catch (e) {
      blocked = (e as Error).message;
    }
    legacy.close();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const preserved = await new Promise<{ version: number; bytes: number[] }>(
      (resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("items");
          tx.objectStore("items").get("pdf:keep").onsuccess = (event) =>
            resolve({
              version: db.version,
              bytes: Array.from((event.target as IDBRequest).result.bytes),
            });
          tx.oncomplete = () => db.close();
        };
      },
    );
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === "paper-bytes")
        throw new DOMException("Fixture quota", "QuotaExceededError");
      return put.apply(this, args);
    };
    let failed = false;
    try {
      await research.researchSummaries(user);
    } catch {
      failed = true;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const afterFailure = await new Promise<number>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        resolve(request.result.version);
        request.result.close();
      };
    });
    await research.researchSummaries(user);
    let callbackRejected = false;
    try {
      await research.researchStorage(user, "readwrite", (s: IDBObjectStore) => {
        s.delete("pdf:keep");
        throw new Error("Fixture operation failed");
      });
    } catch {
      callbackRejected = true;
    }
    const paper = await research.cachedPaper(user, "keep");
    await research.removeResearch(user, "pdf:keep");
    const deleted = await research.cachedPaper(user, "keep");
    const exports = await research.allResearch(user);
    return {
      blocked,
      preserved,
      failed,
      afterFailure,
      callbackRejected,
      keptBytes: Array.from(paper.bytes),
      deleted: !deleted,
      exportCount: exports.length,
    };
  });
  expect(results.blocked).toContain("Close other Axiom tabs");
  expect(results.preserved).toEqual({ version: 1, bytes: [7, 8, 9] });
  expect(results.failed).toBe(true);
  expect(results.afterFailure).toBe(1);
  expect(results.callbackRejected).toBe(true);
  expect(results.keptBytes).toEqual([7, 8, 9]);
  expect(results.deleted).toBe(true);
  expect(results.exportCount).toBe(0);
});
