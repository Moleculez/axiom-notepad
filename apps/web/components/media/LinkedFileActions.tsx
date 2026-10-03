"use client";
import { ActionRow, Button, IconButton } from "../ui/controls";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Columns2, X } from "lucide-react";
import { attachmentVersion } from "@axiom/markdown";
import type { ResolvedAsset } from "@axiom/shared/editor-media";
import type { Resource } from "@axiom/shared/workspace";
import { api } from "../../lib/client";
import { ErrorNotice, Loading, useWorkspace } from "../workspace/ui";
import FileIdentity from "./FileIdentity";

/** Metadata-only actions: hovering never loads or renders attachment contents. */
export default function LinkedFileActions({
  root,
}: {
  root: RefObject<HTMLElement | null>;
}) {
  const { open } = useWorkspace();
  const [target, setTarget] = useState<{
      version: string;
      x: number;
      y: number;
    } | null>(null),
    [resource, setResource] = useState<Resource | null>(null),
    [error, setError] = useState("");
  const popup = useRef<HTMLDivElement>(null);
  const dismiss = useRef(() => {});
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let timer: ReturnType<typeof setTimeout> | undefined,
      closeTimer: ReturnType<typeof setTimeout> | undefined,
      active: Element | null = null;
    const close = () => {
      clearTimeout(timer);
      clearTimeout(closeTimer);
      active = null;
      setTarget(null);
    };
    dismiss.current = close;
    const enter = (event: Event) => {
      const element = event.target instanceof Element ? event.target : null;
      if (element && popup.current?.contains(element)) {
        clearTimeout(closeTimer);
        return;
      }
      const link = element?.closest<HTMLElement>(
        "a[href], .axiom-inline-link[data-target]",
      );
      const version =
        link &&
        attachmentVersion(
          link.getAttribute("href") ?? link.dataset.target ?? "",
        );
      if (!link || !version || !host.contains(link)) {
        clearTimeout(timer);
        if (active) {
          clearTimeout(closeTimer);
          closeTimer = setTimeout(close, 180);
        }
        return;
      }
      clearTimeout(closeTimer);
      if (active === link) return;
      active = link;
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          const rect = link.getBoundingClientRect();
          setTarget({
            version,
            x: Math.max(16, Math.min(rect.left, window.innerWidth - 336)),
            y: Math.max(
              16,
              Math.min(rect.bottom + 8, window.innerHeight - 240),
            ),
          });
        },
        event.type === "focusin" ? 0 : 420,
      );
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("focusin", enter);
    document.addEventListener("keydown", escape);
    host.addEventListener("scroll", close, { passive: true });
    return () => {
      dismiss.current = () => {};
      clearTimeout(timer);
      clearTimeout(closeTimer);
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("keydown", escape);
      host.removeEventListener("scroll", close);
    };
  }, [root]);
  useEffect(() => {
    setResource(null);
    setError("");
    if (!target) return;
    const controller = new AbortController();
    void api<ResolvedAsset[]>("media-assets", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({ versions: [target.version] }),
    })
      .then(async ([asset]) => {
        if (!asset?.resourceId)
          throw new Error("This attachment is missing or inaccessible.");
        const resource = await api<Resource>(`resources/${asset.resourceId}`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted)
          setResource({
            ...resource,
            current_version_id: asset.versionId,
            mime: asset.mime,
            bytes: asset.bytes,
          });
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [target]);
  if (!target) return null;
  return createPortal(
    <div
      ref={popup}
      role="dialog"
      aria-label="Linked file actions"
      className="linked-file-actions"
      style={{
        left: target.x,
        top: target.y,
        maxHeight: `calc(100vh - ${target.y + 16}px)`,
      }}
    >
      <div className="linked-file-actions-heading">
        <h3>{resource?.name ?? "Attachment"}</h3>
        <span className="tool-spacer" />
        <IconButton
          className="icon-button"
          aria-label="Close file actions"
          onClick={() => dismiss.current()}
        >
          <X size={14} />
        </IconButton>
      </div>
      <ErrorNotice message={error} />
      {resource ? (
        <>
          <ActionRow>
            <Button
              className="button secondary"
              onClick={() => {
                open({ id: resource.id, kind: "file" });
                dismiss.current();
              }}
            >
              <ExternalLink size={14} />
              Open
            </Button>
            <Button
              className="button secondary"
              onClick={() => {
                open({ id: resource.id, kind: "file" }, true);
                dismiss.current();
              }}
            >
              <Columns2 size={14} />
              Open beside
            </Button>
          </ActionRow>
          <FileIdentity
            key={`${resource.id}:${target.version}`}
            resource={resource}
          />
        </>
      ) : (
        !error && <Loading label="Checking file access…" />
      )}
    </div>,
    document.body,
  );
}
