import type { DocumentFormat } from "@axiom/shared/document-format";
import {
  offlineMutation,
  type OfflineCommand,
  type OfflineEntry,
  type OfflineManifest,
  type OfflinePackage,
} from "@axiom/shared/offline";
import {
  fileTypes,
  sourceForNewFile,
  type FileType,
} from "@axiom/shared/file-types";
import type {
  Resource,
  ResourceLocation,
  Space,
} from "@axiom/shared/workspace";
import { currentCache } from "./editor-recovery";
import { datasetRequestHeaders, verifyDataset } from "./dataset";
let account: { id: string; spaces: Space[] } | null = null;
export const offlineFilesEvent = "axiom:offline-files";
const changed = () => window.dispatchEvent(new Event(offlineFilesEvent));
export function offlineAccount() {
  return account?.id ?? null;
}
export function setOfflineAccount(id: string | null, spaces: Space[] = []) {
  // Cached Explorer rows can render before /spaces resolves after a reload.
  // Restore only this account's last verified scopes during that offline gap.
  let cached: Space[] = [];
  if (id && account?.id !== id && !spaces.length) {
    try {
      const value = JSON.parse(
        localStorage.getItem(`axiom:spaces:${id}`) ?? "[]",
      );
      if (Array.isArray(value)) cached = value;
    } catch {
      /* A missing cache requires an online authorization refresh. */
    }
  }
  account = id
    ? {
        id,
        spaces: spaces.length
          ? spaces
          : account?.id === id
            ? account.spaces
            : cached,
      }
    : null;
}
function database(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`axiom:${userId}:offline-files`, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("entries", { keyPath: "key" });
      req.result.createObjectStore("packages", { keyPath: "id" });
      req.result.createObjectStore("queue", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error("Close another Axiom tab to update device storage."));
  });
}
async function transact<T>(
  userId: string,
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T> {
  if (mode === "readwrite") current(userId);
  const db = await database(userId);
  if (mode === "readwrite") {
    try {
      current(userId);
    } catch (e) {
      db.close();
      throw e;
    }
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode, { durability: "strict" });
    let request: IDBRequest<T> | void;
    try {
      request = work(tx);
    } catch (e) {
      tx.abort();
      db.close();
      reject(e);
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(request ? request.result : (undefined as T));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("Offline storage transaction failed."));
    };
  });
}
const list = <T>(id: string, store: string) =>
  transact<T[]>(id, [store], "readonly", (tx) =>
    tx.objectStore(store).getAll(),
  );
const put = (id: string, store: string, value: unknown) =>
  transact(id, [store], "readwrite", (tx) => tx.objectStore(store).put(value));
const getEntry = (id: string, key: string) =>
  transact<OfflineEntry | undefined>(id, ["entries"], "readonly", (tx) =>
    tx.objectStore("entries").get(key),
  );
