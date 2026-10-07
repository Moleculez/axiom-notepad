"use client";
import { useEffect, useRef, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import { MousePointer2 } from "lucide-react";
import { LatestFrame } from "../../lib/latest-frame";
type Peer = { id: number; name: string; color: string; x: number; y: number };
/** Cursor packets repaint only the overlay, not cards/edges or sizing owners. */
export default function CanvasCursors({
  awareness,
  onCount,
}: {
  awareness: Awareness | null;
  onCount: (count: number) => void;
}) {
  const [peers, setPeers] = useState<Peer[]>([]);
  const count = useRef(onCount);
  count.current = onCount;
  useEffect(() => {
    if (!awareness) {
      setPeers([]);
      count.current(0);
      return;
    }
    const frames = new LatestFrame<Peer[]>((next) => {
      setPeers((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
      count.current(next.length);
    });
    const update = () =>
      frames.push(
        [...awareness.getStates()].flatMap(([id, state]) =>
          id === awareness.clientID ||
          !state.canvas ||
          !Number.isFinite(state.canvas.x) ||
          !Number.isFinite(state.canvas.y)
            ? []
            : [
                {
                  id,
                  name: String(state.user?.name ?? "Collaborator").slice(
                    0,
                    100,
                  ),
                  color: /^#[\da-f]{6}$/i.test(state.user?.color)
                    ? state.user.color
                    : "#7080a0",
                  x: state.canvas.x,
                  y: state.canvas.y,
                },
              ],
        ),
      );
    awareness.on("change", update);
    update();
    return () => {
      frames.cancel();
      awareness.off("change", update);
    };
  }, [awareness]);
  return (
    <>
      {peers.map((peer) => (
        <div
          key={peer.id}
          className="canvas-peer"
          style={{ left: peer.x, top: peer.y, color: peer.color }}
        >
          <MousePointer2 size={17} />
          <span style={{ background: peer.color }}>{peer.name}</span>
        </div>
      ))}
    </>
  );
}
