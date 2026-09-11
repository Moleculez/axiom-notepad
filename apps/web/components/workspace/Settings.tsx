"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  HardDrive,
  KeyRound,
  Monitor,
  ShieldCheck,
  Trash2,
  Upload,
  ArrowLeft,
  Search,
  X,
  UserRound,
  Bell,
  Users,
  Palette,
  Type,
  SlidersHorizontal,
  PencilLine,
  Table2,
  Code2,
  Sigma,
  Keyboard,
  Database,
} from "lucide-react";
import { api, authRequest, download, post, timeAgo } from "../../lib/client";
import { ExportsPage, GroupsPage } from "./AccountPages";
import { useResearch } from "../../lib/research-store";
import AppearanceSettings from "../AppearanceSettings";
import ResearchDataSettings from "../ResearchDataSettings";
import ConnectionsSettings from "./ConnectionsSettings";
import OfflineSettings from "./OfflineSettings";
import InstallControls from "./InstallControls";
import Dialog from "../Dialog";
import { useSettingsDraft } from "../../lib/settings-draft";
import {
  appearanceSections,
  settingsCategories,
  settingsCategory,
  preferenceCategory,
  writingControls,
  appearanceSettingGroups,
} from "../../lib/settings-registry";
import { Avatar } from "./Pages";

type RetainedForm = { dirty: boolean; discard: () => void };
const SettingsForms = createContext<Map<string, RetainedForm> | null>(null);
function useRetainedForm(id: string, dirty: boolean, discard: () => void) {
  const forms = useContext(SettingsForms);
  useEffect(() => {
    forms?.set(id, { dirty, discard });
    return () => {
      forms?.delete(id);
    };
  }, [forms, id, dirty, discard]);
}
import {
  Badge,
  bytes,
  Empty,
  ErrorNotice,
  Loading,
  mutate,
  PageHeading,
  useAction,
  useData,
  useLocation,
  useWorkspace,
  WorkspaceLink,
  BASE,
  go,
} from "./ui";

