import { useMemo, useRef } from "react";
import type { NativeBinding } from "@axiom/editor/binding";
import type { MindmapProjection } from "@axiom/mindmap";

/** React/measurement identity follows collaborative ranges, not positional IDs. */
export function useMindmapIdentities(
  binding: NativeBinding,
  projection?: MindmapProjection,
) {
  const serial = useRef(0),
    entries = useRef<
      {
        key: string;
        type: string;
        bookmark: ReturnType<NativeBinding["relative"]>;
      }[]
    >([]);
  return useMemo(() => {
    const candidates = new Map<string, (typeof entries.current)[number]>();
    for (const entry of entries.current) {
      const range = binding.absolute(entry.bookmark);
      if (range && range.anchor < range.head)
        candidates.set(`${entry.type}:${range.anchor}`, entry);
    }
    const keys = new Map<string, string>(),
      next: typeof entries.current = [];
    for (const node of projection?.nodes ?? []) {
      if (node.kind === "root" || node.id === "supporting") {
        keys.set(node.id, node.id);
        continue;
      }
      const type = `${node.kind}:${node.blockType}`,
        old = candidates.get(`${type}:${node.from}`);
      const entry = old ?? {
        key: `branch-${++serial.current}`,
        type,
        bookmark: binding.relative({ anchor: node.from, head: node.to }),
      };
      next.push(entry);
      keys.set(node.id, entry.key);
    }
    entries.current = next;
    return keys;
  }, [binding, projection]);
}
