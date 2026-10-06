"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Play, Puzzle, ShieldCheck, Upload } from "lucide-react";
import {
  pluginCapabilityLabels,
  pluginCommandId,
  pluginLimits,
  pluginPermissionActive,
  type PluginInstallation,
} from "@axiom/shared/plugins";
import { api, timeAgo } from "../../lib/client";
import { useWorkspaceCommands } from "../../lib/workspace-commands";
import { usePlugins } from "./PluginProvider";
import {
  pluginFieldDefaults,
  PluginFieldControl,
  type FieldValues,
} from "./PluginFields";
import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  HelpText,
  NativeSelect,
  Notice,
  SearchField,
  Switch,
  TextInput,
} from "../ui/controls";
import {
  ErrorNotice,
  Loading,
  useWorkspace,
  useLocation,
} from "../workspace/ui";
import Dialog from "../Dialog";
import { useRetainedSettingsForm } from "../../lib/settings-forms";
import ChangeSetReview from "../assistant/ChangeSetReview";
type ConfigurationDraft = {
  revision: number;
  values: FieldValues;
  bindings: Record<string, string>;
  baseValues: FieldValues;
  baseBindings: Record<string, string>;
};
const configurationDirty = (d: ConfigurationDraft) =>
  JSON.stringify(d.values) !== JSON.stringify(d.baseValues) ||
  JSON.stringify(d.bindings) !== JSON.stringify(d.baseBindings);
const initialConfiguration = (i: PluginInstallation): ConfigurationDraft => {
  const values = {
    ...pluginFieldDefaults(i.manifest.settings),
    ...i.settings,
  } as FieldValues;
  return {
    revision: i.revision,
    values,
    bindings: i.bindings,
    baseValues: values,
    baseBindings: i.bindings,
  };
};

