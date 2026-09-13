"use client";
import { useEffect, useRef, useState } from "react";
import Dialog, { DialogFooter } from "../Dialog";
import ImageGeometryDialog, {
  type ImageGeometrySource,
} from "../tools/ImageGeometryDialog";
import type { CropRect } from "../../lib/tools/image-geometry";

export default function AvatarCropDialog({
  file,
  version,
  onClose,
  onSaved,
}: {
  file: File;
  version: number;
  onClose: () => void;
  onSaved: (value: { image: string; version: number }) => void;
}) {
  const [source, setSource] = useState<ImageGeometrySource | null>(null);
  const [error, setError] = useState("");
  const bitmap = useRef<ImageBitmap | null>(null);
  const upload = useRef<AbortController | null>(null);
  useEffect(() => {
    let disposed = false,
      owned: ImageBitmap | undefined;
    void (async () => {
      if (!file.size || file.size > 5 * 1024 * 1024)
        throw new Error("Choose an image smaller than 5 MB.");
      if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type))
        throw new Error("Use a PNG, JPEG, GIF or WebP image.");
      owned = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (disposed) {
        owned.close();
        return;
      }
      if (owned.width * owned.height > 20_000_000)
        throw new Error("Choose a photo with at most 20 megapixels.");
      bitmap.current = owned;
      const scale = Math.min(1, 1600 / Math.max(owned.width, owned.height));
      const image = owned,
        width = Math.max(1, Math.round(image.width * scale)),
        height = Math.max(1, Math.round(image.height * scale));
      setSource({
        width,
        height,
        layers: [],
        selection: null,
        render: (target) => {
          target.width = width;
          target.height = height;
          const ctx = target.getContext("2d")!;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(image, 0, 0, width, height);
          return target;
        },
      });
    })().catch((e) => {
      owned?.close();
      if (!disposed) {
        bitmap.current = null;
        setError(
          e instanceof Error ? e.message : "This image could not be opened.",
        );
      }
    });
    return () => {
      disposed = true;
      owned?.close();
      bitmap.current = null;
      upload.current?.abort();
    };
  }, [file]);
  const save = async (rect: CropRect) => {
    if (!source || !bitmap.current) throw new Error("The image is not ready.");
    const controller = new AbortController();
    upload.current = controller;
    const image = bitmap.current,
      result = document.createElement("canvas");
    result.width = result.height = 256;
    const ctx = result.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      image,
      (rect.x * image.width) / source.width,
      (rect.y * image.height) / source.height,
      (rect.width * image.width) / source.width,
      (rect.height * image.height) / source.height,
      0,
      0,
      256,
      256,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      result.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("The cropped photo could not be prepared.")),
        "image/png",
      ),
    );
    controller.signal.throwIfAborted();
    const body = new FormData();
    body.set("file", blob, "profile-photo.png");
    body.set("version", String(version));
    const response = await fetch("/api/v1/me/avatar", {
      method: "POST",
      body,
      signal: controller.signal,
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error ?? "Photo upload failed. Please try again.");
    if (!controller.signal.aborted) onSaved(value);
  };
  return source ? (
    <ImageGeometryDialog
      doc={source}
      mode="crop"
      avatar
      editable
      onClose={onClose}
      onApply={save}
    />
  ) : (
    <Dialog title="Crop profile picture" onClose={onClose}>
      <p role={error ? "alert" : "status"}>{error || "Opening your photo…"}</p>
      <DialogFooter>
        <button type="button" className="button secondary" onClick={onClose}>
          Cancel
        </button>
      </DialogFooter>
    </Dialog>
  );
}
