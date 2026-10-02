import { preferencesSchema, type Preferences } from "@axiom/shared/appearance";
import {
  editorDefaults,
  editorPreferencesSchema,
  type EditorPreferences,
} from "@axiom/shared/editor";
import { parseCanvas, type CanvasData } from "@axiom/shared/canvas";
import type { Resource } from "@axiom/shared/workspace";
import type { ResourceCardPreview } from "@axiom/shared/canvas-preview";
import { z } from "zod";
import {
  samples,
  sampleCanvas,
  canvasId,
  researchId,
  paperAppearance,
  figure,
  imageId,
  imagePath,
} from "./samples";

export type LocalDocument = {
  id: string;
  title: string;
  kind: "markdown" | "canvas" | "text";
  source: string;
  modified: string;
};
export type LocalAsset = {
  id: string;
  name: string;
  path: string;
  mime: string;
  blob: Blob;
};
type StoredAsset = Omit<LocalAsset, "blob"> & { bytes: ArrayBuffer };
async function storeAsset(asset: LocalAsset): Promise<StoredAsset> {
  const { blob, ...fields } = asset;
  return { ...fields, bytes: await blob.arrayBuffer() };
}
export type Snapshot = {
  ready: boolean;
  documents: LocalDocument[];
  assets: LocalAsset[];
  appearance: Preferences;
  editor: EditorPreferences;
  active: string;
  revision: number;
  status: string;
  error: string;
};
export const fileLimit = 100 * 1024 * 1024;
const timestamp = () => new Date().toISOString();
export const safeName = (name: string) =>
  name.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 180) || "untitled";
export const notePath = (doc: LocalDocument) =>
  `notes/${doc.id}/${safeName(doc.title)}.${doc.kind === "canvas" ? "canvas" : doc.kind === "text" ? "txt" : "md"}`;
function mimeFor(file: File) {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return (
    (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
        avif: "image/avif",
        pdf: "application/pdf",
        mp3: "audio/mpeg",
        wav: "audio/wav",
        ogg: "audio/ogg",
        mp4: "video/mp4",
        webm: "video/webm",
        md: "text/markdown",
        txt: "text/plain",
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
}
export const markdownPath = (path: string) =>
  encodeURI(path).replace(
    /[()#?]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
function request<T>(work: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    work.onsuccess = () => resolve(work.result);
    work.onerror = () => reject(work.error);
  });
}
function complete(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () =>
      reject(tx.error ?? new Error("Browser storage is unavailable."));
  });
}
function cachedAppearance() {
  try {
    const stored = localStorage.getItem("axiom-showcase:appearance");
    if (stored) {
      const value = preferencesSchema.safeParse(JSON.parse(stored));
      if (value.success) return value.data;
    }
  } catch {
    /* IndexedDB remains the durable primary store. */
  }
  return undefined;
}
function cachedEditor() {
  try {
    const stored = localStorage.getItem("axiom-showcase:editor");
    if (stored) {
      const result = editorPreferencesSchema.safeParse(JSON.parse(stored));
      if (result.success) return result.data;
    }
  } catch {
    /* Optional immediate preference cache. */
  }
  return undefined;
}

