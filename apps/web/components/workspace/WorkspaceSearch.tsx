"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Command,
  FileSearch,
  History,
  Search,
  X,
} from "lucide-react";
import type { ResourcePage } from "@axiom/shared/workspace";
import { tabTitle } from "@axiom/shared/application-tabs";
import { fileRouteId } from "@axiom/shared/file-routes";
import { timeAgo } from "../../lib/client";
import { useWorkSessions } from "../../lib/workspace-sessions";
import Dialog, { DialogFooter } from "../Dialog";
import { openAssistant } from "../../lib/assistant";
import { ErrorNotice, ResourceIcon, useData, useWorkspace } from "./ui";
import { destinations, locationIcon } from "./WorkspaceToolbar";

type Entry = {
  id: string;
  title: string;
  detail: string;
  icon: ReactNode;
  kind: string;
  action: () => void;
};
function Match({ text, query }: { text: string; query: string }) {
  const at = query
    ? text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
    : -1;
  return at < 0 ? (
    text
  ) : (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

export default function WorkspaceSearch({ onClose }: { onClose: () => void }) {
  const { revision, open, navigate, spaces, session } = useWorkspace(),
    sessions = useWorkSessions();
  const [query, setQuery] = useState(""),
    [debounced, setDebounced] = useState(""),
    [scope, setScope] = useState<"all" | "files" | "commands">("all"),
    [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null),
    id = useId();
  // React autoFocus runs before the native dialog is modal; focus after showModal.
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  const commandsOnly =
      scope === "commands" || query.trimStart().startsWith(">"),
    term = query.replace(/^\s*>\s*/, "").trim();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 180);
    return () => clearTimeout(timer);
  }, [term]);
  const endpoint =
    term && !commandsOnly && term === debounced
      ? `resources?view=all&q=${encodeURIComponent(debounced)}&limit=30`
      : null;
  const data = useData<ResourcePage>(endpoint, revision);
  const recentFiles = useData<ResourcePage>(
    !term && !commandsOnly && scope !== "files"
      ? "resources?view=recent&limit=100"
      : null,
    revision,
  );
  const recentNames = new Map(
    recentFiles.data?.items.map((item) => [item.id, item.name]),
  );
  const pending =
    !!term &&
    !commandsOnly &&
    (term !== debounced || data.loading || data.path !== endpoint);
  const finish = (action: () => void) => {
    onClose();
    action();
  };
  const groups: { name: string; entries: Entry[] }[] = [];
  if (!term && !commandsOnly && scope !== "files") {
    const recent = [...(sessions?.state.sessions ?? [])]
      .reverse()
      .filter((item) => item.id !== sessions?.state.active)
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
      .slice(0, 5);
    groups.push({
      name: "Recent work",
      entries: recent.map((item) => {
        const Icon = locationIcon(item.path);
        return {
          id: `recent:${item.id}`,
          title:
            item.title ??
            recentNames.get(fileRouteId(item.path) ?? "") ??
            tabTitle(item.path),
          detail: item.pinned ? "Pinned destination" : tabTitle(item.path),
          kind: item.pinned ? "Pinned" : "Recent",
          icon: <Icon size={18} />,
          action: () => sessions?.select(item.id),
        };
      }),
    });
  }
  if (scope !== "files" || commandsOnly) {
    const matches = destinations.filter(
      ([, name, description]) =>
        !term ||
        `${name} ${description}`.toLowerCase().includes(term.toLowerCase()),
    );
    groups.push({
      name: "Commands",
      entries: (term || commandsOnly ? matches : matches.slice(0, 4)).map(
        ([path, title, detail, Icon]) => ({
          id: `command:${path}`,
          title,
          detail,
          icon: <Icon size={18} />,
          kind: "Go to",
          action: () => navigate(path),
        }),
      ),
    });
    if (!term || /assistant|research|ask/i.test(term))
      groups.at(-1)!.entries.unshift({
        id: "command:assistant",
        title: "Research assistant",
        detail: "Cited answers and reviewed proposals",
        kind: "Open",
        icon: <FileSearch size={18} />,
        action: () => openAssistant(),
      });
  }
  if (endpoint && !pending && !data.error)
    groups.push({
      name: "Files",
      entries: (data.data?.items ?? []).map((item) => ({
        id: `file:${item.id}`,
        title: item.name,
        detail: [
          spaces.find((space) => space.id === item.space_id)?.name,
          timeAgo(item.updated_at),
        ]
          .filter(Boolean)
          .join(" · "),
        icon: <ResourceIcon resource={item} size={18} />,
        kind:
          item.kind === "folder"
            ? "Folder"
            : (item.document_type ??
              (item.kind === "note" ? "Markdown" : "File")),
        action: () =>
          item.kind === "folder"
            ? navigate(`/workspaces/${item.space_id}/files?folder=${item.id}`)
            : open(item),
      })),
    });
  if (scope !== "files" && (!term || /planning|portfolio|capacity/i.test(term)))
    groups.push({
      name: "Group planning",
      entries: session.groups.map((g) => ({
        id: `portfolio:${g.id}`,
        title: `${g.name} · Planning`,
        detail: "Portfolios, timeline and weekly capacity",
        kind: "Go to",
        icon: <FileSearch size={18} />,
        action: () => navigate(`/groups/${g.id}/planning`),
      })),
    });
  const entries = groups.flatMap((group) => group.entries),
    selected = entries[Math.min(active, entries.length - 1)];
  useEffect(() => {
    setActive(0);
  }, [query, scope]);
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (row && list.current) {
      const parent = list.current.getBoundingClientRect(),
        rect = row.getBoundingClientRect();
      if (rect.bottom > parent.bottom)
        list.current.scrollTop += rect.bottom - parent.bottom;
      else if (rect.top < parent.top)
        list.current.scrollTop -= parent.top - rect.top;
    }
  }, [selected?.id]);
  const chooseScope = (next: typeof scope) => {
    setScope(next);
    setQuery((text) => text.replace(/^\s*>\s*/, ""));
    input.current?.focus();
  };
  let offset = 0;
  return (
    <Dialog
      title="Search & commands"
      size="wide"
      className="workspace-search-dialog"
      onClose={onClose}
    >
      <div className="discovery-search-input">
        {commandsOnly ? <Command size={21} /> : <Search size={21} />}
        <input
          ref={input}
          autoFocus
          role="combobox"
          aria-label="Global search"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={`${id}-results`}
          aria-activedescendant={selected ? `${id}-${selected.id}` : undefined}
          placeholder={
            commandsOnly
              ? "Where would you like to go?"
              : "Find files, folders, or a command…"
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive((value) =>
                Math.max(
                  0,
                  Math.min(
                    entries.length - 1,
                    value + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (selected) finish(selected.action);
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            title="Clear search"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div
        className="discovery-scope-row"
        role="group"
        aria-label="Search scope"
      >
        {(
          [
            ["all", "Everything"],
            ["files", "Files"],
            ["commands", "Commands"],
          ] as const
        ).map(([value, title]) => (
          <button
            key={value}
            type="button"
            aria-pressed={(commandsOnly ? "commands" : scope) === value}
            onClick={() => chooseScope(value)}
          >
            {title}
          </button>
        ))}
        <span>
          Type <kbd>&gt;</kbd> for commands
        </span>
      </div>
      {endpoint && <ErrorNotice message={data.error} retry={data.reload} />}
      <div
        ref={list}
        id={`${id}-results`}
        role="listbox"
        aria-label="Search results"
        aria-busy={pending}
        className="discovery-result-list"
      >
        {groups
          .filter((group) => group.entries.length)
          .map((group) => {
            const start = offset;
            offset += group.entries.length;
            return (
              <div
                role="group"
                aria-label={group.name}
                key={group.name}
                className="discovery-result-group"
              >
                <div className="discovery-group-heading" aria-hidden="true">
                  <span>{group.name}</span>
                  <small>{group.entries.length}</small>
                </div>
                {group.entries.map((entry, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected?.id === entry.id}
                    tabIndex={-1}
                    id={`${id}-${entry.id}`}
                    key={entry.id}
                    className="discovery-result"
                    title={entry.title}
                    onMouseMove={() => setActive(start + index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => finish(entry.action)}
                  >
                    <span className="discovery-result-icon">{entry.icon}</span>
                    <span className="discovery-result-copy">
                      <strong>
                        <Match text={entry.title} query={term} />
                      </strong>
                      <small>{entry.detail}</small>
                    </span>
                    <span className="discovery-result-kind">{entry.kind}</span>
                    <ArrowUpRight
                      className="discovery-result-arrow"
                      size={15}
                    />
                  </button>
                ))}
              </div>
            );
          })}
      </div>
      {pending && (
        <div className="discovery-feedback" role="status">
          <span className="discovery-loading-dot" />
          Searching your accessible files…
        </div>
      )}
      {!pending && !entries.length && !data.error && (
        <div className="discovery-empty" role="status">
          <FileSearch size={28} />
          <strong>
            {term
              ? `No matches for “${term}”`
              : "Find something worth revisiting"}
          </strong>
          <p>
            {scope === "files" && !term
              ? "Search by file name, content, or tag."
              : "Try a shorter name, another keyword, or a different scope."}
          </p>
        </div>
      )}
      <DialogFooter>
        <div className="discovery-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate <kbd>↵</kbd> Open <kbd>esc</kbd> Close
          </span>
          <span>
            <History size={13} />
            Your accessible work only
          </span>
        </div>
      </DialogFooter>
    </Dialog>
  );
}
