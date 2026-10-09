import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";
import type { MindmapStatus } from "../../lib/mindmap-state";

/** The host's single document footer owns these view statistics. */
export default function MindmapFooterInfo({
  status,
}: {
  status: MindmapStatus | null;
}) {
  useInterfaceLocale();
  if (!status)
    return (
      <span>
        <I18nText id="Mind map" />
      </span>
    );
  return (
    <span
      className="mindmap-footer-info"
      aria-label={uiText("Mind-map statistics")}
    >
      {status.total} <I18nText id="nodes ·" /> {status.shown}{" "}
      <I18nText id="shown" />
      {status.supporting ? ` · ${status.supporting} supporting` : ""}
      {status.selected > 1 ? ` · ${status.selected} selected` : ""}
      {status.readOnly ? uiText(" · Read only") : ""}
    </span>
  );
}
