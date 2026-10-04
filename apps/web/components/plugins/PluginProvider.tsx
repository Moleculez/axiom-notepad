"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  ChartGantt,
  CheckCheck,
  FileText,
  ListChecks,
  NotebookPen,
  Puzzle,
  Settings2,
  Sigma,
  Square,
  X,
} from "lucide-react";
import {
  pluginCommandId,
  type PluginInstallation,
  type PluginPanel,
  type PluginRegistry,
} from "@axiom/shared/plugins";
import { api } from "../../lib/client";
import {
  PluginRuntime,
  type PluginRuntimeStart,
} from "../../lib/plugin-runtime";
import {
  useWorkspaceCommands,
  type WorkspaceCommand,
} from "../../lib/workspace-commands";
import { useWorkspace, useData, ErrorNotice, Loading } from "../workspace/ui";
import {
  ActionRow,
  Button,
  Field,
  HelpText,
  IconButton,
  NativeSelect,
  Notice,
} from "../ui/controls";
import Dialog from "../Dialog";
import ResizablePanel from "../ResizablePanel";
import ChangeSetReview from "../assistant/ChangeSetReview";
import {
  pluginFieldDefaults,
  PluginFieldControl,
  type FieldValues,
} from "./PluginFields";

export const pluginIconMap = {
  Puzzle,
  NotebookPen,
  CheckCheck,
  ChartGantt,
  FileText,
  BookOpen,
  Sigma,
  ListChecks,
  Settings2,
};
type Extensions = {
  registry: PluginRegistry | null;
  error: string;
  loading: boolean;
  refresh: () => void;
  safeMode: boolean;
  setSafeMode: (value: boolean) => void;
  launch: (
    installation: PluginInstallation,
    command: string,
    spaceId?: string,
  ) => void;
};
const Context = createContext<Extensions | null>(null);
export function usePlugins() {
  const value = useContext(Context);
  if (!value) throw new Error("Extension provider unavailable.");
  return value;
}
export function useEditorExtensions(spaceId?: string) {
  const extensions = usePlugins();
  const items =
    !extensions.safeMode && extensions.registry?.enabled && spaceId
      ? extensions.registry.installations
          .filter(
            (i) =>
              i.enabled &&
              extensions.registry!.grants.some(
                (g) =>
                  g.installation_id === i.id &&
                  g.space_id === spaceId &&
                  g.package_hash === i.package_hash &&
                  g.authorized !== false &&
                  !g.revoked_at,
              ),
          )
          .flatMap((i) =>
            i.manifest.commands
              .filter((c) => !c.panelOnly && (c.slash || c.menu))
              .map((c) => ({
                id: pluginCommandId(i.plugin_id, c.id),
                label: c.title + " · " + i.manifest.name,
                slash: c.slash,
                menu: c.menu,
                installation: i,
                command: c.id,
              })),
          )
      : [];
  return {
    items: items.map(({ id, label, slash, menu }) => ({
      id,
      label,
      slash,
      menu,
    })),
    run: (id: string) => {
      const item = items.find((c) => c.id === id);
      if (item) extensions.launch(item.installation, item.command, spaceId);
    },
  };
}
export default function PluginProvider({ children }: { children: ReactNode }) {
  const { session, revision, spaces, navigate, notify } = useWorkspace(),
    commands = useWorkspaceCommands();
  const data = useData<PluginRegistry>("plugins", revision);
  const [safeMode, setSafe] = useState(false),
    [selected, setSelected] = useState<PluginInstallation | null>(null),
    [panel, setPanel] = useState<PluginPanel | null>(null),
    [fields, setFields] = useState<FieldValues>({}),
    [status, setStatus] = useState("stopped"),
    [error, setError] = useState(""),
    [review, setReview] = useState<string | null>(null),
    [destination, setDestination] = useState<{
      installation: PluginInstallation;
      command: string;
    } | null>(null),
    [spaceChoice, setSpaceChoice] = useState("");
  const runtime = useRef<PluginRuntime | null>(null),
    sequence = useRef(0),
    current = useRef({ data: data.data, safeMode, context: commands.context });
  const [inspectorHost, setInspectorHost] = useState<HTMLElement | null>(null);
  const [scopeName, setScopeName] = useState("");
  useEffect(() => {
    setInspectorHost(document.querySelector<HTMLElement>(".ws-body"));
  }, []);
  current.current = { data: data.data, safeMode, context: commands.context };
  const safeKey = "axiom:" + session.user.id + ":plugin-safe-mode";
  const stop = useCallback(() => {
    sequence.current++;
    runtime.current?.dispose();
    runtime.current = null;
    setStatus("stopped");
  }, []);
  useEffect(() => {
    try {
      setSafe(localStorage.getItem(safeKey) === "true");
    } catch {
      setSafe(true);
    }
    return stop;
  }, [safeKey, stop]);
  const setSafeMode = useCallback(
    (value: boolean) => {
      setSafe(value);
      try {
        localStorage.setItem(safeKey, String(value));
      } catch {
        notify(
          "Safe mode changed for this session; device storage is unavailable.",
        );
      }
      if (value) stop();
    },
    [safeKey, stop, notify],
  );
  const launch = useCallback(
    (
      installation: PluginInstallation,
      command: string,
      overrideSpace?: string,
    ) => {
      const context = current.current.context,
        spaceId = overrideSpace ?? context?.spaceId;
      if (!spaceId) {
        setDestination({ installation, command });
        setSpaceChoice("");
        return;
      }
      stop();
      setSelected(installation);
      setScopeName("");
      setPanel(null);
      setFields({});
      setError("");
      commands.claimInspector("plugin");
      if (current.current.safeMode || !navigator.onLine) {
        setError(
          "Extensions require an online session and are unavailable in safe mode.",
        );
        return;
      }
      const serial = ++sequence.current;
      setStatus("loading");
      void api<PluginRuntimeStart>("plugins/runtime/start", {
        method: "POST",
        body: JSON.stringify({
          installationId: installation.id,
          command,
          spaceId,
          resourceId:
            context?.spaceId === spaceId ? context.resourceId : undefined,
        }),
      })
        .then((start) => {
          if (serial !== sequence.current) return;
          setScopeName(start.context.spaceName);
          runtime.current = new PluginRuntime(start, {
            onPanel: (value) => {
              if (serial !== sequence.current) return;
              setPanel(value);
              setFields(
                pluginFieldDefaults(
                  value.blocks.flatMap((b) =>
                    b.kind === "field" ? [b.field] : [],
                  ),
                ),
              );
            },
            onState: (state, message) => {
              if (serial !== sequence.current) return;
              setStatus(state);
              if (message) setError(message);
            },
          });
        })
        .catch((e) => {
          if (serial === sequence.current) {
            setStatus("error");
            setError(e.message);
          }
        });
    },
    [stop, commands.claimInspector],
  );
  useEffect(() => {
    const registry = data.data;
    const list: WorkspaceCommand[] = (
      registry?.enabled ? registry.installations : []
    )
      .filter((i) => i.enabled)
      .flatMap((i) =>
        i.manifest.commands
          .filter((c) => !c.panelOnly)
          .map((c) => ({
            id: pluginCommandId(i.plugin_id, c.id),
            title: c.title,
            description: i.manifest.name + " · " + c.description,
            icon: pluginIconMap[c.icon],
            group: "Extensions",
            binding: i.bindings[c.id],
            disabledReason: safeMode
              ? "Safe mode is enabled."
              : !navigator.onLine
                ? "Reconnect to run an extension."
                : undefined,
            run: () => launch(i, c.id),
          })),
      );
    if (selected)
      list.push({
        id: "extensions:resume",
        title: "Show extension inspector",
        description: selected.manifest.name + " · Return to the retained panel",
        icon: Puzzle,
        group: "Extensions",
        binding: undefined,
        disabledReason: undefined,
        run: () => commands.claimInspector("plugin"),
      });
    return commands.register("extensions", list);
  }, [
    data.data,
    safeMode,
    commands.register,
    commands.claimInspector,
    selected,
    launch,
  ]);
  useEffect(() => {
    const active = runtime.current;
    if (!active) return;
    const registry = data.data,
      grant = registry?.grants.find((g) => g.id === active.start.grantId),
      installation = registry?.installations.find((i) => i.id === selected?.id),
      space = spaces.find((s) => s.id === active.start.context.spaceId);
    const approval = space?.group_id
      ? registry?.approvals.find(
          (a) =>
            a.group_id === space.group_id &&
            a.plugin_id === installation?.plugin_id,
        )
      : undefined;
    if (
      data.error ||
      !registry?.enabled ||
      safeMode ||
      !installation?.enabled ||
      installation.revision !== selected?.revision ||
      installation.package_hash !== active.start.packageHash ||
      !grant ||
      grant.revoked_at ||
      grant.authorized === false ||
      grant.revision !== active.start.grantRevision ||
      (approval &&
        (!approval.enabled || approval.revision !== grant.approval_revision))
    ) {
      stop();
      setError(
        "Extension access changed or could not be verified. Restart after reviewing permissions.",
      );
    }
  }, [data.data, data.error, safeMode, spaces, selected?.id, stop]);
  useEffect(() => {
    const offline = () => {
      stop();
      setError(
        "Extensions stopped while offline. Your editor remains available.",
      );
    };
    const validate = () => {
      const active = runtime.current;
      if (!active || document.hidden) return;
      void active.validate().catch((e) => {
        if (runtime.current === active) {
          stop();
          setError(e.message);
        }
      });
    };
    const timer = setInterval(validate, 30000);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", validate);
    return () => {
      clearInterval(timer);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", validate);
    };
  }, [stop]);
  const busy = status === "loading" || status === "running";
  const runAction = (command: string) => {
    if (!runtime.current) {
      setError("Restart this extension to run another command.");
      return;
    }
    const missing = panel?.blocks.find(
      (b) =>
        b.kind === "field" &&
        b.field.required &&
        (fields[b.field.id] === undefined || fields[b.field.id] === ""),
    );
    if (missing?.kind === "field") {
      setError(missing.field.label + " is required.");
      return;
    }
    try {
      setError("");
      runtime.current.run(command, fields);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not run the command.");
    }
  };
  const openLink = async (
    target: Extract<PluginPanel["blocks"][number], { kind: "link" }>["target"],
  ) => {
    const active = runtime.current;
    if (!active)
      throw new Error("Restart this extension before opening a snapshot link.");
    const value = await active.request<{ hash: string; format: string }>(
      "documents.read",
      { resourceId: target.resourceId },
    );
    if (target.expectedHash && value.hash !== target.expectedHash)
      throw new Error(
        "The saved document changed. Run the check again before navigating to a finding.",
      );
    navigate(
      "/notes/" +
        target.resourceId +
        (target.line ? "?line=" + target.line : ""),
    );
    commands.claimInspector("document");
  };
  const openReview = async (setId: string) => {
    const active = runtime.current;
    if (!active)
      throw new Error("Restart this extension before reviewing its proposal.");
    await api("plugins/reviews/" + setId, {
      method: "POST",
      body: JSON.stringify(active.authority()),
    });
    setReview(setId);
  };
  return (
    <Context.Provider
      value={{
        registry: data.data ?? null,
        error: data.error,
        loading: data.loading,
        refresh: data.reload,
        safeMode,
        setSafeMode,
        launch,
      }}
    >
      <PluginInspectorBoundary owner={commands.inspector}>
        {children}
      </PluginInspectorBoundary>
      {selected &&
        inspectorHost &&
        createPortal(
          <ResizablePanel
            className="plugin-inspector"
            label="Extension inspector"
            account={session.user.id}
            name="document-context"
            edge="left"
            hidden={commands.inspector !== "plugin"}
          >
            <header className="plugin-panel-heading">
              <Puzzle size={18} />
              <div>
                <strong>{selected.manifest.name}</strong>
                <small>
                  Extension · {selected.manifest.version} · {status}
                  {scopeName ? " · " + scopeName : ""}
                </small>
              </div>
              <IconButton
                label="Stop extension"
                disabled={!runtime.current}
                onClick={stop}
              >
                <Square size={15} />
              </IconButton>
              <IconButton
                label="Close extension panel"
                onClick={() => {
                  stop();
                  commands.claimInspector("document");
                }}
              >
                <X size={16} />
              </IconButton>
            </header>
            <div className="plugin-panel-content">
              <HelpText>
                Native Axiom panel · {selected.manifest.author}. Package author
                names are declarations, not verified identities.
              </HelpText>
              <ErrorNotice message={error} />
              {busy && (
                <Loading
                  label={
                    status === "loading"
                      ? "Starting isolated extension…"
                      : "Running extension command…"
                  }
                />
              )}
              {panel && (
                <>
                  <h2>{panel.title}</h2>
                  {panel.blocks.map((block, index) => {
                    const key =
                      block.kind === "field"
                        ? "field:" + block.field.id
                        : block.kind + ":" + index;
                    if (block.kind === "text")
                      return <p key={key}>{block.text}</p>;
                    if (block.kind === "heading")
                      return <h3 key={key}>{block.text}</h3>;
                    if (block.kind === "notice")
                      return (
                        <Notice key={key} tone={block.tone}>
                          {block.text}
                        </Notice>
                      );
                    if (block.kind === "separator") return <hr key={key} />;
                    if (block.kind === "field")
                      return (
                        <PluginFieldControl
                          key={key}
                          field={block.field}
                          value={fields[block.field.id]}
                          disabled={busy}
                          onChange={(value) =>
                            setFields((old) => ({
                              ...old,
                              [block.field.id]: value,
                            }))
                          }
                        />
                      );
                    if (block.kind === "action")
                      return (
                        <ActionRow key={key}>
                          <Button
                            variant={block.primary ? "primary" : "secondary"}
                            disabled={busy || !runtime.current}
                            onClick={() => runAction(block.command)}
                          >
                            {block.label}
                          </Button>
                        </ActionRow>
                      );
                    if (block.kind === "link")
                      return (
                        <Button
                          key={key}
                          variant="ghost"
                          onClick={() =>
                            void openLink(block.target).catch((e) =>
                              setError(e.message),
                            )
                          }
                        >
                          {block.label}
                        </Button>
                      );
                    if (block.kind === "review")
                      return (
                        <Button
                          key={key}
                          variant="primary"
                          onClick={() =>
                            void openReview(block.setId).catch((e) =>
                              setError(e.message),
                            )
                          }
                        >
                          {block.label}
                        </Button>
                      );
                    return (
                      <PluginTable
                        key={key}
                        columns={block.columns}
                        rows={block.rows}
                      />
                    );
                  })}
                </>
              )}
              <ActionRow>
                <Button
                  variant="secondary"
                  disabled={busy || safeMode}
                  onClick={() =>
                    launch(
                      selected,
                      selected.manifest.commands.find((c) => !c.panelOnly)!.id,
                      runtime.current?.start.context.spaceId,
                    )
                  }
                >
                  Restart
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => navigate("/settings/extensions")}
                >
                  Permissions & settings
                </Button>
              </ActionRow>
            </div>
          </ResizablePanel>,
          inspectorHost,
        )}
      {review && (
        <ChangeSetReview
          id={review}
          onClose={() => setReview(null)}
          onChange={data.reload}
        />
      )}
      {destination && (
        <Dialog
          title="Choose a workspace"
          subtitle="Extensions run in one explicitly approved workspace at a time."
          onClose={() => setDestination(null)}
        >
          <Field label="Workspace">
            <NativeSelect
              value={spaceChoice}
              onChange={(e) => setSpaceChoice(e.target.value)}
            >
              <option value="">Choose workspace…</option>
              {spaces
                .filter((s) => s.role && s.effective_status === "active")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <div className="dialog-footer">
            <Button variant="secondary" onClick={() => setDestination(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!spaceChoice}
              onClick={() => {
                launch(
                  destination.installation,
                  destination.command,
                  spaceChoice,
                );
                setDestination(null);
              }}
            >
              Run command
            </Button>
          </div>
        </Dialog>
      )}
    </Context.Provider>
  );
}
/** Keep the app's flex topology unchanged; the ownership marker lives on its
 * existing shell, rather than introducing a second app wrapper/scroll owner. */
function PluginInspectorBoundary({
  owner,
  children,
}: {
  owner: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".ws-app");
    if (shell) shell.dataset.inspectorOwner = owner;
    return () => {
      if (shell) delete shell.dataset.inspectorOwner;
    };
  }, [owner]);
  return children;
}
function PluginTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: string[][];
}) {
  const [page, setPage] = useState(0),
    size = 50,
    max = Math.max(0, Math.ceil(rows.length / size) - 1),
    at = Math.min(page, max);
  return (
    <div className="plugin-table">
      <div className="plugin-table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(at * size, (at + 1) * size).map((r, i) => (
              <tr key={at * size + i}>
                {r.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > size && (
        <ActionRow>
          <Button
            variant="ghost"
            disabled={at === 0}
            onClick={() => setPage(at - 1)}
          >
            Previous
          </Button>
          <span>
            {at + 1} / {max + 1}
          </span>
          <Button
            variant="ghost"
            disabled={at === max}
            onClick={() => setPage(at + 1)}
          >
            Next
          </Button>
        </ActionRow>
      )}
    </div>
  );
}