export async function offlineState(userId: string) {
  const [packages, queue] = await Promise.all([
    list<OfflinePackage>(userId, "packages"),
    list<OfflineCommand>(userId, "queue"),
  ]);
  return {
    packages,
    queue: queue.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}
export async function hasPendingOfflineCreation(path: string) {
  const userId = account?.id,
    id = /^(?:resources|notes|tools)\/([\da-f-]{36})(?:\/|$)/i.exec(path)?.[1];
  if (!userId || !id) return false;
  return (await offlineState(userId)).queue.some(
    (c) =>
      c.resourceId === id &&
      offlineMutation(c.path, c.method, c.body) === "create" &&
      !["done", "cancelled"].includes(c.status),
  );
}
export async function waitForOfflineCreation(path: string) {
  const userId = account?.id;
  if (!userId) return;
  await replayOffline(userId);
  const until = Date.now() + 15000;
  while (await hasPendingOfflineCreation(path)) {
    current(userId);
    if (!navigator.onLine || Date.now() > until)
      throw new Error(
        "File creation is still queued on this device. Resolve pending operations in Offline research before sharing it.",
      );
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
const keyOf = (path: string) => {
  const url = new URL(path, "http://offline.local/");
  url.searchParams.sort();
  return url.pathname.replace(/^\//, "") + url.search;
};
function current(id: string) {
  if (account?.id !== id || localStorage.getItem("axiom:pending-signout"))
    throw new Error("The active account changed. Offline operation cancelled.");
}
async function responseJson(path: string, body?: unknown) {
  const response = await fetch("/api/v1/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(value.error ?? "Offline preparation failed."),
      { status: response.status },
    );
  return value;
}
async function seedJournal(
  userId: string,
  item: OfflineManifest["documents"][number],
  epoch: string,
) {
  const [Y, { LocalPersistence }, { acquireDocument, releaseDocument }] =
    await Promise.all([
      import("yjs"),
      import("./persistence"),
      import("./document-sessions"),
    ]);
  const scope = `${userId}:${item.id}:${item.generation}`,
    cache = currentCache(scope),
    key = scope + (cache ? ":" + cache : ""),
    session = acquireDocument(key),
    doc = session.doc;
  const journal = new LocalPersistence(`axiom:${key}`, doc, (saved, error) => {
    session.persisted = saved && !error;
  });
  try {
    await journal.whenSynced;
    const previous = await journal.get<string>("access-epoch");
    if (previous !== undefined && previous !== epoch) {
      await journal.set("access-denied", true);
      throw new Error(
        "Workspace access changed. Reopen the document online before downloading it again; the earlier journal has been retained.",
      );
    }
    const state = Uint8Array.from(atob(item.state), (c) => c.charCodeAt(0));
    Y.applyUpdate(doc, state);
    await journal.set("access-epoch", epoch);
    await journal.set("access-denied", false);
    await journal.set("authorized-editor", item.editable);
    await journal.set("server-source", item.source);
    await journal.flush();
  } finally {
    journal.destroy();
    releaseDocument(key);
  }
}
export async function pinOffline(userId: string, id: string) {
  current(userId);
  if (!navigator.onLine)
    throw new Error("Connect to download this selection first.");
  const manifest = (await responseJson("offline/manifest", {
    id,
  })) as OfflineManifest;
  current(userId);
  const bytes = manifest.files.reduce((sum, f) => sum + f.bytes, 0),
    estimate = await navigator.storage?.estimate();
  if (
    estimate?.quota &&
    estimate.usage !== undefined &&
    estimate.quota - estimate.usage < bytes * 1.15 + 10_000_000
  )
    throw new Error(
      "Not enough device storage. Remove another offline package or choose a smaller folder.",
    );
  const pkg: OfflinePackage = {
    id,
    rootId: id,
    spaceId: manifest.spaceId,
    name: manifest.name,
    state: "preparing",
    done: 0,
    total: manifest.documents.length + manifest.files.length,
    bytes,
    epoch: manifest.epoch,
    updatedAt: new Date().toISOString(),
    resourceIds: manifest.resourceIds,
    keys: [
      ...manifest.entries.map((e) => keyOf(e.key)),
      ...manifest.files.flatMap((f) => [
        keyOf(f.key),
        ...(f.aliases ?? []).map(keyOf),
      ]),
    ],
  };
  await put(userId, "packages", pkg);
  changed();
  try {
    for (const item of manifest.documents) {
      current(userId);
      await seedJournal(userId, item, manifest.epoch);
      pkg.done++;
      await put(userId, "packages", pkg);
      changed();
    }
    // Do not advertise ready until every file has passed size and checksum validation.
    for (const file of manifest.files) {
      current(userId);
      const response = await fetch(`/api/v1/${file.key}`);
      if (!response.ok)
        throw new Error(
          "A file changed or became unavailable during download.",
        );
      const body = await response.blob();
      if (body.size !== file.bytes)
        throw new Error("A file download was incomplete. Retry this package.");
      const digest = await crypto.subtle.digest(
          "SHA-256",
          await body.arrayBuffer(),
        ),
        hash = Array.from(new Uint8Array(digest), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join("");
      if (hash !== file.sha256)
        throw new Error(
          "File checksum mismatch. The offline copy was not accepted.",
        );
      await put(userId, "entries", {
        key: keyOf(file.key),
        packageId: id,
        body,
        mime: file.mime,
        sha256: hash,
      } satisfies OfflineEntry);
      for (const alias of file.aliases ?? [])
        await put(userId, "entries", {
          key: keyOf(alias),
          packageId: id,
          assetKey: keyOf(file.key),
        } satisfies OfflineEntry);
      pkg.done++;
      await put(userId, "packages", pkg);
      changed();
    }
    current(userId);
    await transact(userId, ["entries", "packages"], "readwrite", (tx) => {
      for (const entry of manifest.entries)
        tx.objectStore("entries").put({
          ...entry,
          key: keyOf(entry.key),
          packageId: id,
        });
      tx.objectStore("packages").put({
        ...pkg,
        state: "ready",
        updatedAt: new Date().toISOString(),
      });
    });
    changed();
  } catch (e) {
    await put(userId, "packages", {
      ...pkg,
      state: (e as { status?: number }).status === 403 ? "blocked" : "failed",
      error: (e as Error).message,
    });
    changed();
    throw e;
  }
}
export async function removeOffline(userId: string, id: string) {
  const all = await list<OfflineEntry>(userId, "entries"),
    state = await offlineState(userId);
  if (
    state.queue.some(
      (c) =>
        !["done", "cancelled"].includes(c.status) &&
        state.packages
          .find((p) => p.id === id)
          ?.resourceIds.includes(c.resourceId),
    )
  )
    throw new Error(
      "Finish or resolve pending operations before removing this offline copy.",
    );
  await transact(userId, ["entries", "packages"], "readwrite", (tx) => {
    for (const entry of all)
      if (
        (entry.packageId === id ||
          state.packages.find((p) => p.id === id)?.keys?.includes(entry.key)) &&
        !state.packages.some((p) => p.id !== id && p.keys?.includes(entry.key))
      )
        tx.objectStore("entries").delete(entry.key);
    tx.objectStore("packages").delete(id);
  });
  changed();
}
export async function offlineRead(path: string): Promise<unknown | undefined> {
  if (!account) return;
  const id = account.id;
  current(id);
  const key = keyOf(path),
    exact = await getEntry(id, key);
  if (exact?.value !== undefined) {
    const value = exact.value as Record<string, unknown>;
    if (/^(notes|tools)\/[\da-f-]{36}$/.test(key) && value?.deleted_at)
      return { ...value, role: "viewer", editable: false };
    return exact.value;
  }
  if (path === "spaces") return account.spaces;
  const url = new URL(path, "http://offline.local/");
  if (url.pathname === "/resources") {
    const all = await list<OfflineEntry>(id, "entries"),
      resources = all
        .filter((e) => /^resources\/[\da-f-]{36}$/.test(e.key))
        .map((e) => e.value as Resource),
      space = url.searchParams.get("spaceId"),
      parent = url.searchParams.get("parentId"),
      view = url.searchParams.get("view") ?? "folder",
      q = (url.searchParams.get("q") ?? "").toLowerCase(),
      kind = url.searchParams.get("kind"),
      folder = parent
        ? await getEntry(id, `resources/${parent}/location`)
        : undefined,
      location = folder?.value as ResourceLocation | undefined;
    const items = resources.filter(
      (r) =>
        (!space || r.space_id === space) &&
        (view === "trash" ? !!r.deleted_at : !r.deleted_at) &&
        (view !== "folder" || r.parent_id === parent) &&
        (!kind || r.kind === kind) &&
        (!q || r.name.toLowerCase().includes(q)) &&
        (view !== "favorites" || r.favorite),
    );
    const sort = url.searchParams.get("sort") ?? "name",
      direction = url.searchParams.get("direction") === "desc" ? -1 : 1;
    items.sort((a, b) =>
      a.kind === "folder" && b.kind !== "folder"
        ? -1
        : b.kind === "folder" && a.kind !== "folder"
          ? 1
          : direction *
            (sort === "updated"
              ? a.updated_at.localeCompare(b.updated_at)
              : sort === "size"
                ? (a.bytes ?? 0) - (b.bytes ?? 0)
                : a.name.localeCompare(b.name)),
    );
    return {
      items,
      nextCursor: null,
      breadcrumbs: location ? [...location.ancestors, location.resource] : [],
      offline: true,
    };
  }
  if (path === "tools")
    return (await list<OfflineEntry>(id, "entries"))
      .filter((e) => /^tools\/[\da-f-]{36}$/.test(e.key))
      .map((e) => e.value);
  return undefined;
}
export async function queueOffline(
  path: string,
  method: string,
  body: Record<string, unknown>,
) {
  if (!account) throw new Error("Sign in online before using offline changes.");
  const userId = account.id;
  current(userId);
  const action = offlineMutation(path, method, body);
  if (!action)
    throw new Error(
      "This action requires a connection. Your existing work is unchanged.",
    );
  const existing =
    action !== "create"
      ? ((await getEntry(userId, `resources/${path.split("/")[1]}`))?.value as
          Resource | undefined)
      : undefined;
  const spaceId = String(
      action === "create" ? body.spaceId : (existing?.space_id ?? ""),
    ),
    space = account.spaces.find((s) => s.id === spaceId),
    packages = await list<OfflinePackage>(userId, "packages"),
    pkg = packages.find((p) => p.spaceId === spaceId && p.state === "ready");
  if (action !== "create" && !existing)
    throw new Error("Download this item before editing it offline.");
  if (existing?.deleted_at)
    throw new Error(
      "This item is in Trash. Reconnect and restore it before editing.",
    );
  if (!space || space.role !== "editor")
    throw new Error(
      "Reconnect to verify editing access to this workspace before making offline changes.",
    );
  if (!pkg)
    throw new Error(
      "Refresh a downloaded file or folder in this workspace before making more offline changes.",
    );
  if (body.parentId) {
    const parent = (await getEntry(userId, `resources/${body.parentId}`))
      ?.value as Resource | undefined;
    if (
      !parent ||
      parent.kind !== "folder" ||
      parent.deleted_at ||
      parent.space_id !== spaceId
    )
      throw new Error("Choose a downloaded folder in the same workspace.");
    const seen = new Set<string>();
    let ancestor: Resource | undefined = parent;
    while (ancestor) {
      if (seen.has(ancestor.id) || ancestor.id === existing?.id)
        throw new Error("A folder cannot move into itself or a descendant.");
      seen.add(ancestor.id);
      ancestor = ancestor.parent_id
        ? ((await getEntry(userId, `resources/${ancestor.parent_id}`))
            ?.value as Resource | undefined)
        : undefined;
    }
  }
  const commandId = String(body.mutationId ?? crypto.randomUUID()),
    resourceId =
      action === "create"
        ? String(body.id ?? crypto.randomUUID())
        : existing!.id,
    now = new Date().toISOString();
  const previous = (await list<OfflineCommand>(userId, "queue")).find(
    (c) => c.id === commandId,
  );
  if (previous) {
    if (previous.requestBody && previous.requestBody !== JSON.stringify(body))
      throw new Error(
        "This retry identifier belongs to a different offline request.",
      );
    return previous.result;
  }
  let resource: Resource, output: unknown;
  const entries: OfflineEntry[] = [];
  const payload = { ...body, mutationId: commandId };
  if (action === "create") {
    const type = path === "files/new" ? String(body.type) : String(body.kind),
      isFolder = type === "folder",
      format: DocumentFormat =
        type === "canvas"
          ? "canvas"
          : type === "math"
            ? "latex"
            : ["text", "json", "csv", "yaml"].includes(type)
              ? "text"
              : "markdown",
      extension = fileTypes.find((t) => t.id === type)?.extension;
    let name = String(body.name);
    if (
      extension &&
      !name.toLowerCase().endsWith("." + extension) &&
      !["markdown", "math", "canvas"].includes(type)
    )
      name += "." + extension;
    resource = {
      id: resourceId,
      space_id: spaceId,
      parent_id: String(body.parentId ?? "") || null,
      kind: isFolder ? "folder" : "note",
      name,
      description: "",
      owner_id: userId,
      note_id: isFolder ? null : resourceId,
      current_version_id: null,
      version: 1,
      tags: [],
      created_at: now,
      updated_at: now,
      deleted_at: null,
      role: "editor",
      document_type: format === "latex" ? "math" : format,
    };
    Object.assign(payload, { id: resourceId, name });
    if (!isFolder) {
      const [Y, { initializeDocument }] = await Promise.all([
        import("yjs"),
        import("@axiom/shared/document-format"),
      ]);
      const doc = new Y.Doc();
      const source = String(
        body.source ?? body.body ?? sourceForNewFile(type as FileType),
      );
      initializeDocument(doc, source, format);
      const bytes = Y.encodeStateAsUpdate(doc),
        state = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
      doc.destroy();
      Object.assign(payload, { initialState: state });
      await seedJournal(
        userId,
        {
          id: resourceId,
          generation: 1,
          state,
          source,
          format,
          editable: true,
        },
        pkg.epoch,
      );
      entries.push({
        key: `notes/${resourceId}`,
        packageId: pkg.id,
        value: {
          ...resource,
          title: name,
          body: source,
          source_format: format,
          generation: 1,
          author_id: userId,
          group_id: space.group_id,
          project_id: space.project_id,
          visibility: space.kind === "personal" ? "private" : "shared",
        },
      });
      entries.push({
        key: `notes/${resourceId}/context`,
        packageId: pkg.id,
        value: { space, notes: [], references: [], members: [], links: [] },
      });
      if (format !== "markdown")
        entries.push({
          key: `tools/${resourceId}`,
          packageId: pkg.id,
          value: {
            resource_id: resourceId,
            space_id: spaceId,
            parent_id: resource.parent_id,
            kind: format === "latex" ? "math" : format,
            name,
            generation: 1,
            role: "editor",
            version: 1,
            settings: {},
            updated_at: now,
          },
        });
    }
    output =
      path === "resources"
        ? resource
        : { id: resourceId, kind: resource.document_type, queued: true };
  } else {
    if (!existing)
      throw new Error("Download this item before editing it offline.");
    if (existing.version !== body.version)
      throw new Error(
        "The local file changed. Refresh before retrying this action.",
      );
    if (action === "update" && body.parentId === resourceId)
      throw new Error("A folder cannot contain itself.");
    resource = {
      ...existing,
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.description === "string"
        ? { description: body.description }
        : {}),
      ...(Array.isArray(body.tags) ? { tags: body.tags as string[] } : {}),
      ...("parentId" in body
        ? { parent_id: body.parentId as string | null }
        : {}),
      version: existing.version + 1,
      updated_at: now,
      ...(action === "trash" ? { deleted_at: now } : {}),
    };
    output = { ...resource, queued: true };
    for (const prefix of ["notes", "tools"]) {
      const prior = await getEntry(userId, `${prefix}/${resourceId}`);
      if (prior?.value)
        entries.push({
          ...prior,
          value: {
            ...(prior.value as object),
            name: resource.name,
            title: resource.name,
            parent_id: resource.parent_id,
            version: resource.version,
            deleted_at: resource.deleted_at,
          },
        });
    }
  }
  entries.push({
    key: `resources/${resourceId}`,
    packageId: pkg.id,
    value: resource,
  });
  const parentLocation = resource.parent_id
    ? ((await getEntry(userId, `resources/${resource.parent_id}/location`))
        ?.value as ResourceLocation | undefined)
    : undefined;
  entries.push({
    key: `resources/${resourceId}/location`,
    packageId: pkg.id,
    value: {
      resource,
      space: { id: space.id, name: space.name, kind: space.kind },
      ancestors: parentLocation
        ? [...parentLocation.ancestors, parentLocation.resource]
        : [],
    },
  });
  if (resource.kind === "folder" && action === "trash") {
    const stored = await list<OfflineEntry>(userId, "entries");
    const descendants = new Set([resourceId]);
    const resources = stored
      .filter((e) => /^resources\/[\da-f-]{36}$/.test(e.key))
      .map((e) => e.value as Resource);
    for (let changed = true; changed;) {
      changed = false;
      for (const child of resources)
        if (
          child.parent_id &&
          descendants.has(child.parent_id) &&
          !descendants.has(child.id)
        ) {
          descendants.add(child.id);
          changed = true;
        }
    }
    for (const entry of stored) {
      const match = /^(resources|notes|tools)\/([\da-f-]{36})$/.exec(entry.key);
      if (!match || match[2] === resourceId || !descendants.has(match[2]))
        continue;
      const value = entry.value as Resource;
      if (!value.deleted_at)
        entries.push({
          ...entry,
          value: { ...value, deleted_at: now, version: value.version + 1 },
        });
    }
  }
  const command: OfflineCommand = {
    id: commandId,
    path,
    method,
    body: payload,
    resourceId,
    spaceId,
    status: "queued",
    createdAt: now,
    result: output,
    requestBody: JSON.stringify(body),
  };
  await transact(
    userId,
    ["entries", "queue", "packages"],
    "readwrite",
    (tx) => {
      for (const entry of entries) tx.objectStore("entries").put(entry);
      tx.objectStore("queue").put(command);
      if (!pkg.resourceIds.includes(resourceId))
        tx.objectStore("packages").put({
          ...pkg,
          resourceIds: [...pkg.resourceIds, resourceId],
        });
    },
  );
  changed();
  return output;
}
export async function replayOffline(userId: string) {
  if (
    !navigator.onLine ||
    account?.id !== userId ||
    localStorage.getItem("axiom:pending-signout")
  )
    return;
  const replay = async () => {
    await verifyDataset();
    const state = await offlineState(userId);
    if (state.queue.some((c) => ["conflict", "blocked"].includes(c.status)))
      return;
    for (const command of state.queue.filter(
      (c) => !["done", "cancelled"].includes(c.status),
    )) {
      current(userId);
      if (!navigator.onLine) return;
      await put(userId, "queue", { ...command, status: "syncing" });
      changed();
      try {
        const response = await fetch(`/api/v1/${command.path}`, {
          method: command.method,
          headers: {
            "content-type": "application/json",
            ...datasetRequestHeaders(),
          },
          body: JSON.stringify(command.body),
        });
        const result = await response.json();
        current(userId);
        if (!response.ok) {
          await put(userId, "queue", {
            ...command,
            status: [401, 403, 404].includes(response.status)
              ? "blocked"
              : "conflict",
            error: result.error ?? "Review this operation before retrying.",
          });
          changed();
          return;
        }
        await transact(userId, ["queue", "entries"], "readwrite", (tx) => {
          const queue = tx.objectStore("queue"),
            entries = tx.objectStore("entries");
          queue.put({ ...command, status: "done", result });
          const acknowledged = result.resource ?? result;
          if (
            acknowledged.id !== command.resourceId ||
            !Number.isFinite(acknowledged.version)
          )
            return;
          const pending = queue.getAll();
          pending.onsuccess = () => {
            // Preserve any later optimistic edits until their own acknowledgements.
            if (
              (pending.result as OfflineCommand[]).some(
                (c) =>
                  c.resourceId === command.resourceId &&
                  !["done", "cancelled"].includes(c.status),
              )
            )
              return;
            const resource = entries.get(`resources/${command.resourceId}`);
            resource.onsuccess = () => {
              if (!resource.result) return;
              const merged = {
                ...resource.result.value,
                ...acknowledged,
              } as Resource;
              entries.put({ ...resource.result, value: merged });
              for (const prefix of ["notes", "tools"]) {
                const entry = entries.get(`${prefix}/${command.resourceId}`);
                entry.onsuccess = () => {
                  if (!entry.result) return;
                  entries.put({
                    ...entry.result,
                    value: {
                      ...entry.result.value,
                      name: merged.name,
                      title: merged.name,
                      description: merged.description,
                      tags: merged.tags,
                      version: merged.version,
                      parent_id: merged.parent_id,
                      updated_at: merged.updated_at,
                      deleted_at: merged.deleted_at,
                    },
                  });
                };
              }
              const location = entries.get(
                `resources/${command.resourceId}/location`,
              );
              location.onsuccess = () => {
                if (location.result)
                  entries.put({
                    ...location.result,
                    value: { ...location.result.value, resource: merged },
                  });
              };
            };
          };
        });
        changed();
      } catch (e) {
        await put(userId, "queue", {
          ...command,
          status: "queued",
          error: (e as Error).message,
        });
        changed();
        return;
      }
    }
    window.dispatchEvent(new Event("axiom:workspace-refresh"));
  };
  if (navigator.locks)
    await navigator.locks.request(
      `axiom:offline-replay:${userId}`,
      { ifAvailable: true },
      (lock) => (lock ? replay() : undefined),
    );
  else
    throw new Error(
      "This browser cannot safely coordinate offline replay across tabs. Use a current desktop browser.",
    );
}
export async function resolveOffline(
  userId: string,
  id: string,
  action: "retry" | "rebase",
  reviewedVersion?: number,
) {
  const state = await offlineState(userId),
    command = state.queue.find((c) => c.id === id);
  if (!command) return;
  if (command.status === "syncing")
    throw new Error("Wait for the current synchronization attempt.");
  if (action === "rebase") {
    if (
      command.path === "files/new" ||
      !["PATCH", "POST"].includes(command.method) ||
      !/^resources\/[\da-f-]{36}(?:\/trash)?$/.test(command.path)
    )
      throw new Error(
        "Only metadata or trash conflicts can be reapplied. Export new work to recover elsewhere.",
      );
    const currentResource = (await responseJson(
      `resources/${command.resourceId}`,
    )) as Resource;
    if (
      currentResource.version !== reviewedVersion ||
      currentResource.space_id !== command.spaceId ||
      currentResource.deleted_at
    )
      throw new Error(
        "The server item changed again. Review its latest details first.",
      );
    const index = state.queue.indexOf(command);
    let version = currentResource.version;
    await transact(userId, ["queue"], "readwrite", (tx) => {
      for (const next of state.queue
        .slice(index)
        .filter(
          (c) =>
            c.resourceId === command.resourceId &&
            !["done", "cancelled"].includes(c.status),
        )) {
        tx.objectStore("queue").put({
          ...next,
          body: {
            ...next.body,
            version: version++,
            mutationId: crypto.randomUUID(),
          },
          status: "queued",
          error: undefined,
        });
      }
    });
    changed();
    await replayOffline(userId);
    return;
  }
  await put(userId, "queue", {
    ...command,
    status: "queued",
    error: undefined,
  });
  changed();
  await replayOffline(userId);
}
export async function reviewOffline(userId: string, id: string) {
  current(userId);
  const command = (await offlineState(userId)).queue.find((c) => c.id === id);
  if (!command) throw new Error("This operation is unavailable.");
  return {
    command,
    server: (await responseJson(`resources/${command.resourceId}`)) as Resource,
  };
}
/** Export selected originals plus every generation of their retained journals. */
export async function exportOfflineRecovery(userId: string) {
  current(userId);
  const [
    { default: JSZip },
    Y,
    { documentSource, documentExtension },
    { documentsSavedLocally },
  ] = await Promise.all([
    import("jszip"),
    import("yjs"),
    import("@axiom/shared/document-format"),
    import("./document-sessions"),
  ]);
  if (!documentsSavedLocally())
    throw new Error(
      "Wait for your open documents to finish saving on this device before exporting recovery.",
    );
  const zip = new JSZip(),
    state = await offlineState(userId),
    entries = await list<OfflineEntry>(userId, "entries");
  const ids = new Set([
    ...state.packages.flatMap((p) => p.resourceIds),
    ...state.queue.map((c) => c.resourceId),
  ]);
  zip.file("operations.json", JSON.stringify(state, null, 2));
  zip.file(
    "entries.json",
    JSON.stringify(
      entries.map(({ body, ...e }, i) => ({
        ...e,
        ...(body ? { archiveFile: `files/${i}`, bytes: body.size } : {}),
      })),
      null,
      2,
    ),
  );
  for (const [i, entry] of entries.entries())
    if (entry.body) zip.file(`files/${i}`, await entry.body.arrayBuffer());
  for (const info of await indexedDB.databases()) {
    if (!info.name?.startsWith(`axiom:${userId}:`)) continue;
    const suffix = info.name.slice(`axiom:${userId}:`.length),
      id = suffix.split(":")[0];
    if (!ids.has(id)) continue;
    current(userId);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(info.name!);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      if (!db.objectStoreNames.contains("updates")) continue;
      const updates = await new Promise<Uint8Array[]>((resolve, reject) => {
        const tx = db.transaction("updates", "readonly"),
          r = tx.objectStore("updates").getAll();
        tx.oncomplete = () => resolve(r.result);
        tx.onabort = () => reject(tx.error);
      });
      const doc = new Y.Doc();
      try {
        for (const update of updates) Y.applyUpdate(doc, update);
        const metadata = entries.find((e) => e.key === `notes/${id}`)?.value as
          { source_format?: DocumentFormat } | undefined;
        const format = doc.share.has("canvas")
          ? "canvas"
          : (metadata?.source_format ?? "markdown");
        const base = `documents/${suffix.replaceAll(":", "-")}`;
        zip.file(`${base}.yjs`, Y.encodeStateAsUpdate(doc));
        zip.file(
          `${base}.${documentExtension(format)}`,
          documentSource(doc, format),
        );
      } finally {
        doc.destroy();
      }
    } finally {
      db.close();
    }
  }
  zip.file(
    "README.txt",
    "Private Axiom recovery archive. Contains selected originals, metadata, pending operations, and retained collaborative document generations. Keep it secure. Markdown/Canvas/LaTeX/text files can be imported into a new workspace; .yjs files retain exact CRDT state. Cancelling queued metadata operations does not undo requests already accepted by the server.",
  );
  current(userId);
  return zip.generateAsync({ type: "blob" });
}
export async function cancelPendingOffline(userId: string) {
  current(userId);
  if (!navigator.onLine)
    throw new Error(
      "Reconnect before cancelling so server state can be reconciled.",
    );
  await navigator.locks.request(
    `axiom:offline-replay:${userId}`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error(
          "Another tab is synchronizing. Wait before cancelling.",
        );
      const state = await offlineState(userId);
      await transact(
        userId,
        ["queue", "entries", "packages"],
        "readwrite",
        (tx) => {
          for (const c of state.queue.filter(
            (c) => !["done", "cancelled"].includes(c.status),
          )) {
            tx.objectStore("queue").put({
              ...c,
              status: "cancelled",
              error:
                "Cancelled locally. Retained journals are available in the recovery export.",
            });
            for (const key of [
              `resources/${c.resourceId}`,
              `resources/${c.resourceId}/location`,
              `notes/${c.resourceId}`,
              `notes/${c.resourceId}/context`,
              `tools/${c.resourceId}`,
            ])
              tx.objectStore("entries").delete(key);
          }
          for (const pkg of state.packages)
            if (
              state.queue.some(
                (c) =>
                  c.spaceId === pkg.spaceId &&
                  !["done", "cancelled"].includes(c.status),
              )
            )
              tx.objectStore("packages").put({
                ...pkg,
                state: "failed",
                error:
                  "Pending operations were cancelled. Refresh this download to reconcile current server metadata.",
              });
        },
      );
      changed();
    },
  );
  window.dispatchEvent(new Event("axiom:workspace-refresh"));
}
export async function revokeOfflineResource(path: string) {
  if (!account) return;
  const match = /^(?:resources|notes|tools)\/([\da-f-]{36})(?:\/|$)/.exec(path);
  if (!match) return;
  const state = await offlineState(account.id);
  for (const pkg of state.packages.filter((p) =>
    p.resourceIds.includes(match[1]),
  )) {
    await put(account.id, "packages", {
      ...pkg,
      state: "blocked",
      error:
        "Access changed. Reconnect to review this selection. Existing editor journals are retained for recovery.",
    });
    const entries = await list<OfflineEntry>(account.id, "entries");
    await transact(account.id, ["entries"], "readwrite", (tx) => {
      for (const e of entries)
        if (e.packageId === pkg.id) tx.objectStore("entries").delete(e.key);
    });
  }
  changed();
}
