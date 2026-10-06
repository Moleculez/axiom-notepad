"use client";
import { useEffect, useRef, useState } from "react";
import {
  createMindmapComputer,
  type MindmapRequest,
  type MindmapResponse,
} from "@axiom/mindmap/worker";

/** At most one job in flight and one latest pending job. Old results never paint. */
export function useMindmap(request: Omit<MindmapRequest, "id">) {
  const [result, setResult] = useState<
    (MindmapResponse & { source: string }) | null
  >(null);
  const state = useRef<{
    worker: Worker | null;
    serial: number;
    busy: boolean;
    pending: MindmapRequest | null;
    latest: MindmapRequest | null;
    send: (request: MindmapRequest) => void;
  }>({
    worker: null,
    serial: 0,
    busy: false,
    pending: null,
    latest: null,
    send: () => {},
  });
  useEffect(() => {
    const current = state.current;
    const compute = createMindmapComputer();
    let alive = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const completed = (response: MindmapResponse) => {
      if (!alive) return;
      current.busy = false;
      if (alive && response.id === current.latest?.id)
        setResult({ ...response, source: current.latest.source });
      const next = current.pending;
      current.pending = null;
      if (alive && next) current.send(next);
    };
    const fallback = (job: MindmapRequest) => {
      // A CSP/older browser may block workers. Stay usable without external code.
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (alive) completed(compute(job));
      }, 0);
    };
    try {
      current.worker = new Worker(
        new URL("./mindmap-worker.ts", import.meta.url),
        { type: "module" },
      );
      current.worker.onmessage = (event: MessageEvent<MindmapResponse>) =>
        completed(event.data);
      current.worker.onerror = (event) => {
        event.preventDefault();
        if (!alive) return;
        current.worker?.terminate();
        current.worker = null;
        current.busy = false;
        current.pending = null;
        if (current.latest) current.send(current.latest);
      };
    } catch {
      current.worker = null;
    }
    current.send = (job) => {
      if (current.busy) {
        current.pending = job;
        return;
      }
      current.busy = true;
      if (current.worker) current.worker.postMessage(job);
      else fallback(job);
    };
    return () => {
      alive = false;
      clearTimeout(timer);
      if (current.worker) {
        current.worker.onmessage = null;
        current.worker.onerror = null;
        current.worker.terminate();
      }
      current.worker = null;
      current.busy = false;
      current.pending = null;
    };
  }, []);
  useEffect(() => {
    const current = state.current,
      job = { ...request, id: ++current.serial };
    current.latest = job;
    current.send(job);
  }, [request]);
  return result;
}
