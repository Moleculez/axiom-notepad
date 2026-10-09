import { uiText, useInterfaceLocale, I18nText } from "@axiom/i18n/react";

import { HelpText } from "../ui/controls";
import type { SchedulePlan } from "@axiom/shared/planning";
export default function ScheduleCapacityPreview({
  capacity,
  mode = "proposed",
}: {
  capacity: SchedulePlan["capacity"];
  mode?: "direct" | "proposed";
}) {
  useInterfaceLocale();
  if (!capacity) return null;
  const n = (v: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(v);
  return (
    <details className="schedule-capacity-preview">
      <summary>
        <I18nText id="Capacity impact ·" /> {capacity[mode].length}{" "}
        <I18nText id="changed member-weeks" />
      </summary>
      <HelpText>
        {capacity.coverage}{" "}
        <I18nText id="No dates or assignments are adjusted automatically." />
      </HelpText>
      {capacity.truncated && (
        <HelpText>
          <I18nText id="Partial preview: first 52 weeks and 200 changed member-weeks. Inspect Group capacity before applying." />
        </HelpText>
      )}
      <div className="productivity-data-scroll">
        <table className="productivity-data-table">
          <thead>
            <tr>
              <th>
                <I18nText id="Member / week" />
              </th>
              <th>
                <I18nText id="Demand before → after" />
              </th>
              <th>
                <I18nText id="Available" />
              </th>
            </tr>
          </thead>
          <tbody>
            {capacity[mode].map((r) => (
              <tr key={`${r.userId}:${r.week}`}>
                <th>
                  {r.name}
                  <small>{r.week}</small>
                </th>
                <td>
                  {n(r.before)} → {n(r.after)} h
                </td>
                <td>
                  {r.available === null
                    ? uiText("Unknown")
                    : `${n(r.available)} h`}
                  {r.available !== null && r.after > r.available && (
                    <small>
                      {n(r.after - r.available)}{" "}
                      <I18nText id="h over capacity" />
                    </small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!capacity[mode].length && (
        <HelpText>
          <I18nText id="No change to allocated estimates within this range. Unestimated, unassigned and undated tasks are not treated as zero work." />
        </HelpText>
      )}
    </details>
  );
}
