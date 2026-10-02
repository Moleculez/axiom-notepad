import { lazy, Suspense, useEffect, useState } from "react";
import { Download, FileQuestion } from "lucide-react";
import type { FilePreviewManifest } from "@axiom/shared/file-preview";
import Dialog, { DialogFooter } from "../../web/components/Dialog";
import { downloadBlob } from "../../web/lib/tools/download";
import { openVisual } from "../../web/lib/visual-assets";
import { store } from "./context";

const Pdf = lazy(
  () => import("../../web/components/workspace/PdfQuickPreview"),
);
export function FilePreview({
  file,
  compact = false,
}: {
  file: FilePreviewManifest;
  compact?: boolean;
}) {
  if (file.kind === "pdf")
    return (
      <Suspense fallback={<p className="demo-fineprint">Opening PDF…</p>}>
        <Pdf source={file.source!} interactive={!compact} />
      </Suspense>
    );
  if (file.kind === "audio")
    return (
      <div className="demo-audio-preview">
        <span>{file.name}</span>
        <audio src={file.source} controls preload="metadata" />
      </div>
    );
  if (file.kind === "video")
    return (
      <video
        className="demo-video-preview"
        src={file.source}
        controls
        preload="metadata"
      />
    );
  if (file.kind === "image")
    return (
      <button
        className="demo-image-preview"
        onClick={() =>
          openVisual({
            items: [
              {
                id: file.resourceId,
                name: file.name,
                kind: "image",
                url: file.source,
                bytes: file.bytes,
                mime: file.mime,
              },
            ],
            index: 0,
          })
        }
      >
        <img src={file.source} alt={file.name} />
        <span>Open image viewer</span>
      </button>
    );
  return (
    <div className="canvas-preview-notice">
      <FileQuestion size={25} />
      <span>{file.name}</span>
      <p>Download to open this format in its native app.</p>
    </div>
  );
}
export default function FileViewer({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const [file, setFile] = useState<FilePreviewManifest | null>(null),
    [error, setError] = useState("");
  const asset = store.getSnapshot().assets.find((a) => a.id === id);
  useEffect(() => {
    let alive = true;
    void store
      .preview(id)
      .then((preview) => {
        if (alive && preview.kind === "file") setFile(preview.file);
      })
      .catch((error) => {
        if (alive) setError(error.message);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <Dialog
      title={asset?.name ?? "Local file"}
      subtitle="A private preview from this device. Nothing is uploaded."
      size="visual"
      className="demo-file-viewer"
      onClose={onClose}
    >
      {error ? (
        <p role="alert">{error}</p>
      ) : file ? (
        <FilePreview file={file} />
      ) : (
        <p>Opening local file…</p>
      )}
      <DialogFooter>
        <span>
          {asset?.mime} · {((asset?.blob.size ?? 0) / 1024).toFixed(1)} KB
        </span>
        <button
          className="button secondary"
          onClick={() => asset && downloadBlob(asset.blob, asset.name)}
        >
          <Download size={15} />
          Download original
        </button>
        <button className="button" onClick={onClose}>
          Done
        </button>
      </DialogFooter>
    </Dialog>
  );
}
