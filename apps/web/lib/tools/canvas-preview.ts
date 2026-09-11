import { useEffect, useState } from "react";
import type { ResourceCardPreview } from "@axiom/shared/canvas-preview";
import { api } from "../client";
import { useWorkspace } from "../../components/workspace/ui";

// A board cannot flood the API with one request for each of 2,000 cards.
let running = 0;
const waiting: Array<() => void> = [];
async function schedule<T>(
  work: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (running >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
  else running++;
  try {
    signal.throwIfAborted();
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}
export function useCanvasPreview(
  resourceId?: string,
  versionId?: string,
  enabled = true,
) {
  const { revision, session } = useWorkspace();
  const [refresh, setRefresh] = useState(0),
    [settled, setSettled] = useState(revision);
  const [state, setState] = useState<{
    key: string;
    data: ResourceCardPreview | null;
    error: string;
  }>({ key: "", data: null, error: "" });
  const key = `${session.user.id}:${resourceId}:${versionId ?? "latest"}`;
  useEffect(() => {
    const timer = setTimeout(() => setSettled(revision), 300);
    return () => clearTimeout(timer);
  }, [revision]);
  useEffect(() => {
    if (!resourceId || !enabled) return;
    const abort = new AbortController();
    void schedule(
      () =>
        api<ResourceCardPreview>(
          `resources/${resourceId}/card-preview${versionId ? `?version=${versionId}` : ""}`,
          { signal: abort.signal },
        ),
      abort.signal,
    )
      .then((data) => {
        if (!abort.signal.aborted) setState({ key, data, error: "" });
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setState({ key, data: null, error: e.message });
      });
    return () => abort.abort();
  }, [key, resourceId, versionId, enabled, settled, refresh]);
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : "",
    reload: () => setRefresh((v) => v + 1),
  };
}