/** Separate guest database; assets are never rewritten while typing a note. */
export class ShowcaseStore {
  private state: Snapshot = {
    ready: false,
    documents: [],
    assets: [],
    appearance: paperAppearance,
    editor: editorDefaults,
    active: researchId,
    revision: 0,
    status: "Opening local drafts…",
    error: "",
  };
  private db: IDBDatabase | null = null;
  private loading: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private urls = new Map<string, string>();
  private dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving = false;
  private serial = 0;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  hasUnsavedContent = () => this.dirty.size > 0;
  private publish(change: Partial<Snapshot>) {
    this.state = {
      ...this.state,
      ...change,
      revision: this.state.revision + 1,
    };
    this.listeners.forEach((listener) => listener());
  }
  load() {
    if (this.loading) return this.loading;
    this.loading = this.initialize();
    return this.loading;
  }
  private async initialize() {
    try {
      const opening = indexedDB.open("axiom-showcase-v1", 1);
      opening.onupgradeneeded = () => {
        for (const store of ["documents", "assets", "settings"])
          opening.result.createObjectStore(store, { keyPath: "id" });
      };
      this.db = await request(opening);
      this.db.onversionchange = () => {
        this.db?.close();
        this.db = null;
        this.publish({
          error:
            "Local storage changed in another tab. Reload to reconnect; download any unsaved work first.",
        });
      };
      const tx = this.db.transaction(
        ["documents", "assets", "settings"],
        "readonly",
      );
      const [documents, assets, settings] = await Promise.all([
        request(tx.objectStore("documents").getAll()),
        request(tx.objectStore("assets").getAll()),
        request(tx.objectStore("settings").get("preferences")),
      ]);
      if (documents.length) {
        const appearance = preferencesSchema.safeParse(settings?.appearance);
        this.publish({
          ready: true,
          documents,
          assets: assets.map((asset: StoredAsset & { blob?: Blob }) => ({
            id: asset.id,
            name: asset.name,
            path: asset.path,
            mime: asset.mime,
            blob: asset.blob ?? new Blob([asset.bytes], { type: asset.mime }),
          })),
          appearance:
            cachedAppearance() ??
            (appearance.success ? appearance.data : paperAppearance),
          editor:
            cachedEditor() ??
            editorPreferencesSchema
              .catch(editorDefaults)
              .parse(settings?.editor ?? {}),
          active: documents.some(
            (d: LocalDocument) => d.id === settings?.active,
          )
            ? settings.active
            : documents[0].id,
          status: "Saved on this device",
        });
        return;
      }
    } catch {
      this.publish({
        error:
          "Browser storage is unavailable. You can still edit and download your work in this session.",
      });
    }
    this.seed();
    await this.flush(true);
  }
  private seed() {
    const documents: LocalDocument[] = [
      ...samples.map((doc) => ({ ...doc, modified: timestamp() })),
      {
        id: canvasId,
        title: "A question and its evidence",
        kind: "canvas",
        source: JSON.stringify(sampleCanvas),
        modified: timestamp(),
      },
    ];
    this.dirty = new Set(documents.map((d) => d.id));
    this.publish({
      ready: true,
      documents,
      assets: [
        {
          id: imageId,
          name: "spectral-model.svg",
          path: imagePath,
          mime: "image/svg+xml",
          blob: new Blob([figure], { type: "image/svg+xml" }),
        },
      ],
      active: researchId,
      appearance: cachedAppearance() ?? paperAppearance,
      editor: cachedEditor() ?? editorDefaults,
      status: this.db ? "Saving locally…" : "Session only",
    });
  }
  private schedule() {
    this.serial++;
    clearTimeout(this.timer);
    this.publish({ status: this.db ? "Saving locally…" : "Session only" });
    this.timer = setTimeout(() => void this.flush(), 650);
  }
  async flush(includeAssets = false) {
    clearTimeout(this.timer);
    if (!this.db || this.saving) return;
    this.saving = true;
    const serial = this.serial,
      ids = [...this.dirty],
      state = this.state;
    try {
      // Prepare bytes before opening the transaction. Awaiting inside a live
      // IndexedDB transaction can make Safari mark it inactive.
      const assets = includeAssets
        ? await Promise.all(state.assets.map(storeAsset))
        : [];
      const tx = this.db.transaction(
          includeAssets
            ? ["documents", "assets", "settings"]
            : ["documents", "settings"],
          "readwrite",
        ),
        done = complete(tx);
      for (const id of ids) {
        const doc = state.documents.find((d) => d.id === id);
        if (doc) tx.objectStore("documents").put(doc);
        else tx.objectStore("documents").delete(id);
      }
      if (includeAssets)
        for (const asset of assets) tx.objectStore("assets").put(asset);
      tx.objectStore("settings").put({
        id: "preferences",
        appearance: state.appearance,
        editor: state.editor,
        active: state.active,
      });
      await done;
      if (serial === this.serial) {
        ids.forEach((id) => this.dirty.delete(id));
        this.publish({ status: "Saved on this device", error: "" });
      }
    } catch {
      this.publish({
        status: "Not saved",
        error:
          "Could not save in browser storage. Your working session is intact; export it before leaving or free some storage.",
      });
    } finally {
      this.saving = false;
      if (serial !== this.serial)
        this.timer = setTimeout(() => void this.flush(), 650);
    }
  }
  document(id: string) {
    return this.state.documents.find((d) => d.id === id);
  }
  filePath = (resource: Resource) => {
    const doc = this.document(resource.id);
    return doc
      ? notePath(doc)
      : (this.state.assets.find((a) => a.id === resource.id)?.path ??
          resource.name);
  };
  update(id: string, source: string) {
    const doc = this.document(id);
    if (!doc || doc.source === source) return;
    this.dirty.add(id);
    this.publish({
      documents: this.state.documents.map((d) =>
        d.id === id ? { ...d, source, modified: timestamp() } : d,
      ),
    });
    this.schedule();
  }
  rename(id: string, title: string) {
    if (!title.trim()) return;
    this.dirty.add(id);
    this.publish({
      documents: this.state.documents.map((d) =>
        d.id === id
          ? { ...d, title: title.trim().slice(0, 200), modified: timestamp() }
          : d,
      ),
    });
    this.schedule();
  }
  select(id: string) {
    if (!this.document(id)) return;
    this.publish({ active: id });
    this.schedule();
  }
  appearance(value: Preferences) {
    const appearance = preferencesSchema.parse(value);
    try {
      localStorage.setItem(
        "axiom-showcase:appearance",
        JSON.stringify(appearance),
      );
    } catch {
      /* Explicit DB save status still reports persistence. */
    }
    this.publish({ appearance });
    this.schedule();
  }
  editor(value: EditorPreferences) {
    const editor = editorPreferencesSchema.parse(value);
    try {
      localStorage.setItem("axiom-showcase:editor", JSON.stringify(editor));
    } catch {
      /* IndexedDB remains the durable primary store. */
    }
    this.publish({ editor });
    this.schedule();
  }
  create(
    title = "Untitled research note",
    kind: LocalDocument["kind"] = "markdown",
    source = "",
  ) {
    const doc = {
      id: crypto.randomUUID(),
      title,
      kind,
      source,
      modified: timestamp(),
    };
    this.dirty.add(doc.id);
    this.publish({ documents: [...this.state.documents, doc], active: doc.id });
    this.schedule();
    return doc;
  }
  reset(id: string) {
    const sample = samples.find((d) => d.id === id);
    this.update(
      id,
      sample?.source ??
        (this.document(id)?.kind === "canvas"
          ? JSON.stringify(sampleCanvas)
          : ""),
    );
  }
  url(asset: LocalAsset) {
    let url = this.urls.get(asset.id);
    if (!url) {
      url = URL.createObjectURL(asset.blob);
      this.urls.set(asset.id, url);
    }
    return url;
  }
  resolveImage = (href: string) => {
    try {
      href = decodeURIComponent(href);
    } catch {
      return undefined;
    }
    const asset = this.state.assets.find(
      (a) => a.path === href || a.name === href,
    );
    return asset?.mime.startsWith("image/") ? this.url(asset) : undefined;
  };
  resource(id: string): Resource {
    const doc = this.document(id),
      asset = this.state.assets.find((a) => a.id === id);
    if (!doc && !asset)
      throw new Error(
        "This local file is missing. Import the original file or relink the card.",
      );
    return {
      id,
      name: doc?.title ?? asset!.name,
      kind: doc ? "note" : "file",
      space_id: "showcase",
      parent_id: null,
      description: "",
      owner_id: "local",
      note_id: doc ? id : null,
      current_version_id: asset ? id : null,
      version: 1,
      tags: [],
      created_at: doc?.modified ?? "",
      updated_at: doc?.modified ?? "",
      deleted_at: null,
      document_type:
        doc?.kind === "canvas"
          ? "canvas"
          : doc?.kind === "text"
            ? "text"
            : doc
              ? "markdown"
              : undefined,
      mime: asset?.mime,
      bytes: asset?.blob.size,
      role: "editor",
    };
  }
  resources(query = "") {
    return [...this.state.documents, ...this.state.assets]
      .map((entry) => this.resource(entry.id))
      .filter((r) => r.name.toLowerCase().includes(query.toLowerCase()));
  }
  preview = async (id: string): Promise<ResourceCardPreview> => {
    const resource = this.resource(id),
      doc = this.document(id);
    if (doc)
      return {
        resource,
        revision: doc.modified,
        kind: "document",
        format: doc.kind,
        source: doc.source,
        settings: {},
      };
    const asset = this.state.assets.find((a) => a.id === id)!;
    const kind = asset.mime.startsWith("image/")
      ? "image"
      : asset.mime.startsWith("audio/")
        ? "audio"
        : asset.mime.startsWith("video/")
          ? "video"
          : asset.mime === "application/pdf"
            ? "pdf"
            : "download";
    return {
      resource,
      revision: asset.id,
      kind: "file",
      file: {
        resourceId: id,
        versionId: id,
        name: asset.name,
        bytes: asset.blob.size,
        mime: asset.mime,
        kind,
        source: this.url(asset),
        status: "ready",
      },
    };
  };
  normalizeCanvas = (data: CanvasData): CanvasData => ({
    ...data,
    nodes: data.nodes.map((n) => {
      if (n.type !== "file") return n;
      const entry = [
        ...this.state.assets.map((a) => ({
          id: a.id,
          path: a.path,
          name: a.name,
        })),
        ...this.state.documents.map((d) => ({
          id: d.id,
          path: notePath(d),
          name: d.title,
        })),
      ].find((a) => a.path === n.file || a.name === n.file);
      return entry ? { ...n, resourceId: entry.id } : n;
    }),
  });
  async importFiles(files: File[]) {
    if (files.some((file) => file.size > fileLimit))
      throw new Error("Choose files smaller than 100 MB each.");
    if (files.length > 30) throw new Error("Import up to 30 files at a time.");
    if (
      files.some(
        (file) =>
          /\.(md|markdown|txt|tex|canvas)$/i.test(file.name) &&
          file.size > 5_000_000,
      )
    )
      throw new Error("Text and Canvas imports support up to 5 MB.");
    const estimate = await navigator.storage
      ?.estimate()
      .catch(() => ({}) as StorageEstimate);
    if (
      estimate?.quota &&
      files.reduce((sum, f) => sum + f.size, 0) >
        estimate.quota - (estimate.usage ?? 0)
    )
      throw new Error(
        "Not enough browser storage. Download and clear older local files, then try again.",
      );
    const entries: Resource[] = [];
    for (const file of files) {
      if (/\.zip$/i.test(file.name)) {
        entries.push(...(await this.restoreBundle(file)));
        continue;
      }
      if (/\.(md|markdown|txt|tex|canvas)$/i.test(file.name)) {
        if (file.size > 5_000_000)
          throw new Error("Text and Canvas imports support up to 5 MB.");
        const kind = /\.canvas$/i.test(file.name)
          ? "canvas"
          : /\.(md|markdown)$/i.test(file.name)
            ? "markdown"
            : "text";
        const source = await file.text();
        const doc = this.create(
          file.name.replace(/\.(md|markdown|txt|tex|canvas)$/i, ""),
          kind,
          kind === "canvas"
            ? JSON.stringify(this.normalizeCanvas(parseCanvas(source)))
            : source,
        );
        entries.push(this.resource(doc.id));
      } else {
        const id = crypto.randomUUID(),
          name = safeName(file.name),
          mime = mimeFor(file);
        const asset: LocalAsset = {
          id,
          name,
          mime:
            mime === "image/svg+xml" || /\.svg$/i.test(name)
              ? "application/octet-stream"
              : mime,
          path: `assets/${id}/${name}`,
          blob: file,
        };
        if (this.db) {
          const record = await storeAsset(asset);
          const tx = this.db.transaction("assets", "readwrite"),
            done = complete(tx);
          tx.objectStore("assets").put(record);
          try {
            await done;
          } catch {
            throw new Error(
              "This file could not be stored. Free browser storage and retry; existing drafts are intact.",
            );
          }
        }
        this.publish({ assets: [...this.state.assets, asset] });
        entries.push(this.resource(id));
      }
    }
    await this.flush();
    return entries;
  }
  /** Additive restore: existing drafts are never replaced, even on ID collision. */
  private async restoreBundle(file: File) {
    const { default: JSZip } = await import("jszip"),
      zip = await JSZip.loadAsync(await file.arrayBuffer());
    const members = Object.values(zip.files);
    if (members.length > 2500)
      throw new Error("This backup has too many files (maximum 2,500).");
    let total = 0;
    for (const member of members) {
      const bytes =
        (member as unknown as { _data?: { uncompressedSize?: number } })._data
          ?.uncompressedSize ?? 0;
      total += bytes;
      if (bytes > fileLimit || total > 512 * 1024 * 1024)
        throw new Error("This backup exceeds the safe 512 MB unpacking limit.");
    }
    const manifestFile = zip.file("manifest.json");
    if (
      !manifestFile ||
      ((manifestFile as unknown as { _data: { uncompressedSize: number } })
        ._data?.uncompressedSize ?? 0) > 1_000_000
    )
      throw new Error("Choose a ZIP exported from this showcase.");
    const path = z
      .string()
      .min(1)
      .max(400)
      .refine(
        (p) =>
          !p.startsWith("/") &&
          !p.includes("\\") &&
          p
            .split("/")
            .every((part) => part !== ".." && part !== "." && part.length > 0),
      );
    const manifest = z
      .object({
        format: z.literal("axiom-showcase-backup"),
        version: z.literal(1),
        documents: z
          .array(
            z.object({
              id: z.uuid(),
              title: z.string().max(200),
              kind: z.enum(["markdown", "text", "canvas"]),
              path,
            }),
          )
          .max(500),
        assets: z
          .array(
            z.object({
              id: z.uuid(),
              name: z.string().max(180),
              mime: z.string().max(150),
              path,
            }),
          )
          .max(1500),
      })
      .parse(JSON.parse(await manifestFile.async("string")));
    const used = new Set(
        [...this.state.documents, ...this.state.assets].map((e) => e.id),
      ),
      mappings = new Map<string, string>(),
      pathMap = new Map<string, string>();
    const allocate = (id: string) => {
      if (mappings.has(id))
        throw new Error("This backup contains duplicate file IDs.");
      const next = used.has(id) ? crypto.randomUUID() : id;
      used.add(next);
      mappings.set(id, next);
      return next;
    };
    const assets: LocalAsset[] = [];
    for (const item of manifest.assets) {
      const member = zip.file(item.path);
      if (!member) throw new Error(`Backup is missing ${item.name}.`);
      const id = allocate(item.id),
        name = safeName(item.name),
        nextPath = `assets/${id}/${name}`;
      pathMap.set(item.path, nextPath);
      const bytes = await member.async("arraybuffer");
      // Only our exact bundled vector is trusted; a claimed ID is not trust.
      const mime =
        (item.mime === "image/svg+xml" || /\.svg$/i.test(name)) &&
        new TextDecoder().decode(bytes) !== figure
          ? "application/octet-stream"
          : item.mime;
      assets.push({
        id,
        name,
        path: nextPath,
        mime,
        blob: new Blob([bytes], { type: mime }),
      });
    }
    const documents: LocalDocument[] = [];
    for (const item of manifest.documents) {
      const member = zip.file(item.path);
      if (!member) throw new Error(`Backup is missing ${item.title}.`);
      const id = allocate(item.id),
        source = await member.async("string");
      if (source.length > 5_000_000)
        throw new Error("A document in this backup exceeds 5 MB.");
      const doc = {
        id,
        title: item.title,
        kind: item.kind,
        source,
        modified: timestamp(),
      };
      pathMap.set(item.path, notePath(doc));
      documents.push(doc);
    }
    const rewrite = (source: string) => {
      for (const [from, to] of pathMap) {
        source = source
          .split(`../../${markdownPath(from)}`)
          .join(markdownPath(to));
        source = source.split(markdownPath(from)).join(markdownPath(to));
        source = source.split(from).join(to);
      }
      return source;
    };
    for (const doc of documents) {
      doc.source = rewrite(doc.source);
      if (doc.kind === "canvas") {
        const parsed = parseCanvas(doc.source);
        doc.source = JSON.stringify({
          ...parsed,
          nodes: parsed.nodes.map((n) => {
            if (n.type !== "file") return n;
            const entry = [
              ...assets.map((a) => ({ id: a.id, path: a.path })),
              ...documents.map((d) => ({ id: d.id, path: notePath(d) })),
            ].find((e) => e.path === n.file);
            return entry ? { ...n, resourceId: entry.id } : n;
          }),
        });
      }
    }
    if (this.db) {
      const records = await Promise.all(assets.map(storeAsset));
      const tx = this.db.transaction(["documents", "assets"], "readwrite"),
        done = complete(tx);
      for (const doc of documents) tx.objectStore("documents").put(doc);
      for (const asset of records) tx.objectStore("assets").put(asset);
      await done;
    }
    this.publish({
      documents: [...this.state.documents, ...documents],
      assets: [...this.state.assets, ...assets],
    });
    this.schedule();
    return [...documents, ...assets].map((e) => this.resource(e.id));
  }
  async clear() {
    clearTimeout(this.timer);
    if (this.saving)
      throw new Error(
        "Wait for the local save to finish, then clear the demo.",
      );
    if (this.db) {
      const tx = this.db.transaction(
          ["documents", "assets", "settings"],
          "readwrite",
        ),
        done = complete(tx);
      for (const name of ["documents", "assets", "settings"])
        tx.objectStore(name).clear();
      await done;
    }
    try {
      localStorage.removeItem("axiom-showcase:appearance");
      localStorage.removeItem("axiom-showcase:editor");
    } catch {
      /* Optional quick preference cache. */
    }
    this.urls.forEach((url) => URL.revokeObjectURL(url));
    this.urls.clear();
    this.seed();
    await this.flush(true);
  }
}
