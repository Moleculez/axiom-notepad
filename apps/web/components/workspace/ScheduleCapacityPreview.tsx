import type { SchedulePlan } from "@axiom/shared/planning";
export default function ScheduleCapacityPreview({
  capacity,
  mode = "proposed",
}: {
  capacity: SchedulePlan["capacity"];
  mode?: "direct" | "proposed";
}) {
  if (!capacity) return null;
  const n = (v: number) =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(v);
  return (
    <details className="schedule-capacity-preview">
      <summary>
        Capacity impact · {capacity[mode].length} changed member-weeks
      </summary>
      <p className="ws-note">
        {capacity.coverage} No dates or assignments are adjusted automatically.
      </p>
      {capacity.truncated && (
        <p className="ws-note">
          Partial preview: first 52 weeks and 200 changed member-weeks. Inspect
          Group capacity before applying.
        </p>
      )}
      <div className="productivity-data-scroll">
        <table className="productivity-data-table">
          <thead>
            <tr>
              <th>Member / week</th>
              <th>Demand before → after</th>
              <th>Available</th>
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
                  {r.available === null ? "Unknown" : `${n(r.available)} h`}
                  {r.available !== null && r.after > r.available && (
                    <small>{n(r.after - r.available)} h over capacity</small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!capacity[mode].length && (
        <p className="ws-note">
          No change to allocated estimates within this range. Unestimated,
          unassigned and undated tasks are not treated as zero work.
        </p>
      )}
    </details>
  );
}
