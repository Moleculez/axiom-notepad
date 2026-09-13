"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bell,
  BookOpen,
  ChevronDown,
  File,
  FileText,
  FlaskConical,
  FolderOpen,
  Home,
  Image as ImageIcon,
  LayoutGrid,
  Pin,
  Plus,
  Search,
  Settings,
  Sigma,
  Users,
  X,
  Blocks,
  History,
  Trash2,
  Network,
  Braces,
  Music2,
  Film,
} from "lucide-react";
import { tabTitle } from "@axiom/shared/application-tabs";
import {
  locationResourceId,
  workspaceLocation,
} from "@axiom/shared/workspace-location";
import { useAppTabs, publishTabTitle } from "../../lib/application-tabs";
import { openContextMenu } from "../../lib/context-menu";
import Dialog from "../Dialog";
import { useData, useLocation, useWorkspace, WorkspaceLink } from "./ui";
import type { ResourceLocation } from "@axiom/shared/workspace";
import { requestFileCreation } from "../../lib/file-creation";
import { fileRouteId } from "@axiom/shared/file-routes";
import {
  settingsCategories,
  settingsCategory,
} from "../../lib/settings-registry";

export const destinations = [
  ["/home", "Home", "Recent work and your day", Home],
  ["/explorer", "Explorer", "Notes, folders and files", FolderOpen],
  ["/projects", "Projects", "Tasks, milestones and reviews", FlaskConical],
  ["/research", "Research", "References and connections", BookOpen],
  ["/groups", "Groups", "Create, join and manage your groups", Users],
  ["/workspaces", "Workspaces", "Access, storage and administration", Blocks],
  ["/audit", "Audit", "Change history and operation progress", History],
  ["/trash", "Trash", "Recover files and workspaces", Trash2],
  ["/inbox", "Inbox", "Mentions and notifications", Bell],
  ["/people", "People", "Your collaborators", Users],
  ["/settings/appearance", "Settings", "Make the workspace yours", Settings],
] as const;
const icon = (path: string) => {
  if (path.startsWith("/notes/")) return FileText;
  if (path.startsWith("/files/")) return File;
  if (path.startsWith("/image/")) return ImageIcon;
  if (path.startsWith("/canvas/")) return Network;
  if (path.startsWith("/text/")) return Braces;
  if (path.startsWith("/math/")) return Sigma;
  if (path.startsWith("/audio/")) return Music2;
  if (path.startsWith("/video/")) return Film;
  if (path.startsWith("/pdf/")) return BookOpen;
  if (path.startsWith("/document/")) return FileText;
  return (
    destinations.find(
      ([route]) => route.split("/")[1] === path.split(/[/?]/)[1],
    )?.[3] ?? LayoutGrid
  );
};
export default function ApplicationTabs() {
  const tabs = useAppTabs()!;
  const { open } = useWorkspace();
  const [search, setSearch] = useState<string | null>(null),
    [group, setGroup] = useState<{ id: string; name: string } | null>(null);
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null),
    latest = useRef(tabs);
  latest.current = tabs;
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        document.querySelector("dialog[open]") ||
        !(event.metaKey || event.ctrlKey) ||
        !event.altKey
      )
        return;
      const value = latest.current;
      if (event.code === "KeyT") {
        event.preventDefault();
        if (event.shiftKey) value.reopen();
        else value.create();
      } else if (event.code === "KeyW") {
        event.preventDefault();
        value.close(value.state.active);
      } else if (/^Digit[1-9]$/.test(event.code)) {
        const tab = value.state.tabs[Number(event.code.slice(-1)) - 1];
        if (tab) {
          event.preventDefault();
          value.select(tab.id);
        }
      }
    };
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("keydown", keys);
      if (hover.current) clearTimeout(hover.current);
    };
  }, []);
  const ordered = [
    ...tabs.state.tabs.filter((t) => t.pinned),
    ...tabs.state.tabs.filter((t) => !t.pinned),
  ];
  return (
    <>
      <div className="application-tabbar">
        <button
          className="icon-button app-switcher"
          title="Workspace pages"
          aria-label="Workspace pages"
          onClick={() => tabs.create()}
        >
          <LayoutGrid size={18} />
        </button>
        <div
          className="application-tabs"
          role="tablist"
          aria-label="Application tabs"
        >
          {ordered.map((tab, index) => {
            const Icon = icon(tab.path),
              title = tab.title || tabTitle(tab.path),
              active = tabs.state.active === tab.id;
            return (
              <div
                key={tab.id}
                className={`application-tab ${active ? "active" : ""} ${tab.pinned ? "pinned" : ""}`}
                data-tab-id={tab.id}
                data-tab-group={tab.group || undefined}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/x-axiom-tab", tab.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  if (
                    event.dataTransfer.types.includes("application/x-axiom-tab")
                  ) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  } else if (
                    event.dataTransfer.types.includes(
                      "application/x-axiom-resources",
                    ) &&
                    !active &&
                    !hover.current
                  )
                    hover.current = setTimeout(() => {
                      latest.current.select(tab.id);
                      hover.current = null;
                    }, 650);
                }}
                onDragLeave={() => {
                  if (hover.current) clearTimeout(hover.current);
                  hover.current = null;
                }}
                onDrop={(event) => {
                  const id = event.dataTransfer.getData(
                    "application/x-axiom-tab",
                  );
                  if (id) {
                    event.preventDefault();
                    tabs.reorder(id, tab.id);
                  }
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    tabs.close(tab.id);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openContextMenu({
                    owner: event.currentTarget,
                    x: event.clientX,
                    y: event.clientY,
                    label: `Tab actions for ${title}`,
                    items: [
                      {
                        label: tab.pinned ? "Unpin tab" : "Pin tab",
                        icon: tab.pinned ? "unpin" : "pin",
                        action: () =>
                          tabs.update(tab.id, { pinned: !tab.pinned }),
                      },
                      {
                        label: "Duplicate tab",
                        icon: "duplicate",
                        disabled: tab.path.startsWith("/settings"),
                        disabledReason: "Settings uses one coordinated draft.",
                        action: () => tabs.create(tab.path, true),
                      },
                      ...(fileRouteId(tab.path)
                        ? [
                            {
                              label: "Open beside",
                              icon: "split" as const,
                              disabled:
                                !tabs.active ||
                                !fileRouteId(tabs.active.path) ||
                                tabs.active.path === tab.path,
                              action: () => {
                                const url = new URL(tab.path, location.origin);
                                open(
                                  {
                                    id: url.pathname.split("/")[2],
                                    route: url.pathname + url.search + url.hash,
                                    kind: url.pathname.startsWith("/notes")
                                      ? "note"
                                      : "file",
                                    versionId:
                                      url.searchParams.get("version") ??
                                      undefined,
                                  },
                                  true,
                                );
                              },
                            },
                          ]
                        : []),
                      {
                        label: "Name tab group…",
                        icon: "group",
                        action: () =>
                          setGroup({ id: tab.id, name: tab.group ?? "" }),
                      },
                      ...(tab.group
                        ? [
                            {
                              label: "Remove from group",
                              icon: "ungroup" as const,
                              action: () =>
                                tabs.update(tab.id, { group: undefined }),
                            },
                          ]
                        : []),
                      {
                        label: "Close tab",
                        icon: "close",
                        group: "Close",
                        action: () => tabs.close(tab.id),
                      },
                      {
                        label: "Close other unpinned tabs",
                        icon: "closeOthers",
                        action: () =>
                          ordered
                            .filter((t) => t.id !== tab.id && !t.pinned)
                            .forEach((t) => tabs.close(t.id)),
                      },
                      {
                        label: "Close unpinned tabs to the right",
                        icon: "closeRight",
                        action: () =>
                          ordered
                            .slice(index + 1)
                            .filter((t) => !t.pinned)
                            .forEach((t) => tabs.close(t.id)),
                      },
                      {
                        label: "Close all tabs",
                        icon: "closeAll",
                        action: tabs.closeAll,
                      },
                      {
                        label: "Reopen closed tab",
                        icon: "reopen",
                        group: "History",
                        disabled: !tabs.state.closed.length,
                        action: tabs.reopen,
                      },
                    ],
                  });
                }}
              >
                <button
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  title={`${title}${tab.group ? ` · ${tab.group}` : ""}`}
                  onClick={() => tabs.select(tab.id)}
                  onKeyDown={(event) => {
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const next =
                      ordered[
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? ordered.length - 1
                            : (index +
                                (event.key === "ArrowRight" ? 1 : -1) +
                                ordered.length) %
                              ordered.length
                      ];
                    tabs.select(next.id);
                    event.currentTarget
                      .closest('[role="tablist"]')
                      ?.querySelector<HTMLButtonElement>(
                        `[data-tab-id="${next.id}"] [role="tab"]`,
                      )
                      ?.focus();
                  }}
                >
                  <Icon size={15} />
                  {!tab.pinned && (
                    <span>
                      {tab.group && <small>{tab.group}</small>}
                      {title}
                    </span>
                  )}
                  {tab.pinned && <Pin size={10} />}
                </button>
                {!tab.pinned && (
                  <button
                    className="application-tab-close"
                    aria-label={`Close ${title} tab`}
                    onClick={() => tabs.close(tab.id)}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          className="icon-button"
          aria-label="New application tab"
          title="New tab · ⌘/Ctrl Alt T"
          onClick={() => tabs.create()}
        >
          <Plus size={18} />
        </button>
        <button
          className="icon-button"
          aria-label="Search open tabs"
          onClick={() => setSearch("")}
        >
          <ChevronDown size={17} />
        </button>
      </div>
      {search !== null && (
        <Dialog title="Find a tab" onClose={() => setSearch(null)}>
          <label className="ws-search-field">
            <Search size={16} />
            <input
              autoFocus
              aria-label="Filter open tabs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="app-tab-search">
            {ordered
              .filter((t) =>
                `${t.title || tabTitle(t.path)} ${t.group ?? ""}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((t) => (
                <button
                  className="button secondary"
                  key={t.id}
                  onClick={() => {
                    tabs.select(t.id);
                    setSearch(null);
                  }}
                >
                  {t.title || tabTitle(t.path)}
                  {t.group && <small>{t.group}</small>}
                </button>
              ))}
          </div>
          <button
            className="text-button"
            disabled={!tabs.state.closed.length}
            onClick={() => {
              tabs.reopen();
              setSearch(null);
            }}
          >
            Reopen last closed tab
          </button>
        </Dialog>
      )}
      {group && (
        <Dialog title="Tab group" onClose={() => setGroup(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              tabs.update(group.id, { group: group.name.trim() || undefined });
              setGroup(null);
            }}
          >
            <label>
              Group name
              <input
                autoFocus
                maxLength={40}
                value={group.name}
                onChange={(e) => setGroup({ ...group, name: e.target.value })}
                list="existing-tab-groups"
              />
            </label>
            <datalist id="existing-tab-groups">
              {[...new Set(ordered.map((t) => t.group).filter(Boolean))].map(
                (name) => (
                  <option key={name} value={name} />
                ),
              )}
            </datalist>
            <p className="ws-note">
              Use the same name on related tabs to keep your research together.
            </p>
            <div className="dialog-footer">
              <button className="button primary" type="submit">
                Save group
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
export function LocationToolbar() {
  const tabs = useAppTabs()!,
    { path, params } = useLocation(),
    { spaces, navigate, revision } = useWorkspace();
  const route = path + (params.size ? `?${params}` : ""),
    resourceId = locationResourceId(route),
    resourcePath = resourceId ? `resources/${resourceId}/location` : null,
    space =
      spaces.find((s) => s.id === params.get("space")) ??
      (path === "/explorer" &&
      !params.has("space") &&
      !params.has("folder") &&
      (!params.has("view") || params.get("view") === "folder")
        ? spaces.find((s) => s.kind === "personal")
        : undefined);
  const data = useData<ResourceLocation>(resourcePath, revision);
  useEffect(() => {
    if (data.data?.resource.id === resourceId && fileRouteId(route))
      publishTabTitle(route + location.hash, data.data.resource.name);
  }, [data.data, resourceId, route]);
  const { crumbs, up } = workspaceLocation({
    route,
    title: path.startsWith("/settings/")
      ? settingsCategories.find(
          (category) =>
            category.id ===
            settingsCategory(path.split("/")[2], params.get("section")),
        )?.label
      : tabs.active?.title,
    location: data.data,
    space,
  });
  const loading = !!resourceId && (data.loading || data.path !== resourcePath),
    trail = useRef<HTMLElement>(null),
    trailKey = JSON.stringify(crumbs);
  useEffect(() => {
    // Keep the current item visible without clipping inaccessible ancestors.
    if (trail.current) trail.current.scrollLeft = trail.current.scrollWidth;
  }, [route, trailKey]);
  return (
    <div className="application-location">
      <div className="ws-actions">
        <button
          className="icon-button"
          aria-label="Back in tab"
          disabled={!tabs.active?.index}
          onClick={() => tabs.back(-1)}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Forward in tab"
          disabled={
            !tabs.active || tabs.active.index >= tabs.active.history.length - 1
          }
          onClick={() => tabs.back(1)}
        >
          <ArrowRight size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="Up one level"
          disabled={!up || loading}
          onClick={() => up && navigate(up)}
        >
          <ArrowUp size={16} />
        </button>
      </div>
      <nav
        ref={trail}
        aria-label="Current location"
        aria-busy={loading}
        aria-description={
          data.error
            ? "The folder path is unavailable. You can return to the collection."
            : undefined
        }
      >
        {crumbs.map((crumb, index) => (
          <Fragment key={`${index}:${crumb.to ?? "current"}`}>
            {index > 0 && <span aria-hidden="true">/</span>}
            {crumb.to ? (
              <WorkspaceLink to={crumb.to} title={crumb.label}>
                {crumb.label}
              </WorkspaceLink>
            ) : (
              <strong aria-current="page" title={crumb.label}>
                {crumb.label}
              </strong>
            )}
          </Fragment>
        ))}
      </nav>
      <span className="ws-spacer" />
    </div>
  );
}
export function NewApplicationTab() {
  const tabs = useAppTabs()!;
  return (
    <main className="ws-page application-launcher">
      <span className="ws-eyebrow">YOUR WORKSPACE</span>
      <h1>Room for your next idea.</h1>
      <p>Choose a page, or search your notes and research.</p>
      <section className="application-create-files" aria-label="Create a file">
        {(
          [
            ["markdown", "Markdown", FileText],
            ["canvas", "Canvas", Network],
            ["math", "Math", Sigma],
            ["image", "Drawing", ImageIcon],
            ["text", "Text", Braces],
          ] as const
        ).map(([type, label, Icon]) => (
          <button
            type="button"
            key={type}
            className="button secondary"
            onClick={() => requestFileCreation({ type })}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </section>
      <div className="application-destinations">
        {destinations.map(([path, title, description, Icon]) => (
          <button key={path} onClick={() => tabs.create(path)}>
            <Icon size={23} />
            <strong>{title}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
      <p className="ws-note">
        ⌘/Ctrl Alt T · New tab &nbsp; · &nbsp; ⌘/Ctrl Alt W · Close tab &nbsp; ·
        &nbsp; ⌘/Ctrl Alt Shift T · Reopen
      </p>
    </main>
  );
}
