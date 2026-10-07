import type { MindmapStatus } from "../../lib/mindmap-state";

/** The host's single document footer owns these view statistics. */
export default function MindmapFooterInfo({
  status,
}: {
  status: MindmapStatus | null;
}) {
  if (!status) return <span>Mind map</span>;
  return (
    <span className="mindmap-footer-info" aria-label="Mind-map statistics">
      {status.total} nodes · {status.shown} shown
      {status.supporting ? ` · ${status.supporting} supporting` : ""}
      {status.selected > 1 ? ` · ${status.selected} selected` : ""}
      {status.readOnly ? " · Read only" : ""}
    </span>
  );
}
