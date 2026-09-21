"use client";
import { useEffect, useState } from "react";
import { Archive, Camera, ChartNoAxesCombined, Pencil, X } from "lucide-react";
import type { Space } from "@axiom/shared/workspace";
import type { PlanningTask } from "@axiom/shared/planning";
import type {
  BaselineSnapshot,
  PlanningAnalysis,
  compareBaseline,
} from "@axiom/shared/planning-analysis";
import { promptValue } from "../../lib/app-prompt";
import {
  ErrorNotice,
  mutate,
  useAction,
  useData,
  useWorkspace,
  WorkspaceLink,
} from "./ui";
type Baseline = {
  id: string;
  name: string;
  created_at: string;
  archived: boolean;
  version: number;
};
export default function PlanningInsights({
  space,
  version,
  onLayers,
  onClose,
}: {
  space: Space;
  version: number;
  onLayers: (analysis: PlanningAnalysis | null, tasks: PlanningTask[]) => void;
  onClose: () => void;
}) {
  const { revision, refresh } = useWorkspace(),
    action = useAction();
  const analysis = useData<PlanningAnalysis>(
      `spaces/${space.id}/planning-analysis`,
      revision,
    ),
    bases = useData<Baseline[]>(`spaces/${space.id}/baselines`, revision);
  const [base, setBase] = useState(""),
    [compare, setCompare] = useState("current"),
    [highlight, setHighlight] = useState(true);
  const detail = useData<{
    snapshot: BaselineSnapshot;
    comparison: ReturnType<typeof compareBaseline>;
  }>(
    base ? `spaces/${space.id}/baselines/${base}?compare=${compare}` : null,
    revision,
  );
  useEffect(() => {
    onLayers(
      highlight ? analysis.data : null,
      detail.data?.snapshot.tasks ?? [],
    );
  }, [analysis.data, detail.data, highlight, onLayers]);
  useEffect(() => () => onLayers(null, []), [onLayers]);
  const capture = () =>
    void action.run(async () => {
      const name = await promptValue("Name this immutable planning snapshot.", {
        title: "Capture baseline",
        defaultValue: `Baseline ${new Date().toLocaleDateString()}`,
      });
      if (!name) return;
      const result = await mutate(`spaces/${space.id}/baselines`, {
        name,
        version,
      });
      setBase(result.id);
      refresh();
    });
  return (
    <section className="planning-insights" aria-label="Schedule insights">
      <header className="productivity-subtoolbar">
        <ChartNoAxesCombined size={17} />
        <strong>Schedule insights</strong>
        <span className="planning-spacer" />
        <button
          type="button"
          className="icon-button"
          aria-label="Close schedule insights"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <ErrorNotice
        message={action.error || analysis.error || bases.error || detail.error}
        retry={() => {
          analysis.reload();
          bases.reload();
          detail.reload();
        }}
      />
      <div className="productivity-subtoolbar">
        <label className="productivity-check">
          <input
            type="checkbox"
            checked={highlight}
            onChange={(e) => setHighlight(e.target.checked)}
          />
          Critical path
        </label>
        <span>
          {analysis.data?.forecastFinish
            ? `Forecast finish · ${analysis.data.forecastFinish}`
            : "No complete dated plan"}
        </span>
        <span>
          {analysis.data?.tasks.filter((t) => t.critical).length ?? 0} critical
          tasks
        </span>
      </div>
      {analysis.data?.warnings.map((w) => (
        <p className="ws-note" key={w}>
          {w}
        </p>
      ))}
      <p className="ws-note">
        Working-day analysis of the entire workspace. Current starts are lower
        bounds; completed predecessors are satisfied. Bars show the saved
        schedule, not automatically revised dates.
      </p>
      <div className="productivity-subtoolbar">
        <label>
          Baseline
          <select
            aria-label="Baseline"
            value={base}
            onChange={(e) => setBase(e.target.value)}
          >
            <option value="">None</option>
            {bases.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.archived ? " · Archived" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Compare with
          <select
            aria-label="Compare baseline with"
            value={compare}
            onChange={(e) => setCompare(e.target.value)}
          >
            <option value="current">Current plan</option>
            {bases.data
              ?.filter((b) => b.id !== base)
              .map((b) => (
                <option value={b.id} key={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
        <button
          className="button secondary"
          disabled={
            action.busy ||
            space.role !== "editor" ||
            space.effective_status !== "active"
          }
          onClick={capture}
        >
          <Camera size={15} />
          Capture baseline
        </button>
        {base && space.can_manage && (
          <>
            <button
              className="icon-button"
              title="Rename baseline"
              aria-label="Rename baseline"
              onClick={() =>
                void action.run(async () => {
                  const b = bases.data!.find((b) => b.id === base)!;
                  const name = await promptValue("Baseline name", {
                    title: "Rename baseline",
                    defaultValue: b.name,
                  });
                  if (name) {
                    await mutate(
                      `spaces/${space.id}/baselines/${base}`,
                      { name, archived: b.archived, version: b.version },
                      "PATCH",
                    );
                    refresh();
                  }
                })
              }
            >
              <Pencil size={15} />
            </button>
            <button
              className="icon-button"
              title="Archive or unarchive baseline"
              aria-label="Archive or unarchive baseline"
              onClick={() =>
                void action.run(async () => {
                  const b = bases.data!.find((b) => b.id === base)!;
                  await mutate(
                    `spaces/${space.id}/baselines/${base}`,
                    { name: b.name, archived: !b.archived, version: b.version },
                    "PATCH",
                  );
                  refresh();
                })
              }
            >
              <Archive size={15} />
            </button>
          </>
        )}
      </div>
      {detail.data && (
        <>
          <p className="ws-note">
            {detail.data.comparison.items.length} changed tasks
            {detail.data.comparison.calendarChanged
              ? " · Working calendar changed"
              : ""}
            {detail.data.comparison.milestonesChanged
              ? " · Milestones changed"
              : ""}
            . Baseline markers use the original dates.
          </p>
          <div className="planning-insight-rows">
            {detail.data.comparison.items.slice(0, 200).map((t) => (
              <div key={t.id}>
                <WorkspaceLink
                  to={`/workspaces/${space.id}/planning?task=${t.id}`}
                >
                  {t.title}
                </WorkspaceLink>
                <span>
                  {t.kind} · {t.fields.join(", ")}
                </span>
                <span>
                  {t.finishVarianceDays === null
                    ? "—"
                    : `${t.finishVarianceDays > 0 ? "+" : ""}${t.finishVarianceDays} calendar days`}
                </span>
              </div>
            ))}
            {detail.data.comparison.items.length > 200 && (
              <p>
                Showing the first 200 changes. Use the baseline export for all
                changes.
              </p>
            )}
          </div>
          <button
            className="text-button"
            onClick={() => {
              const u = URL.createObjectURL(
                new Blob([JSON.stringify(detail.data, null, 2)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = u;
              a.download = "planning-baseline.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(u), 1000);
            }}
          >
            Export full comparison
          </button>
        </>
      )}
      {!base && analysis.data && (
        <div className="planning-insight-rows">
          {analysis.data.tasks.slice(0, 200).map((t) => (
            <div key={t.id}>
              <WorkspaceLink
                to={`/workspaces/${space.id}/planning?task=${t.id}`}
              >
                {t.title}
              </WorkspaceLink>
              <span>
                {t.earliestStart} → {t.earliestFinish}
              </span>
              <span>
                {t.critical ? "Critical · " : ""}
                {t.slackDays} working days slack
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
