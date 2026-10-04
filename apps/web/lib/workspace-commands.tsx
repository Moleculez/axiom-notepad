"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BookOpen,
  Download,
  FileSearch,
  Puzzle,
  type LucideIcon,
} from "lucide-react";
import {
  editorCommands,
  eventBinding,
  keysFor,
  shortcutPlatform,
  bindingProblem,
} from "@axiom/shared/editor";
import { useLocation, useWorkspace } from "../components/workspace/ui";
import { destinations } from "../components/workspace/WorkspaceToolbar";
import { researchCommandRoute } from "@axiom/shared/research-navigation";
import { openAssistant } from "./assistant";

export type ActiveCommandContext = {
  owner: string;
  spaceId: string;
  resourceId?: string;
  format?: string;
  mode?: string;
  canEdit: boolean;
  title?: string;
};
export type WorkspaceCommand = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  group: string;
  binding?: string;
  disabledReason?: string;
  run: () => void;
};
type Registry = {
  context: ActiveCommandContext | null;
  commands: WorkspaceCommand[];
  setPane: (context: ActiveCommandContext | null) => void;
  clearPane: (owner: string) => void;
  register: (owner: string, commands: WorkspaceCommand[]) => () => void;
  bindingConflict: (key: string, except?: string) => string;
  inspector: string;
  claimInspector: (owner: string) => void;
};
const Context = createContext<Registry | null>(null);
export function WorkspaceCommandProvider({
  children,
}: {
  children: ReactNode;
}) {
  const workspace = useWorkspace(),
    { path, params } = useLocation();
  const [pane, setPane] = useState<ActiveCommandContext | null>(null),
    [contributions, setContributions] = useState(
      new Map<string, WorkspaceCommand[]>(),
    ),
    [inspector, setInspector] = useState("document");
  const register = useCallback(
    (owner: string, commands: WorkspaceCommand[]) => {
      setContributions((previous) => new Map(previous).set(owner, commands));
      return () =>
        setContributions((previous) => {
          const next = new Map(previous);
          next.delete(owner);
          return next;
        });
    },
    [],
  );
  const clearPane = useCallback((owner: string) => {
    setPane((current) => (current?.owner === owner ? null : current));
  }, []);
  const fallbackSpace = path.startsWith("/workspaces/")
    ? path.split("/")[2]
    : params.get("space");
  const context =
    /^\/(?:notes|files|canvas|math|image|text|pdf|document)\//.test(path)
      ? pane
      : fallbackSpace
        ? {
            owner: "workspace",
            spaceId: fallbackSpace,
            canEdit:
              workspace.spaces.find((s) => s.id === fallbackSpace)?.role ===
              "editor",
          }
        : null;
  const commands = useMemo(() => {
    const core: WorkspaceCommand[] = destinations.map(
      ([route, title, description, icon]) => ({
        id: "navigate:" + route,
        title,
        description,
        icon,
        group: "Go to",
        run: () =>
          workspace.navigate(researchCommandRoute(route, context?.spaceId)),
      }),
    );
    core.push({
      id: "assistant:open",
      title: "Research assistant",
      description: "Cited answers and reviewed proposals",
      icon: FileSearch,
      group: "Open",
      run: () =>
        openAssistant(context?.spaceId ? { spaceId: context.spaceId } : {}),
    });
    if (context?.resourceId && context.format === "markdown")
      core.push({
        id: "document:export",
        title: "Export document",
        description: "HTML, Print / Save PDF, Markdown and assets",
        icon: Download,
        group: "Document",
        run: () => window.dispatchEvent(new Event("axiom:export-document")),
      });
    core.push(
      {
        id: "extensions:manage",
        title: "Manage extensions",
        description: "Packages, workspace permissions and activity",
        icon: Puzzle,
        group: "Open",
        run: () => workspace.navigate("/settings/extensions"),
      },
      {
        id: "docs:extensions",
        title: "Extension development guide",
        description: "Sandbox, SDK and reviewed changes",
        icon: BookOpen,
        group: "Go to",
        run: () => workspace.navigate("/docs/extensions"),
      },
    );
    // Duplicate identities are rejected by ownership, not resolved by label.
    const seen = new Set(core.map((c) => c.id));
    for (const list of contributions.values())
      for (const c of list)
        if (!seen.has(c.id)) {
          core.push(c);
          seen.add(c.id);
        }
    return core;
  }, [
    contributions,
    workspace.navigate,
    context?.resourceId,
    context?.format,
    context?.spaceId,
  ]);
  const bindingConflict = useCallback(
    (key: string, except?: string) => {
      const problem = bindingProblem(key);
      if (problem) return problem;
      const native = editorCommands.find((c) =>
        keysFor(
          c.id,
          workspace.editorSettings.preferences,
          shortcutPlatform(),
        ).includes(key),
      );
      if (native) return "Already used by " + native.label + ".";
      if (["Mod-k", "Mod-Shift-p", "Mod-Shift-u"].includes(key))
        return "Reserved by the workspace.";
      const other = commands.find((c) => c.id !== except && c.binding === key);
      return other ? "Already used by " + other.title + "." : "";
    },
    [commands, workspace.editorSettings.preferences],
  );
  const current = useRef({ commands, bindingConflict });
  current.current = { commands, bindingConflict };
  useEffect(() => {
    const invoke = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.key === "Process"
      )
        return;
      // A plugin shortcut never steals ordinary editing, an active dialog, or
      // native editor shortcuts. Commands remain accessible through the palette.
      if (
        document.querySelector("dialog[open]") ||
        (event.target instanceof Element &&
          event.target.closest("input,textarea,select,[contenteditable=true]"))
      )
        return;
      const key = eventBinding(event, shortcutPlatform());
      const command = current.current.commands.find(
        (c) =>
          c.binding === key &&
          !c.disabledReason &&
          !current.current.bindingConflict(key, c.id),
      );
      if (command) {
        event.preventDefault();
        command.run();
      }
    };
    window.addEventListener("keydown", invoke);
    return () => window.removeEventListener("keydown", invoke);
  }, []);
  return (
    <Context.Provider
      value={{
        context,
        commands,
        setPane,
        clearPane,
        register,
        bindingConflict,
        inspector,
        claimInspector: setInspector,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspaceCommands() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace command registry is unavailable.");
  return value;
}
export function useActiveCommandPane(
  active: boolean,
  value: ActiveCommandContext,
) {
  const registry = useContext(Context),
    setPane = registry?.setPane,
    clearPane = registry?.clearPane;
  useEffect(() => {
    if (!active || !setPane) return;
    setPane(value);
    return () => clearPane?.(value.owner);
  }, [
    active,
    setPane,
    clearPane,
    value.owner,
    value.spaceId,
    value.resourceId,
    value.format,
    value.mode,
    value.canEdit,
    value.title,
  ]);
}
export function useInspectorOwner() {
  const registry = useContext(Context);
  return {
    owner: registry?.inspector ?? "document",
    claim: registry?.claimInspector ?? (() => {}),
  };
}
