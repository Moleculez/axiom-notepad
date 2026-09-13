import JSZip from "jszip";
import type {
  CloudImageDraft,
  CloudImageManifest,
} from "@axiom/shared/image-cloud-drafts";
import type { ImageEditLease } from "@axiom/shared/research-tools";
import { api, ApiError } from "../client";
import { SaveCoordinator } from "../save-coordinator";
import { ImageDocument } from "./image-engine";
import { datasetRequestHeaders } from "../dataset";

export async function openCloudImage(
  id: string,
  manifest: CloudImageManifest,
  signal?: AbortSignal,
) {
  const zip = new JSZip(),
    entries = [
      ...Object.entries(manifest.assets),
      ["preview.png", manifest.preview],
    ];
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (index < entries.length) {
        const [path, asset] = entries[index++];
        const response = await fetch(
          "/api/v1/tools/" + id + "/draft/assets/" + asset,
          { signal, headers: datasetRequestHeaders() },
        );
        if (!response.ok)
          throw new Error(
            "A shared draft asset is unavailable. The last milestone is unchanged.",
          );
        zip.file(path, await response.arrayBuffer());
      }
    }),
  );
  zip.file("manifest.json", JSON.stringify(manifest.project));
  return ImageDocument.open(await zip.generateAsync({ type: "arraybuffer" }));
}
type Working = {
  doc: ImageDocument | null;
  lease: ImageEditLease | null;
  baseVersion: string | null;
  blocked: boolean;
};
export class ImageCloudQueue {
  private saves: SaveCoordinator;
  private known = new Map<string, string>();
  private current = 0;
  private sent = -1;
  private pending: { input: object; docRevision: number } | null = null;
  private closed = false;
  private paused = false;
  private flushing = false;
  private stop: () => void;
  private interval: ReturnType<typeof setInterval>;
  constructor(
    private id: string,
    doc: ImageDocument,
    head: CloudImageDraft | null,
    private state: () => Working,
    private status: (message: string, savedRevision?: number) => void,
  ) {
    this.current = head?.revision ?? 0;
    this.known = new Map(Object.entries(head?.assetHashes ?? {}));
    this.sent = doc.revision;
    this.saves = new SaveCoordinator(() => this.send(), 3000, 15000);
    let last = doc.revision;
    this.stop = doc.subscribe(() => {
      if (doc.revision !== last) {
        last = doc.revision;
        this.saves.changed();
      }
    });
    this.interval = setInterval(() => {
      if (
        !this.closed &&
        !this.paused &&
        !this.state().blocked &&
        navigator.onLine
      )
        void this.saves.confirm().catch(() => {});
    }, 5000);
  }
  dirty() {
    this.sent = -1;
    this.saves.changed();
  }
  async flush() {
    this.flushing = true;
    try {
      await this.saves.flush();
    } finally {
      this.flushing = false;
    }
  }
  reset() {
    this.current = 0;
    this.sent = this.state().doc?.revision ?? -1;
    this.pending = null;
  }
  private async send() {
    const state = this.state();
    if (
      this.closed ||
      this.paused ||
      (state.blocked && !this.flushing) ||
      !state.doc ||
      !state.lease ||
      !navigator.onLine
    )
      throw new Error(
        "Shared draft saving is paused. Local recovery is retained.",
      );
    if (this.sent === state.doc.revision && !this.pending) return;
    try {
      if (!this.pending) {
        const snapshot = await state.doc.snapshot(),
          assets: Record<string, string> = {};
        const transfer = async (asset: { blob: Blob; hash: string }) => {
          const existing = this.known.get(asset.hash);
          if (existing) return existing;
          const response = await fetch(
            "/api/v1/tools/" + this.id + "/draft/assets/" + asset.hash,
            {
              method: "POST",
              body: asset.blob,
              headers: {
                ...datasetRequestHeaders(),
                "content-type": "image/png",
                "x-axiom-image-token": state.lease!.token,
                "x-axiom-image-fence": String(state.lease!.fence),
              },
              signal: AbortSignal.timeout(30000),
            },
          );
          const value = await response.json();
          if (!response.ok)
            throw new ApiError(
              value.error ?? "Image asset upload failed.",
              response.status,
            );
          this.known.set(asset.hash, value.id);
          return value.id as string;
        };
        const uploading = new Map<string, Promise<string>>();
        const upload = (asset: { blob: Blob; hash: string }) => {
          const running = uploading.get(asset.hash);
          if (running) return running;
          const pending = transfer(asset);
          uploading.set(asset.hash, pending);
          return pending;
        };
        // Four binary transfers at a time; identical layers reuse their checksum.
        let index = 0;
        await Promise.all(
          Array.from(
            { length: Math.min(4, snapshot.assets.length) },
            async () => {
              while (index < snapshot.assets.length) {
                const asset = snapshot.assets[index++];
                assets[asset.path] = await upload(asset);
              }
            },
          ),
        );
        const preview = await upload(snapshot.preview);
        this.pending = {
          docRevision: snapshot.revision,
          input: {
            token: state.lease.token,
            fence: state.lease.fence,
            mutationId: crypto.randomUUID(),
            revision: this.current,
            baseVersion: state.baseVersion,
            manifest: { project: snapshot.project, assets, preview },
          },
        };
      }
      const current = this.pending;
      const saved = await api<{ revision: number }>(
        "tools/" + this.id + "/draft",
        { method: "POST", body: JSON.stringify(current.input) },
      );
      this.current = saved.revision;
      this.sent = current.docRevision;
      this.pending = null;
      if (!this.closed)
        this.status(
          "Working draft saved to cloud · Save version creates a milestone",
          current.docRevision,
        );
    } catch (e) {
      const expiredAsset =
        e instanceof ApiError &&
        e.status === 409 &&
        e.message.startsWith("A draft asset is missing");
      if (expiredAsset) {
        this.known.clear();
        this.pending = null;
      }
      if (
        !expiredAsset &&
        e instanceof ApiError &&
        [400, 401, 403, 404, 409, 413].includes(e.status)
      )
        this.paused = true;
      if (!this.closed)
        this.status("Local draft retained · " + (e as Error).message);
      throw e;
    }
  }
  destroy() {
    this.closed = true;
    this.stop();
    clearInterval(this.interval);
    this.saves.destroy();
  }
}
