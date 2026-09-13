"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { visualOpenEvent, type VisualRequest } from "../lib/visual-assets";
import { claimEditorOverlay, retainEditorCard } from "../lib/editor-popover";
import { useWorkspace } from "./workspace/ui";
import { refreshVisualSurfaces } from "../lib/visual-surface";
const VisualViewer = dynamic(() => import("./visual/VisualViewer"), {
  ssr: false,
});
export default function VisualViewerHost() {
  const { session, revision } = useWorkspace();
  const [request, setRequest] = useState<
      (VisualRequest & { key: string }) | null
    >(null),
    current = useRef(request);
  current.current = request;
  useEffect(() => {
    refreshVisualSurfaces();
  }, [revision, session.user.id]);
  useEffect(() => {
    let active = true,
      running = false;
    const replay = async () => {
      if (
        running ||
        !active ||
        !navigator.onLine ||
        document.visibilityState !== "visible"
      )
        return;
      running = true;
      try {
        const { replayVisualDrafts } = await import("../lib/visual-mark-store");
        if (active) await replayVisualDrafts(session.user.id);
      } catch {
        /* Durable drafts surface errors in the viewer's recovery panel. */
      } finally {
        running = false;
      }
    };
    const tick = () => {
      void replay();
    };
    const timer = setInterval(tick, 10000);
    window.addEventListener("online", tick);
    window.addEventListener("focus", tick);
    void replay();
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", tick);
      window.removeEventListener("focus", tick);
    };
  }, [session.user.id]);
  useEffect(() => {
    let release: (() => void) | undefined, unpin: (() => void) | undefined;
    const close = () => {
      const value = current.current;
      current.current = null;
      setRequest(null);
      release?.();
      unpin?.();
      release = undefined;
      unpin = undefined;
      requestAnimationFrame(() => {
        if (!current.current) value?.restore?.();
      });
    };
    const open = (event: Event) => {
      event.preventDefault();
      close();
      const next = {
        ...(event as CustomEvent<VisualRequest>).detail,
        key: crypto.randomUUID(),
      };
      if (!next.items.length) return;
      current.current = next;
      setRequest(next);
      release = claimEditorOverlay(() => {});
      release();
      release = undefined;
      unpin = retainEditorCard();
    };
    const cancel = () => close();
    window.addEventListener(visualOpenEvent, open);
    window.addEventListener("axiom:route", cancel);
    window.addEventListener("axiom:close-visual", cancel);
    return () => {
      window.removeEventListener(visualOpenEvent, open);
      window.removeEventListener("axiom:route", cancel);
      window.removeEventListener("axiom:close-visual", cancel);
      release?.();
      unpin?.();
    };
  }, [session.user.id]);
  return request ? (
    <VisualViewer
      key={request.key}
      request={request}
      onClose={() => window.dispatchEvent(new Event("axiom:close-visual"))}
    />
  ) : null;
}