export function SettingsNavigation() {
  const { parts, params } = useLocation();
  const selected = settingsCategory(parts[1], params.get("section"));
  const [search, setSearch] = useState("");
  const icons: Record<string, typeof Monitor> = {
    connections: ShieldCheck,
    profile: UserRound,
    security: ShieldCheck,
    notifications: Bell,
    groups: Users,
    theme: Palette,
    typography: Type,
    layout: SlidersHorizontal,
    device: Monitor,
    writing: PencilLine,
    tables: Table2,
    code: Code2,
    math: Sigma,
    shortcuts: Keyboard,
    storage: HardDrive,
    data: Database,
    exports: Download,
  };
  const matches = settingsCategories.filter((category) =>
    `${category.label} ${category.description} ${appearanceSettingGroups[appearanceSections[category.id]]?.join(" ") ?? ""} ${writingControls
      .filter((c) => c.category === appearanceSections[category.id])
      .map((c) => `${c.label} ${c.hint}`)
      .join(" ")}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <nav className="settings-center-nav" aria-label="Settings categories">
      <label className="settings-search">
        <Search size={16} />
        <input
          aria-label="Find settings category"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a setting…"
        />
        {search && (
          <button
            type="button"
            className="settings-search-clear"
            aria-label="Clear category search"
            onClick={() => setSearch("")}
          >
            <X size={14} />
          </button>
        )}
      </label>
      {!matches.length && (
        <p className="settings-nav-empty" role="status">
          No matching categories. Try “font”, “code”, or “storage”.
        </p>
      )}
      {["Account", "Appearance", "Writing", "Storage"].map((group) => {
        const entries = matches.filter((category) => category.group === group);
        return entries.length ? (
          <section key={group}>
            <h3>{group}</h3>
            {entries.map((category) => {
              const Icon = icons[category.id];
              return (
                <WorkspaceLink
                  key={category.id}
                  to={`/settings/${category.id}`}
                  className={`ws-side-link ${selected === category.id ? "active" : ""}`}
                  aria-current={selected === category.id ? "page" : undefined}
                >
                  <Icon size={16} aria-hidden="true" />
                  {category.label}
                </WorkspaceLink>
              );
            })}
          </section>
        ) : null;
      })}
    </nav>
  );
}

export default function SettingsPage({
  section = "profile",
  active = true,
}: {
  section?: string;
  active?: boolean;
}) {
  const { appearance, editorSettings, session } = useWorkspace();
  if (!appearance.ready || !editorSettings.ready)
    return active ? <Loading /> : null;
  return (
    <SettingsReady section={section} active={active} key={session.user.id} />
  );
}
function SettingsReady({
  section: inputSection,
  active,
}: {
  section: string;
  active: boolean;
}) {
  const { appearance, editorSettings, navigate, session, spaces, open } =
      useWorkspace(),
    { params, path } = useLocation();
  const section = settingsCategory(inputSection, params.get("section"));
  const preference = preferenceCategory(section);
  const draft = useSettingsDraft(appearance, editorSettings, active);
  const forms = useRef(new Map<string, RetainedForm>()),
    visitedForms = useRef(new Set<string>());
  if (active && ["profile", "notifications"].includes(section))
    visitedForms.current.add(section);
  const formsDirty = () =>
    [...forms.current.values()].some((form) => form.dirty);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const returnPath = useRef(
    typeof history !== "undefined"
      ? (history.state?.axiomSettingsReturn ?? BASE + "/home")
      : BASE + "/home",
  );
  const currentPath = useRef(BASE + "/settings/" + inputSection);
  if (active)
    currentPath.current =
      BASE + path + (params.size ? "?" + params.toString() : "");
  const [leaving, setLeaving] = useState<{ proceed: () => void } | null>(null);
  useEffect(() => {
    const before = (event: Event) => {
      const navigation = event as CustomEvent<{
        destination: string;
        proceed: () => void;
      }>;
      if (!draftRef.current.dirty && !formsDirty()) return;
      event.preventDefault();
      setLeaving({ proceed: navigation.detail.proceed });
      queueMicrotask(() => go(currentPath.current, false, true));
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (draftRef.current.dirty || formsDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("axiom:close-settings", before);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("axiom:close-settings", before);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  const [dataContext, setDataContext] = useState(""),
    openAction = useAction();
  const context =
      dataContext ||
      (spaces.find((space) => space.kind === "personal")?.id ??
        session.groups[0]?.id ??
        ""),
    research = useResearch(
      active && section === "data" ? session.user.id : undefined,
      context,
    );
  const labels: Record<string, string> = {
    profile: "Your researcher profile",
    appearance: "Make Axiom your own",
    security: "Account security",
    notifications: "A quieter inbox",
    storage: "Storage & file versions",
    data: "Your offline research",
    connections: "Connected applications",
    groups: "Your research groups",
    exports: "Portable exports",
  };
  return (
    <SettingsForms.Provider value={forms.current}>
      <main
        hidden={!active}
        style={!active ? { display: "none" } : undefined}
        className={`ws-page ws-settings-page ${preference ? "ws-appearance-page" : ""}`}
        data-settings-section={section}
      >
        <div className="settings-center-heading">
          <button
            className="text-button"
            onClick={() => go(returnPath.current)}
          >
            <ArrowLeft size={16} />
            Back to workspace
          </button>
          <span>
            Settings ·{" "}
            {
              settingsCategories.find((category) => category.id === section)
                ?.group
            }
          </span>
        </div>
        {!preference && (
          <PageHeading
            eyebrow="PERSONAL SETTINGS"
            title={labels[section] ?? "Settings"}
          >
            {
              settingsCategories.find((category) => category.id === section)
                ?.description
            }
          </PageHeading>
        )}
        {!preference && draft.dirty && (
          <section
            className="settings-pending-preferences"
            aria-label="Pending appearance and writing changes"
          >
            <span>Appearance & writing changes are still in preview.</span>
            <div className="ws-actions">
              <button
                className="button secondary small"
                onClick={draft.discard}
              >
                Discard preference changes
              </button>
              <button className="button primary small" onClick={draft.apply}>
                Apply preferences
              </button>
            </div>
          </section>
        )}
        {!active ? null : preference ? (
          <AppearanceSettings
            appearance={appearance}
            editorSettings={editorSettings}
            initialSection={appearanceSections[section]}
            routed
            session={draft}
            onClose={draft.discard}
            onWorkspace={() => navigate("/settings/profile")}
            onData={() => navigate("/settings/data")}
          />
        ) : section === "connections" ? (
          <ConnectionsSettings />
        ) : section === "profile" ? null : section === "security" ? (
          <SecuritySettings />
        ) : section === "notifications" ? null : section === "storage" ? (
          <StorageSettings />
        ) : section === "groups" ? (
          <GroupsPage />
        ) : section === "exports" ? (
          <ExportsPage />
        ) : section === "data" ? (
          <>
            <InstallControls />
            <OfflineSettings />
            <label>
              Reading context
              <select
                value={context}
                onChange={(event) => setDataContext(event.target.value)}
              >
                <option
                  value={spaces.find((space) => space.kind === "personal")?.id}
                >
                  Personal space
                </option>
                {session.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <ErrorNotice message={openAction.error} />
            <ResearchDataSettings
              userId={session.user.id}
              research={research}
              preferences={appearance.effective}
              onOpenPaper={(paper) => {
                void openAction.run(async () => {
                  const item = await api(
                    `attachments/${paper.meta.id}/resource`,
                  );
                  open({ kind: "file", id: item.id, versionId: paper.meta.id });
                });
              }}
              onOpenBookmark={(item) =>
                item.target_type === "note"
                  ? open({ kind: "note", id: item.target_id })
                  : void openAction.run(async () => {
                      const file = await api(
                        `attachments/${item.target_id}/resource`,
                      );
                      open({
                        kind: "file",
                        id: file.id,
                        versionId: item.target_id,
                      });
                    })
              }
            />
          </>
        ) : (
          <Empty title="Choose a setting">
            Use the account navigation to find what you need.
          </Empty>
        )}
        {visitedForms.current.has("profile") && (
          <div hidden={section !== "profile"}>
            <ProfileSettings />
          </div>
        )}
        {visitedForms.current.has("notifications") && (
          <div hidden={section !== "notifications"}>
            <NotificationSettings />
          </div>
        )}
        {active && leaving && (
          <Dialog
            title={
              formsDirty()
                ? "Keep your unsaved settings?"
                : "Apply your preference changes?"
            }
            subtitle={
              formsDirty()
                ? "Profile or notification changes are unsaved. Stay to save those forms, or discard all changes before closing this tab."
                : "Your appearance and writing preferences are in live preview. Choose what to keep before leaving."
            }
            onClose={() => setLeaving(null)}
            size="compact"
          >
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => setLeaving(null)}
              >
                Stay in settings
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  draft.discard();
                  for (const form of forms.current.values()) form.discard();
                  setLeaving(null);
                  leaving.proceed();
                }}
              >
                Discard changes
              </button>
              <button
                className="button primary"
                disabled={formsDirty()}
                onClick={() => {
                  if (draft.apply()) leaving.proceed();
                  else setLeaving(null);
                }}
              >
                Apply and leave
              </button>
            </div>
          </Dialog>
        )}
      </main>
    </SettingsForms.Provider>
  );
}
function ProfileSettings() {
  const { refresh, refreshSession, revision } = useWorkspace(),
    data = useData("me/profile", revision);
  return (
    <>
      <ErrorNotice message={data.error} retry={data.reload} />
      {data.data ? (
        <ProfileForm
          profile={data.data}
          onSaved={() => {
            refresh();
            void refreshSession?.();
          }}
        />
      ) : (
        data.loading && <Loading />
      )}
    </>
  );
}
function ProfileForm({
  profile,
  onSaved,
}: {
  profile: any;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(profile),
    [base, setBase] = useState(profile),
    [links, setLinks] = useState(profile.links.join("\n")),
    [saved, setSaved] = useState(false),
    action = useAction(),
    avatar = useRef<HTMLInputElement>(null);
  const normalizedLinks = links
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean);
  useRetainedForm(
    "profile",
    JSON.stringify(draft) !== JSON.stringify(base) ||
      links !== base.links.join("\n"),
    () => {
      setDraft(base);
      setLinks(base.links.join("\n"));
      setSaved(false);
      action.setError("");
    },
  );
  const dirty =
    [
      "name",
      "affiliation",
      "interests",
      "biography",
      "timezone",
      "weeklyCapacity",
    ].some((key) => draft[key] !== base[key]) ||
    JSON.stringify(normalizedLinks) !== JSON.stringify(base.links);
  const set = (key: string, value: unknown) => {
    setSaved(false);
    setDraft((previous: any) => ({ ...previous, [key]: value }));
  };
  return (
    <form
      className="ws-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty || action.busy || normalizedLinks.length > 8) return;
        void action.run(async () => {
          const value = await mutate(
            "me/profile",
            {
              ...draft,
              links: links
                .split("\n")
                .map((line: string) => line.trim())
                .filter(Boolean),
            },
            "PATCH",
          );
          const next = { ...draft, ...value };
          setDraft(next);
          setBase(next);
          setLinks(next.links.join("\n"));
          setSaved(true);
          onSaved();
        });
      }}
    >
      <fieldset className="settings-form-fields" disabled={action.busy}>
        <section className="settings-form-section">
          <header>
            <h2>Identity</h2>
            <p>How your collaborators see you in Axiom.</p>
          </header>
          <div className="ws-profile-photo">
            <Avatar person={draft} />
            <div>
              <button
                type="button"
                className="button secondary"
                disabled={action.busy}
                onClick={() => avatar.current?.click()}
              >
                <Upload size={16} />
                Change photo
              </button>
              <p className="ws-small muted">
                PNG, JPEG, GIF or WebP, up to 5 MB. Images are resized and
                metadata is removed. Photos update immediately.
              </p>
            </div>
            <input
              ref={avatar}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const body = new FormData();
                body.set("file", file);
                body.set("version", String(draft.version));
                void action.run(async () => {
                  const response = await fetch("/api/v1/me/avatar", {
                    method: "POST",
                    body,
                  });
                  const data = await response.json();
                  if (!response.ok)
                    throw new Error(data.error ?? "Photo upload failed.");
                  setDraft((previous: any) => ({
                    ...previous,
                    image: data.image,
                    version: data.version,
                  }));
                  setBase((previous: any) => ({
                    ...previous,
                    image: data.image,
                    version: data.version,
                  }));
                  onSaved();
                });
                event.target.value = "";
              }}
            />
          </div>
          <div className="ws-form-grid">
            <label>
              Full name
              <input
                required
                maxLength={100}
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
              />
            </label>
            <label>
              Email address
              <input value={draft.email} readOnly autoComplete="email" />
              <small>
                Contact your administrator for account identity changes.
              </small>
            </label>
          </div>
          <label>
            Institution or affiliation
            <input
              maxLength={200}
              value={draft.affiliation}
              onChange={(event) => set("affiliation", event.target.value)}
              placeholder="Your lab, university, or research group"
            />
          </label>
        </section>
        <section className="settings-form-section">
          <header>
            <h2>Research profile</h2>
            <p>Share your interests, background, and published work.</p>
          </header>
          <label>
            Research interests
            <input
              maxLength={500}
              value={draft.interests}
              onChange={(event) => set("interests", event.target.value)}
              placeholder="e.g. Scientific ML, dynamical systems, quantum information"
            />
          </label>
          <label>
            Biography
            <textarea
              aria-label="Biography"
              maxLength={3000}
              rows={5}
              value={draft.biography}
              onChange={(event) => set("biography", event.target.value)}
            />
            <span className="settings-field-note">
              <span>A short introduction for your group.</span>
              <span>{draft.biography.length.toLocaleString()} / 3,000</span>
            </span>
          </label>
          <label>
            Research links (one per line, up to eight)
            <textarea
              aria-label="Research links (one per line, up to eight)"
              aria-invalid={normalizedLinks.length > 8 || undefined}
              rows={3}
              value={links}
              onChange={(event) => {
                setLinks(event.target.value);
                setSaved(false);
              }}
              placeholder="https://orcid.org/…"
            />
            <span className="settings-field-note">
              <span>ORCID, publications, or your lab website.</span>
              <span>{normalizedLinks.length} / 8 links</span>
            </span>
            {normalizedLinks.length > 8 && (
              <small className="form-error" role="alert">
                Keep up to eight research links before saving.
              </small>
            )}
          </label>
        </section>
        <section className="settings-form-section">
          <header>
            <h2>Working rhythm</h2>
            <p>Your local time and a realistic weekly planning target.</p>
          </header>
          <div className="ws-form-grid">
            <label>
              Time zone
              <input
                required
                list="profile-timezones"
                aria-label="Time zone"
                value={draft.timezone}
                onChange={(event) => set("timezone", event.target.value)}
              />
              <datalist id="profile-timezones">
                {[
                  "UTC",
                  "Asia/Shanghai",
                  "Asia/Tokyo",
                  "Asia/Singapore",
                  "Europe/London",
                  "Europe/Paris",
                  "America/New_York",
                  "America/Chicago",
                  "America/Los_Angeles",
                  "Australia/Sydney",
                ].map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            </label>
            <label>
              Weekly planning capacity (hours)
              <input
                type="number"
                min={0}
                max={168}
                step="0.5"
                value={draft.weeklyCapacity}
                onChange={(event) =>
                  set("weeklyCapacity", Number(event.target.value))
                }
              />
            </label>
          </div>
        </section>
      </fieldset>
      <p className="ws-note">
        Your name, affiliation, biography, interests, links, and time zone are
        visible to people who share a group with you. Personal-space contents
        are not.
      </p>
      <ErrorNotice message={action.error} />
      {saved && (
        <p role="status">
          <Check size={15} />
          Profile saved.
        </p>
      )}
      <div className="settings-form-actions">
        <span>
          {dirty ? "Unsaved profile changes" : "Your profile is up to date"}
        </span>
        <button
          type="button"
          className="button secondary"
          disabled={!dirty || action.busy}
          onClick={() => {
            setDraft(base);
            setLinks(base.links.join("\n"));
            setSaved(false);
            action.setError("");
          }}
        >
          Cancel changes
        </button>
        <button
          className="button primary"
          disabled={action.busy || !dirty || normalizedLinks.length > 8}
        >
          {action.busy ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}
function SecuritySettings() {
  const { revision } = useWorkspace(),
    data = useData("me/security", revision),
    action = useAction(),
    [dialog, setDialog] = useState<
      "enable" | "disable" | "recovery" | "password" | null
    >(null),
    [password, setPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [setup, setSetup] = useState<{
      totpURI?: string;
      backupCodes: string[];
    } | null>(null),
    [code, setCode] = useState(""),
    [savedCodes, setSavedCodes] = useState(false),
    [message, setMessage] = useState("");
  const close = () => {
    if (action.busy) return;
    setDialog(null);
    setPassword("");
    setNewPassword("");
    setSetup(null);
    setCode("");
    setSavedCodes(false);
    action.setError("");
  };
  const security = data.data;
  return (
    <div className="ws-security">
      <ErrorNotice
        message={data.error || (!dialog ? action.error : "")}
        retry={data.error ? data.reload : undefined}
      />
      {data.loading && !security && <Loading />}
      {message && <p role="status">{message}</p>}
      {security && (
        <>
          <section className="ws-card">
            <div className="ws-setting-row">
              <span className="ws-resource-glyph">
                <ShieldCheck size={24} />
              </span>
              <div>
                <h2>Two-step verification</h2>
                <p>
                  Use an authenticator app to add a second check to password
                  sign-in. Institutional sign-in follows your institution’s own
                  multi-factor policy.
                </p>
              </div>
              <Badge tone={security.twoFactorEnabled ? "success" : "neutral"}>
                {security.twoFactorEnabled ? "Enabled" : "Not enabled"}
              </Badge>
            </div>
            <div className="ws-actions">
              <button
                className="button primary"
                onClick={() =>
                  setDialog(security.twoFactorEnabled ? "disable" : "enable")
                }
              >
                {security.twoFactorEnabled
                  ? "Disable verification"
                  : "Set up authenticator"}
              </button>
              {security.twoFactorEnabled && (
                <button
                  className="button secondary"
                  onClick={() => setDialog("recovery")}
                >
                  Replace recovery codes
                </button>
              )}
            </div>
          </section>
          <section className="ws-card">
            <div className="ws-setting-row">
              <span className="ws-resource-glyph">
                <KeyRound size={24} />
              </span>
              <div>
                <h2>Password</h2>
                <p>Choose a unique password of at least 12 characters.</p>
              </div>
              <button
                className="button secondary"
                onClick={() => setDialog("password")}
              >
                Change password
              </button>
            </div>
          </section>
          <section className="ws-card">
            <h2>Institutional identity</h2>
            <p className="muted">
              An institutional login does not automatically admit anyone to a
              group. Existing members link their verified account explicitly.
            </p>
            {security.institution.enabled ? (
              <div className="ws-setting-row">
                <div>
                  <strong>{security.institution.name}</strong>
                  <p>
                    {security.accounts.some(
                      (account: any) => account.provider_id === "institution",
                    )
                      ? "Your institutional account is linked."
                      : "Sign in through your institution to link this account. Email addresses must match."}
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      if (
                        security.accounts.some(
                          (account: any) =>
                            account.provider_id === "institution",
                        )
                      ) {
                        await authRequest("unlink-account", {
                          providerId: "institution",
                        });
                        data.reload();
                      } else {
                        const result = await authRequest("link-social", {
                          provider: "institution",
                          callbackURL:
                            location.origin + "/workbench/settings/security",
                        });
                        if (!result.url)
                          throw new Error(
                            "The identity provider did not return a sign-in URL.",
                          );
                        location.assign(result.url);
                      }
                    })
                  }
                >
                  {security.accounts.some(
                    (account: any) => account.provider_id === "institution",
                  )
                    ? "Unlink institution"
                    : "Link institution"}
                </button>
              </div>
            ) : (
              <p className="ws-note">
                Not configured. A deployment administrator must provide your
                institution’s OIDC discovery URL and application credentials.
                Password login remains available.
              </p>
            )}
          </section>
          <section className="ws-card">
            <div className="ws-section-heading">
              <h2>Signed-in devices</h2>
              <button
                className="button secondary"
                disabled={action.busy || security.sessions.length < 2}
                onClick={() =>
                  void action.run(async () => {
                    await post("me/sessions", { others: true });
                    data.reload();
                    setMessage(
                      "Other online sessions have been revoked. Offline copies on other devices cannot be remotely erased.",
                    );
                  })
                }
              >
                Sign out other devices
              </button>
            </div>
            {security.sessions.map((session: any) => (
              <div className="ws-session" key={session.id}>
                <Monitor size={20} />
                <div>
                  <strong>
                    {session.current ? "This device" : "Another device"}
                  </strong>
                  <p>
                    {session.user_agent || "Device information unavailable"}
                  </p>
                  <small>
                    Last active {timeAgo(session.updated_at)} · Expires{" "}
                    {new Date(session.expires_at).toLocaleDateString()}
                  </small>
                </div>
                {session.current ? (
                  <Badge>Current</Badge>
                ) : (
                  <button
                    className="button secondary"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await post("me/sessions", { id: session.id });
                        data.reload();
                      })
                    }
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
            <p className="ws-small muted">
              Revocation ends online access and live collaboration. It cannot
              recall files already downloaded or trusted-device offline copies.
            </p>
          </section>
        </>
      )}
      {dialog && (
        <Dialog
          title={
            dialog === "password"
              ? "Change password"
              : dialog === "enable"
                ? "Set up two-step verification"
                : dialog === "disable"
                  ? "Disable two-step verification?"
                  : "Replace your recovery codes"
          }
          onClose={close}
        >
          {!setup ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action.run(async () => {
                  if (dialog === "enable")
                    setSetup(
                      await authRequest("two-factor/enable", { password }),
                    );
                  else if (dialog === "recovery")
                    setSetup(
                      await authRequest("two-factor/generate-backup-codes", {
                        password,
                      }),
                    );
                  else if (dialog === "disable") {
                    await authRequest("two-factor/disable", { password });
                    setMessage("Two-step verification disabled.");
                    setDialog(null);
                    setPassword("");
                    data.reload();
                  } else {
                    await authRequest("change-password", {
                      currentPassword: password,
                      newPassword,
                      revokeOtherSessions: true,
                    });
                    setMessage(
                      "Password changed. Other sessions were revoked.",
                    );
                    setDialog(null);
                    setPassword("");
                    setNewPassword("");
                    data.reload();
                  }
                });
              }}
            >
              <p className="muted">
                {dialog === "recovery"
                  ? "Your previous recovery codes stop working when new codes are generated. Store the replacement codes somewhere safe."
                  : "Confirm your current password to continue."}
              </p>
              <label>
                Current password
                <input
                  autoFocus
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {dialog === "password" && (
                <label>
                  New password
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                </label>
              )}
              <ErrorNotice message={action.error} />
              <div className="dialog-footer">
                <button
                  type="button"
                  className="button secondary"
                  onClick={close}
                  disabled={action.busy}
                >
                  Cancel
                </button>
                <button className="button primary" disabled={action.busy}>
                  Continue
                </button>
              </div>
            </form>
          ) : (
            <div className="ws-mfa-setup">
              {setup.totpURI && (
                <>
                  <p>
                    Add Axiom to your authenticator using this setup key. This
                    secret is shown only here; never share it.
                  </p>
                  <label>
                    Authenticator setup key
                    <input
                      readOnly
                      value={
                        new URL(setup.totpURI).searchParams.get("secret") ?? ""
                      }
                      autoComplete="off"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                  <p className="ws-small muted">
                    Time-based code · SHA-1 · 6 digits · 30 seconds
                  </p>
                </>
              )}
              <h3>Recovery codes</h3>
              <p>
                Each code works once if you lose access to your authenticator.
                Store them outside this browser.
              </p>
              <div className="ws-recovery-codes">
                {setup.backupCodes.map((value) => (
                  <code key={value}>{value}</code>
                ))}
              </div>
              <button
                className="button secondary"
                onClick={() =>
                  download(
                    "axiom-recovery-codes.txt",
                    "Axiom recovery codes — keep private\n\n" +
                      setup.backupCodes.join("\n"),
                    "text/plain",
                  )
                }
              >
                <Download size={15} />
                Download codes
              </button>
              <label className="ws-checkbox">
                <input
                  type="checkbox"
                  checked={savedCodes}
                  onChange={(event) => setSavedCodes(event.target.checked)}
                />
                I stored these codes in a safe place.
              </label>
              <ErrorNotice message={action.error} />
              {setup.totpURI ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action.run(async () => {
                      await authRequest("two-factor/verify-totp", { code });
                      setSetup(null);
                      setDialog(null);
                      setPassword("");
                      setCode("");
                      data.reload();
                      setMessage("Two-step verification is enabled.");
                    });
                  }}
                >
                  <label>
                    Six-digit authenticator code
                    <input
                      required
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(event) =>
                        setCode(event.target.value.replace(/\D/g, ""))
                      }
                    />
                  </label>
                  <div className="dialog-footer">
                    <button
                      className="button primary"
                      disabled={action.busy || !savedCodes}
                    >
                      Verify and enable
                    </button>
                  </div>
                </form>
              ) : (
                <div className="dialog-footer">
                  <button
                    className="button primary"
                    disabled={!savedCodes}
                    onClick={close}
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
function NotificationSettings() {
  const { revision, session } = useWorkspace(),
    result = useData("me/notification-settings", revision);
  return (
    <>
      <ErrorNotice message={result.error} retry={result.reload} />
      {result.data ? (
        <NotificationForm
          initial={result.data}
          emailAvailable={session.emailAvailable}
        />
      ) : (
        result.loading && <Loading />
      )}
    </>
  );
}
function NotificationForm({
  initial,
  emailAvailable,
}: {
  initial: any;
  emailAvailable: boolean;
}) {
  const [draft, setDraft] = useState(initial),
    [base, setBase] = useState(initial),
    [message, setMessage] = useState(""),
    action = useAction(),
    labels: Record<string, [string, string]> = {
      assignments: ["Assignments", "A task is assigned to you."],
      mentions: ["Mentions", "A collaborator explicitly mentions you."],
      reviews: ["Reviews", "A review is requested or someone responds."],
      reminders: [
        "Due-date reminders",
        "An open assigned task is due today in its project’s time zone.",
      ],
      discussions: [
        "Discussion updates",
        "Relevant updates to research conversations.",
      ],
      email: [
        "Email delivery",
        "Also send enabled notifications by email when mail delivery is configured.",
      ],
    };
  const dirty =
    JSON.stringify(draft.preferences) !== JSON.stringify(base.preferences);
  useRetainedForm("notifications", dirty, () => {
    setDraft(base);
    setMessage("");
    action.setError("");
  });
  const control = (key: string) => (
    <label className="ws-setting-row ws-toggle-row" key={key}>
      <span>
        <strong>{labels[key][0]}</strong>
        <small>{labels[key][1]}</small>
      </span>
      <input
        aria-label={labels[key][0]}
        type="checkbox"
        checked={draft.preferences[key]}
        onChange={(event) => {
          setDraft({
            ...draft,
            preferences: { ...draft.preferences, [key]: event.target.checked },
          });
          setMessage("");
        }}
      />
    </label>
  );
  return (
    <form
      className="ws-settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!dirty || action.busy) return;
        void action.run(async () => {
          const saved = await mutate(
            "me/notification-settings",
            draft,
            "PATCH",
          );
          setDraft(saved);
          setBase(saved);
          setMessage("Notification preferences saved.");
        });
      }}
    >
      <fieldset className="settings-form-fields" disabled={action.busy}>
        <section className="settings-form-section">
          <header>
            <h2>In your inbox</h2>
            <p>Choose the research updates that deserve your attention.</p>
          </header>
          {[
            "assignments",
            "mentions",
            "reviews",
            "reminders",
            "discussions",
          ].map(control)}
        </section>
        <section className="settings-form-section">
          <header>
            <h2>Delivery</h2>
            <p>
              Your inbox stays available whether or not email is configured.
            </p>
          </header>
          {control("email")}
          {!emailAvailable && (
            <p className="ws-note">
              Email delivery is not configured on this server. Your in-app inbox
              still works.
            </p>
          )}
        </section>
      </fieldset>
      <ErrorNotice message={action.error} />
      {message && <p role="status">{message}</p>}
      <div className="settings-form-actions">
        <span>
          {dirty
            ? "Unsaved notification changes"
            : "Notification preferences are up to date"}
        </span>
        <button
          type="button"
          className="button secondary"
          disabled={!dirty || action.busy}
          onClick={() => {
            setDraft(base);
            setMessage("");
            action.setError("");
          }}
        >
          Cancel changes
        </button>
        <button className="button primary" disabled={action.busy || !dirty}>
          {action.busy ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </form>
  );
}
export function StorageSettings({ scopeId }: { scopeId?: string } = {}) {
  const { spaces, revision, navigate, open, refresh } = useWorkspace(),
    { params } = useLocation(),
    spaceId = scopeId ?? params.get("space") ?? spaces[0]?.id,
    data = useData(spaceId ? `storage/${spaceId}` : null, revision),
    [quotaDialog, setQuotaDialog] = useState(false),
    [quota, setQuota] = useState(""),
    baseQuota = useRef<number | null>(null),
    action = useAction(),
    storage = data.data;
  return (
    <>
      <div className="ws-list-toolbar">
        {!scopeId && (
          <label>
            Space
            <select
              value={spaceId ?? ""}
              onChange={(event) =>
                navigate(`/settings/storage?space=${event.target.value}`)
              }
            >
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {storage?.space.can_manage && storage.space.kind !== "project" && (
          <button
            className="button secondary"
            disabled={storage.space.effective_status !== "active"}
            title={
              storage.space.effective_status !== "active"
                ? "Restore or unarchive this workspace before changing its storage limit."
                : undefined
            }
            onClick={() => {
              baseQuota.current =
                storage.quotaBytes === null ? null : Number(storage.quotaBytes);
              setQuota(
                storage.quotaBytes == null
                  ? ""
                  : String(Number(storage.quotaBytes) / 1e9),
              );
              setQuotaDialog(true);
            }}
          >
            Set storage limit
          </button>
        )}
      </div>
      <ErrorNotice
        message={data.error || action.error}
        retry={data.error ? data.reload : undefined}
      />
      {data.loading && !storage ? (
        <Loading />
      ) : (
        storage && (
          <>
            <div className="ws-storage-overview">
              <div>
                <HardDrive size={24} />
                <h2>
                  {bytes(storage.totals.bytes)}{" "}
                  <small>stored in this space</small>
                </h2>
                <p>
                  {storage.quotaBytes === null
                    ? "No administrative quota"
                    : `${bytes(storage.quotaBytes)} ${storage.space.kind === "personal" ? "personal" : "shared group"} quota`}
                </p>
                <p className="ws-small muted">
                  Project and team libraries share their group quota. Space
                  totals below cover only the selected space.
                </p>
              </div>
              <dl className="ws-facts">
                <div>
                  <dt>Current files</dt>
                  <dd>{bytes(storage.totals.originals)}</dd>
                </div>
                <div>
                  <dt>Previous versions</dt>
                  <dd>{bytes(storage.totals.versions)}</dd>
                </div>
                <div>
                  <dt>In trash</dt>
                  <dd>{bytes(storage.totals.trash)}</dd>
                </div>
                <div>
                  <dt>Uploads reserved</dt>
                  <dd>{bytes(storage.reserved)}</dd>
                </div>
              </dl>
            </div>
            <p className="ws-note">
              Completed files and versions are retained until explicit manual
              cleanup. Existing pinned links remain tied to their immutable
              version. Maximum upload: 1 GB per file.
            </p>
            <div className="ws-section-heading">
              <h2>Largest current files</h2>
              <WorkspaceLink to={`/trash?space=${spaceId}`}>
                <Trash2 size={14} />
                Review trash
              </WorkspaceLink>
            </div>
            {storage.files.length ? (
              <div className="ws-storage-files">
                {storage.files.map((file: any) => (
                  <button
                    key={file.id}
                    onClick={() => open({ kind: "file", id: file.id })}
                  >
                    <span>
                      <strong>{file.name}</strong>
                      <small>
                        {file.versions} versions
                        {file.deleted_at ? " · In trash" : ""}
                      </small>
                    </span>
                    <span>{bytes(file.bytes)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <Empty
                icon={HardDrive}
                title={
                  !storage.space.role
                    ? "File contents are private"
                    : "No stored files"
                }
              >
                {!storage.space.role
                  ? "Your management role includes storage totals, but not access to this project's files. Ask a project lead for content access."
                  : storage.space.effective_status !== "active"
                    ? "Restore or unarchive this workspace to add files. Existing recovery items remain available in Trash."
                    : "Upload papers, figures, datasets, and supplementary materials in Explorer."}
              </Empty>
            )}
          </>
        )
      )}
      {quotaDialog && (
        <Dialog
          title="Storage limit"
          subtitle="A limit prevents new uploads. It never deletes existing files."
          onClose={() => !action.busy && setQuotaDialog(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                await mutate(
                  `storage/${spaceId}`,
                  {
                    expectedQuotaBytes: baseQuota.current,
                    quotaBytes:
                      quota === "" ? null : Math.round(Number(quota) * 1e9),
                  },
                  "PATCH",
                );
                setQuotaDialog(false);
                refresh();
              });
            }}
          >
            <label>
              Limit in GB (leave blank for no quota)
              <input
                type="number"
                min={0}
                step="0.1"
                value={quota}
                onChange={(event) => setQuota(event.target.value)}
              />
            </label>
            <ErrorNotice message={action.error} />
            <div className="dialog-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setQuotaDialog(false)}
                disabled={action.busy}
              >
                Cancel
              </button>
              <button className="button primary" disabled={action.busy}>
                Save limit
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

export { default as GroupAdminPage } from "./GroupAdministration";
