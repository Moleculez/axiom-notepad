"use client";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import {
  BookOpen,
  Library as LibraryIcon,
  Network,
  NotebookPen,
  PanelsTopLeft,
  Rows3,
} from "lucide-react";
import type { Space } from "@axiom/shared/workspace";
import {
  researchViews,
  workspaceResearchRoute,
} from "@axiom/shared/research-navigation";
import {
  ErrorNotice,
  go,
  Loading,
  useData,
  useLocation,
  useWorkspace,
  WorkspaceLink,
} from "./ui";
const Evidence = dynamic(() => import("./ResearchWorkbench"), {
  loading: () => <Loading />,
});
const Library = dynamic(() => import("./ResearchLibrary"), {
  loading: () => <Loading label={uiText("Opening reference library…")} />,
});
const Graph = dynamic(() => import("./ResearchGraph"), {
  loading: () => <Loading label={uiText("Opening knowledge graph…")} />,
});
const viewIcons = {
  overview: PanelsTopLeft,
  library: LibraryIcon,
  queue: Rows3,
  evidence: NotebookPen,
  graph: Network,
};
export type ResearchPanelProps = {
  space: Space;
  params: URLSearchParams;
  onRoute: (changes: Record<string, string>) => void;
  active: boolean;
};

/** Compatibility only: old saved links resolve through the same content ACLs. */
export function LegacyResearchRedirect() {
  useInterfaceLocale();
  const { params, parts } = useLocation();
  const query = new URLSearchParams(params);
  if (parts[1] === "references") query.set("view", "library");
  if (parts[1] === "graph") query.set("view", "graph");
  const target = useData<{ route: string }>(
    "research/library/location?" + query,
  );
  useEffect(() => {
    if (target.data) go(target.data.route, true);
  }, [target.data]);
  return (
    <div className="ws-page">
      <ErrorNotice message={target.error} retry={target.reload} />
      {!target.error && (
        <Loading label={uiText("Opening workspace research…")} />
      )}
      {target.error && (
        <WorkspaceLink to="/workspaces">
          <I18nText id="Browse workspaces" />
        </WorkspaceLink>
      )}
    </div>
  );
}

export default function ResearchWorkspace({ space }: { space: Space }) {
  useInterfaceLocale();
  const { navigate } = useWorkspace(),
    { params } = useLocation();
  const view = researchViews.some(([value]) => value === params.get("view"))
    ? params.get("view")!
    : "overview";
  const cache = useRef(new Map<string, string>());
  cache.current.set(view, params.toString());
  const route = (changes: Record<string, string>, base = params) => {
    const next = new URLSearchParams(base);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    navigate(workspaceResearchRoute(space.id, next));
  };
  return (
    <section
      className="research-workspace research-embedded"
      aria-label={uiText("Workspace research")}
    >
      <div className="research-navigation">
        <nav className="research-tabs" aria-label={uiText("Research views")}>
          {researchViews.map(([value, label]) => {
            const Icon = viewIcons[value];
            return (
              <button
                key={value}
                aria-current={view === value ? "page" : undefined}
                onClick={() =>
                  route(
                    { view: value },
                    new URLSearchParams(cache.current.get(value)),
                  )
                }
              >
                <Icon size={15} aria-hidden />
                {label}
              </button>
            );
          })}
        </nav>
        <WorkspaceLink
          className="button ghost research-guide"
          to="/docs/research/workbench"
        >
          <BookOpen size={15} />
          <I18nText id="Guide" />
        </WorkspaceLink>
      </div>
      <div className="research-panels">
        {researchViews
          .filter(([value]) => cache.current.has(value))
          .map(([value, label]) => {
            const p = new URLSearchParams(cache.current.get(value));
            const props = {
              space,
              params: p,
              onRoute: (changes: Record<string, string>) => route(changes, p),
              active: view === value,
            };
            return (
              <section
                key={value}
                hidden={view !== value}
                aria-label={label}
                className="research-tab-panel"
              >
                {value === "library" ? (
                  <Library {...props} />
                ) : value === "graph" ? (
                  <Graph {...props} />
                ) : (
                  <Evidence
                    space={space}
                    active={props.active}
                    embeddedParams={p}
                    onRoute={props.onRoute}
                  />
                )}
              </section>
            );
          })}
      </div>
    </section>
  );
}