export default function ExtensionsSettings() {
  const { params } = useLocation();
  const extensions = usePlugins(),
    commands = useWorkspaceCommands(),
    { spaces, session } = useWorkspace();
  const { registry } = extensions;
  const [search, setSearch] = useState(""),
    [tab, setTab] = useState<"installed" | "catalog" | "activity">("catalog"),
    [selectedHash, setSelectedHash] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [grantSpace, setGrantSpace] = useState(params.get("space") ?? ""),
    [approvalGroup, setApprovalGroup] = useState(params.get("group") ?? ""),
    [approvalSpaces, setApprovalSpaces] = useState<string[]>([]),
    [consent, setConsent] = useState(false),
    [remove, setRemove] = useState(false),
    [clearSettings, setClearSettings] = useState(false),
    [review, setReview] = useState<string | null>(null);
  // Above the selected package projection: switching packages or refreshing
  // does not silently discard or overwrite unsaved configuration.
  const [configurationDrafts, setConfigurationDrafts] = useState<
    Record<string, ConfigurationDraft>
  >({});
  useRetainedSettingsForm(
    "extensions",
    Object.values(configurationDrafts).some(configurationDirty),
    () => setConfigurationDrafts({}),
  );
  const input = useRef<HTMLInputElement>(null);
  const catalog = registry?.catalog ?? [],
    installation = registry?.installations.find(
      (i) =>
        i.package_hash === selectedHash ||
        i.plugin_id ===
          catalog.find((p) => p.hash === selectedHash)?.manifest.id,
    ),
    candidate = catalog.find((p) => p.hash === selectedHash),
    manifest = candidate?.manifest ?? installation?.manifest;
  const currentHash = selectedHash || installation?.package_hash;
  const grant = registry?.grants.find(
    (g) => g.installation_id === installation?.id && g.space_id === grantSpace,
  );
  const approval = registry?.approvals.find(
    (a) => a.group_id === approvalGroup && a.plugin_id === manifest?.id,
  );
  const [capabilities, setCapabilities] = useState<string[]>([]);
  useEffect(() => {
    setCapabilities(
      grant &&
        grant.package_hash === installation?.package_hash &&
        !grant.revoked_at
        ? grant.capabilities
        : (manifest?.capabilities ?? []),
    );
  }, [
    grant?.id,
    grant?.revision,
    grant?.package_hash,
    grant?.revoked_at,
    installation?.package_hash,
    manifest?.id,
  ]);
  useEffect(() => {
    setApprovalSpaces(approval?.space_ids ?? []);
  }, [approval?.group_id, approval?.revision, approvalGroup, manifest?.id]);
  useEffect(() => {
    if (!selectedHash && catalog.length) setSelectedHash(catalog[0].hash);
  }, [catalog, selectedHash]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      extensions.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extension operation failed.");
    } finally {
      setBusy(false);
    }
  };
  const importPackage = async (file: File) => {
    if (file.size > pluginLimits.compressedBytes) {
      setError("Choose a ZIP package no larger than 5 MiB.");
      return;
    }
    await run(async () => {
      const p = await api<{ hash: string }>("plugins/packages", {
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: await file.arrayBuffer(),
      });
      setSelectedHash(p.hash);
      setTab("catalog");
    });
  };
  const groups = session.groups.filter((g) => g.role !== "member");
  const choices =
    tab === "installed"
      ? (registry?.installations ?? []).map((i) => ({
          hash: i.package_hash,
          manifest: i.manifest,
        }))
      : catalog;
  const filtered = choices.filter((p) =>
    `${p.manifest.name} ${p.manifest.description} ${p.manifest.author}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  if (extensions.loading && !registry)
    return <Loading label="Loading extensions…" />;
  return (
    <div className="extensions-settings">
      <ErrorNotice
        message={extensions.error || error}
        retry={extensions.refresh}
      />
      {!registry?.enabled ? (
        <Notice>
          Extensions are disabled on this server. An administrator can enable
          the pilot platform with <code>AXIOM_PLUGINS_ENABLED=true</code> after
          applying the database migration. Third-party imports have a separate
          security gate.
        </Notice>
      ) : (
        <>
          <header className="extensions-toolbar">
            <HelpText>
              Explicit permissions · no external network · changes always
              reviewed
            </HelpText>
            <ActionRow>
              <label className="ws-checkbox">
                <Switch
                  checked={extensions.safeMode}
                  onChange={(event) =>
                    extensions.setSafeMode(event.target.checked)
                  }
                />
                Safe mode
              </label>
              {registry.importsEnabled && (
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  <Upload size={16} />
                  Import package
                </Button>
              )}
            </ActionRow>
          </header>
          <input
            ref={input}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importPackage(file);
              e.target.value = "";
            }}
          />
          <div className="extensions-layout">
            <section
              className="extensions-directory"
              aria-label="Extension directory"
            >
              <nav className="extensions-tabs" aria-label="Extension views">
                {(["installed", "catalog", "activity"] as const).map((t) => (
                  <Button
                    key={t}
                    variant="ghost"
                    size="compact"
                    aria-pressed={tab === t}
                    onClick={() => setTab(t)}
                  >
                    {t === "installed"
                      ? "Installed"
                      : t === "catalog"
                        ? "Available"
                        : "Activity"}
                  </Button>
                ))}
              </nav>
              {tab !== "activity" && (
                <SearchField
                  aria-label="Find extensions"
                  placeholder="Find an extension…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onClear={() => setSearch("")}
                />
              )}
              <div className="extensions-list">
                {tab === "activity" ? (
                  <ul className="plugin-activity-list">
                    {registry.activity.map((a) => (
                      <li key={a.id}>
                        <div>
                          <strong>{a.method.replace(/^rpc:/, "")}</strong>
                          <small>
                            {a.outcome} · {timeAgo(a.created_at)}
                          </small>
                        </div>
                        {a.change_set_id && (
                          <>
                            <Button
                              variant="ghost"
                              size="compact"
                              onClick={() => setReview(a.change_set_id!)}
                            >
                              Review
                            </Button>
                            {["draft", "queued", "applying"].includes(
                              a.change_set_status ?? "",
                            ) && (
                              <Button
                                variant="ghost"
                                size="compact"
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    api(
                                      "plugins/proposals/" + a.change_set_id,
                                      { method: "DELETE" },
                                    ),
                                  )
                                }
                              >
                                Cancel
                              </Button>
                            )}
                          </>
                        )}
                      </li>
                    ))}
                    {!registry.activity.length && (
                      <li>No extension activity yet.</li>
                    )}
                  </ul>
                ) : (
                  filtered.map((p) => {
                    const installed = registry.installations.find(
                      (i) => i.plugin_id === p.manifest.id,
                    );
                    return (
                      <button
                        className="extension-directory-item"
                        key={p.hash}
                        aria-pressed={currentHash === p.hash}
                        onClick={() => {
                          setSelectedHash(p.hash);
                          setError("");
                        }}
                      >
                        <Puzzle size={18} />
                        <span>
                          <strong>{p.manifest.name}</strong>
                          <small>
                            {p.manifest.version} ·{" "}
                            {installed?.package_hash === p.hash
                              ? installed.enabled
                                ? "Enabled"
                                : "Disabled"
                              : "Not installed"}
                          </small>
                        </span>
                      </button>
                    );
                  })
                )}
                {tab !== "activity" && !filtered.length && (
                  <p className="muted">
                    {tab === "installed"
                      ? "No installed extensions match."
                      : "No matching packages."}
                  </p>
                )}
              </div>
              <HelpText>
                {registry.importsEnabled
                  ? "Author names are unverified. Import only packages you trust."
                  : "Three shipped pilots. Third-party imports remain disabled pending security acceptance."}
              </HelpText>
            </section>
            <section
              className="extensions-detail settings-card"
              aria-label="Extension details"
            >
              {!manifest ? (
                <p>Select an extension to review its details.</p>
              ) : (
                <>
                  <header className="extension-detail-heading">
                    <Puzzle size={22} />
                    <div>
                      <h2>{manifest.name}</h2>
                      <HelpText>
                        {manifest.author} · {manifest.version} ·{" "}
                        {manifest.license}
                      </HelpText>
                    </div>
                  </header>
                  <p>{manifest.description}</p>
                  <details className="extension-package-details">
                    <summary>Package identity & security</summary>
                    <p>
                      <code>{currentHash}</code>
                    </p>
                    <HelpText>
                      SHA-256 identifies the exact immutable ZIP, not its
                      trustworthiness. Browser code only, isolated worker, no
                      DOM or external network. Workspace content stays subject
                      to your current access.
                    </HelpText>
                  </details>
                  <h3>Requested permissions</h3>
                  {!manifest.capabilities.length && (
                    <HelpText>
                      No file, planning, reference or private-storage access.
                    </HelpText>
                  )}
                  <ul className="extension-permission-list">
                    {manifest.capabilities.map((c) => (
                      <li key={c}>
                        <ShieldCheck size={15} />
                        <span>{pluginCapabilityLabels[c]}</span>
                      </li>
                    ))}
                  </ul>
                  <ActionRow>
                    {!installation ||
                    installation.package_hash !== currentHash ? (
                      <Button
                        variant="primary"
                        pending={busy}
                        onClick={() =>
                          void run(() =>
                            api("plugins/installations", {
                              method: "POST",
                              body: JSON.stringify({
                                packageHash: currentHash,
                                expectedRevision: installation?.revision,
                              }),
                            }),
                          )
                        }
                      >
                        {installation
                          ? "Install reviewed update"
                          : "Install disabled"}
                      </Button>
                    ) : (
                      <label className="ws-checkbox">
                        <Switch
                          checked={installation.enabled}
                          disabled={busy}
                          onChange={(event) =>
                            void run(() =>
                              api("plugins/installations/" + installation.id, {
                                method: "PATCH",
                                body: JSON.stringify({
                                  revision: installation.revision,
                                  enabled: event.target.checked,
                                }),
                              }),
                            )
                          }
                        />
                        Enabled for your account
                      </label>
                    )}
                    {installation &&
                      installation.package_hash === currentHash && (
                        <Button
                          variant="ghost"
                          disabled={
                            !installation.enabled || busy || extensions.safeMode
                          }
                          onClick={() =>
                            extensions.launch(
                              installation,
                              manifest.commands.find((c) => !c.panelOnly)!.id,
                            )
                          }
                        >
                          <Play size={15} />
                          Run
                        </Button>
                      )}
                    <Button
                      variant="ghost"
                      onClick={() => {
                        window.location.assign(
                          "/api/v1/plugins/packages/" + currentHash,
                        );
                      }}
                    >
                      <Download size={15} />
                      Package
                    </Button>
                  </ActionRow>
                  {installation &&
                    installation.package_hash !== currentHash && (
                      <Notice tone="warning">
                        Updating disables the installation and invalidates its
                        workspace grants. Review new permissions and group
                        approval before enabling the new package.
                      </Notice>
                    )}
                  {installation &&
                    installation.package_hash === currentHash && (
                      <>
                        <section className="extension-detail-section">
                          <h3>Workspace access</h3>
                          <Field label="Workspace">
                            <NativeSelect
                              value={grantSpace}
                              onChange={(e) => setGrantSpace(e.target.value)}
                            >
                              <option value="">Choose workspace…</option>
                              {spaces
                                .filter(
                                  (s) =>
                                    s.role && s.effective_status === "active",
                                )
                                .map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                    {s.group_name ? " · " + s.group_name : ""}
                                  </option>
                                ))}
                            </NativeSelect>
                          </Field>
                          {grantSpace && (
                            <>
                              <HelpText>
                                {grant &&
                                !grant.revoked_at &&
                                grant.package_hash === installation.package_hash
                                  ? pluginPermissionActive(
                                      grant.effective_expires_at ??
                                        grant.expires_at,
                                    )
                                    ? `Access expires ${new Date(grant.effective_expires_at ?? grant.expires_at).toLocaleString()}. Every call rechecks current access.`
                                    : "Access expired. Renew permissions; team approval must also be current."
                                  : "No current grant. Team workspaces require manager approval of this exact package first."}
                              </HelpText>
                              <ActionRow>
                                <Button
                                  variant="secondary"
                                  disabled={!installation.enabled || busy}
                                  onClick={() => setConsent(true)}
                                >
                                  {grant && !grant.revoked_at
                                    ? "Renew permissions"
                                    : "Review permissions"}
                                </Button>
                                {grant && !grant.revoked_at && (
                                  <Button
                                    variant="ghost"
                                    disabled={busy}
                                    onClick={() =>
                                      void run(() =>
                                        api("plugins/grants/" + grant.id, {
                                          method: "DELETE",
                                          body: JSON.stringify({
                                            revision: grant.revision,
                                          }),
                                        }),
                                      )
                                    }
                                  >
                                    Revoke access
                                  </Button>
                                )}
                              </ActionRow>
                            </>
                          )}
                        </section>
                        {!!groups.length && (
                          <section className="extension-detail-section">
                            <h3>Group approval</h3>
                            <HelpText>
                              Approval allows members to request access. It does
                              not enable extensions for them or grant managers
                              access to restricted content.
                            </HelpText>
                            <Field label="Managed group">
                              <NativeSelect
                                value={approvalGroup}
                                onChange={(e) =>
                                  setApprovalGroup(e.target.value)
                                }
                              >
                                <option value="">Choose a group…</option>
                                {groups.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                              </NativeSelect>
                            </Field>
                            {approvalGroup && (
                              <>
                                <div className="extension-approval-options">
                                  {spaces
                                    .filter((s) => s.group_id === approvalGroup)
                                    .map((s) => (
                                      <label key={s.id} className="ws-checkbox">
                                        <Checkbox
                                          checked={approvalSpaces.includes(
                                            s.id,
                                          )}
                                          disabled={busy}
                                          onChange={(event) =>
                                            setApprovalSpaces((old) =>
                                              event.target.checked
                                                ? [...old, s.id]
                                                : old.filter(
                                                    (id) => id !== s.id,
                                                  ),
                                            )
                                          }
                                        />
                                        {s.name}
                                      </label>
                                    ))}
                                </div>
                                <HelpText>
                                  {approval?.enabled
                                    ? `${pluginPermissionActive(approval.expires_at) ? "Approval expires" : "Approval expired"} ${new Date(approval.expires_at).toLocaleString()}.`
                                    : "Approval lasts 30 days and never grants content access."}
                                </HelpText>
                                <ActionRow>
                                  <Button
                                    variant="secondary"
                                    disabled={busy || !approvalSpaces.length}
                                    onClick={() =>
                                      void run(() =>
                                        api("plugins/approvals", {
                                          method: "POST",
                                          body: JSON.stringify({
                                            groupId: approvalGroup,
                                            packageHash: currentHash,
                                            spaceIds: approvalSpaces,
                                            enabled: true,
                                            revision: approval?.revision,
                                          }),
                                        }),
                                      )
                                    }
                                  >
                                    {approval?.enabled
                                      ? "Renew approval"
                                      : "Approve package"}
                                  </Button>
                                  {approval?.enabled && (
                                    <Button
                                      variant="ghost"
                                      disabled={busy}
                                      onClick={() =>
                                        void run(() =>
                                          api("plugins/approvals", {
                                            method: "POST",
                                            body: JSON.stringify({
                                              groupId: approvalGroup,
                                              packageHash: currentHash,
                                              spaceIds: [],
                                              enabled: false,
                                              revision: approval.revision,
                                            }),
                                          }),
                                        )
                                      }
                                    >
                                      Withdraw approval
                                    </Button>
                                  )}
                                </ActionRow>
                                <HelpText>
                                  Changing approval invalidates old workspace
                                  grants; members must consent again.
                                </HelpText>
                              </>
                            )}
                          </section>
                        )}
                        <ExtensionConfiguration
                          key={installation.id}
                          installation={installation}
                          draft={
                            configurationDrafts[installation.id] ??
                            initialConfiguration(installation)
                          }
                          onDraft={(draft) =>
                            setConfigurationDrafts((old) => {
                              const next = { ...old };
                              if (draft && configurationDirty(draft))
                                next[installation.id] = draft;
                              else delete next[installation.id];
                              return next;
                            })
                          }
                          busy={busy}
                          onSave={async (
                            settings,
                            bindings,
                            expectedRevision,
                          ) => {
                            setBusy(true);
                            try {
                              await api(
                                "plugins/installations/" + installation.id,
                                {
                                  method: "PATCH",
                                  body: JSON.stringify({
                                    revision: expectedRevision,
                                    settings,
                                    bindings,
                                  }),
                                },
                              );
                              setConfigurationDrafts((old) => {
                                const next = { ...old };
                                delete next[installation.id];
                                return next;
                              });
                              extensions.refresh();
                            } finally {
                              setBusy(false);
                            }
                          }}
                          conflict={commands.bindingConflict}
                        />
                        <section className="extension-detail-section">
                          <h3>Lifecycle</h3>
                          <ActionRow>
                            {installation.previous_hash && (
                              <Button
                                variant="secondary"
                                disabled={busy}
                                onClick={() =>
                                  void run(() =>
                                    api(
                                      "plugins/installations/" +
                                        installation.id,
                                      {
                                        method: "PATCH",
                                        body: JSON.stringify({
                                          revision: installation.revision,
                                          rollback: true,
                                        }),
                                      },
                                    ),
                                  )
                                }
                              >
                                Roll back package
                              </Button>
                            )}
                            <Button
                              variant="danger"
                              disabled={busy}
                              onClick={() => setRemove(true)}
                            >
                              Uninstall
                            </Button>
                          </ActionRow>
                          <HelpText>
                            Uninstalling never removes documents or applied
                            changes. Rollback changes the package, not your
                            research files.
                          </HelpText>
                        </section>
                      </>
                    )}
                </>
              )}
            </section>
          </div>
        </>
      )}
      {consent && manifest && installation && (
        <Dialog
          title="Review workspace permissions"
          subtitle={
            manifest.name +
            " · " +
            spaces.find((s) => s.id === grantSpace)?.name
          }
          onClose={() => setConsent(false)}
        >
          <Notice>
            Only this workspace is in scope. Proposed research changes require a
            separate preview and explicit Apply. Permissions expire after 30
            days, or earlier when group approval expires. Renewal invalidates
            stale proposals.
          </Notice>
          <div className="extension-permission-options">
            {manifest.capabilities.map((c) => (
              <label key={c} className="ws-checkbox">
                <Checkbox
                  checked={capabilities.includes(c)}
                  onChange={(event) =>
                    setCapabilities((old) =>
                      event.target.checked
                        ? [...old, c]
                        : old.filter((v) => v !== c),
                    )
                  }
                />
                {pluginCapabilityLabels[c]}
              </label>
            ))}
          </div>
          <ErrorNotice message={error} />
          <div className="dialog-footer">
            <Button variant="secondary" onClick={() => setConsent(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              pending={busy}
              onClick={() =>
                void run(async () => {
                  await api("plugins/grants", {
                    method: "POST",
                    body: JSON.stringify({
                      installationId: installation.id,
                      installationRevision: installation.revision,
                      spaceId: grantSpace,
                      capabilities,
                      grantRevision: grant?.revision,
                    }),
                  });
                  setConsent(false);
                })
              }
            >
              {grant && !grant.revoked_at
                ? "Renew selected permissions"
                : "Grant for 30 days"}
            </Button>
          </div>
        </Dialog>
      )}
      {remove && installation && (
        <Dialog
          title={"Uninstall " + installation.manifest.name + "?"}
          subtitle="All workspace grants will be invalidated. Your files and applied changes remain."
          onClose={() => setRemove(false)}
        >
          <label className="ws-checkbox">
            <Checkbox
              checked={clearSettings}
              onChange={(event) => setClearSettings(event.target.checked)}
            />
            Also clear private extension settings and state
          </label>
          <ErrorNotice message={error} />
          <div className="dialog-footer">
            <Button variant="secondary" onClick={() => setRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              pending={busy}
              onClick={() =>
                void run(async () => {
                  await api("plugins/installations/" + installation.id, {
                    method: "DELETE",
                    body: JSON.stringify({
                      revision: installation.revision,
                      clearSettings,
                    }),
                  });
                  setRemove(false);
                  setTab("catalog");
                })
              }
            >
              Uninstall extension
            </Button>
          </div>
        </Dialog>
      )}
      {review && (
        <ChangeSetReview id={review} onClose={() => setReview(null)} />
      )}
    </div>
  );
}
function ExtensionConfiguration({
  installation,
  busy,
  onSave,
  conflict,
  draft,
  onDraft,
}: {
  installation: PluginInstallation;
  busy: boolean;
  draft: ConfigurationDraft;
  onDraft: (draft: ConfigurationDraft | null) => void;
  onSave: (
    settings: FieldValues,
    bindings: Record<string, string>,
    revision: number,
  ) => Promise<unknown>;
  conflict: (key: string, except?: string) => string;
}) {
  const [error, setError] = useState("");
  const { values, bindings } = draft,
    dirty = configurationDirty(draft);
  return (
    <section className="extension-detail-section">
      <h3>Configuration & shortcuts</h3>
      {dirty && draft.revision !== installation.revision && (
        <Notice tone="warning">
          This installation changed while you were editing. Your draft is
          retained; discard it to load the latest configuration. Saving an old
          revision is blocked.
        </Notice>
      )}
      <form
        className="extension-configuration"
        onSubmit={(e) => {
          e.preventDefault();
          for (const [id, key] of Object.entries(bindings)) {
            if (!key) continue;
            const issue = conflict(
              key,
              pluginCommandId(installation.plugin_id, id),
            );
            if (issue) {
              setError(issue);
              return;
            }
          }
          setError("");
          void onSave(
            values,
            Object.fromEntries(
              Object.entries(bindings).filter(([, key]) => key),
            ),
            draft.revision,
          ).catch((e) => setError(e.message));
        }}
      >
        {installation.manifest.settings.map((f) => (
          <PluginFieldControl
            key={f.id}
            field={f}
            value={values[f.id]}
            disabled={busy}
            onChange={(value) =>
              onDraft({ ...draft, values: { ...values, [f.id]: value } })
            }
          />
        ))}
        {installation.manifest.commands
          .filter((c) => !c.panelOnly)
          .map((c) => (
            <Field
              key={c.id}
              label={c.title + " shortcut"}
              hint="Optional, for example Mod-Alt-p. Native editor and browser shortcuts take priority; plugin shortcuts do not intercept editable fields."
            >
              <TextInput
                value={bindings[c.id] ?? ""}
                disabled={busy}
                placeholder="No shortcut"
                onChange={(e) =>
                  onDraft({
                    ...draft,
                    bindings: { ...bindings, [c.id]: e.target.value },
                  })
                }
              />
            </Field>
          ))}
        <ErrorNotice message={error} />
        <ActionRow>
          <Button
            variant="secondary"
            type="button"
            disabled={!dirty || busy}
            onClick={() => {
              onDraft(null);
              setError("");
            }}
          >
            Discard
          </Button>
          <Button variant="primary" pending={busy} disabled={!dirty}>
            Save configuration
          </Button>
        </ActionRow>
      </form>
    </section>
  );
}
