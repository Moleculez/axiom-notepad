"use client";
import { currentLocale } from "@axiom/i18n/client";
import type { MessageId } from "@axiom/i18n";
import { I18nText, uiText, useInterfaceLocale } from "@axiom/i18n/react";

import {
  ActionRow,
  Button,
  Checkbox,
  HelpText,
  Switch,
  TextInput,
  NativeSelect,
  TextArea,
  SearchField,
} from "../ui/controls";
import TimeZoneInput from "../TimeZoneInput";
import LanguageSettings from "./LanguageSettings";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
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
  Puzzle,
} from "lucide-react";
import { api, authRequest, download, post, timeAgo } from "../../lib/client";
import { ExportsPage } from "./AccountPages";
import GroupsHub from "./GroupsHub";
import { useResearch } from "../../lib/research-store";
import ResearchDataSettings from "../ResearchDataSettings";
import ConnectionsSettings from "./ConnectionsSettings";
import ExtensionsSettings from "../plugins/ExtensionsSettings";
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
  type SettingsCategory,
} from "../../lib/settings-registry";
import { Avatar } from "./Pages";
const AvatarCropDialog = dynamic(() => import("./AvatarCropDialog"), {
  ssr: false,
});
const AppearanceSettings = dynamic(() => import("../AppearanceSettings"), {
  ssr: false,
  loading: () => (
    <div className="settings-stage" aria-busy="true">
      <p role="status">
        <I18nText id="Loading appearance & writing…" />
      </p>
    </div>
  ),
});

import {
  SettingsForms,
  useRetainedSettingsForm as useRetainedForm,
  type RetainedSettingsForm as RetainedForm,
} from "../../lib/settings-forms";
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
  useInterfaceLocale();
  const { parts, params } = useLocation();
  const selected = settingsCategory(parts[1], params.get("section"));
  const [search, setSearch] = useState("");
  const icons: Record<SettingsCategory, typeof Monitor> = {
    language: Type,
    extensions: Puzzle,
    connections: ShieldCheck,
    profile: UserRound,
    security: ShieldCheck,
    notifications: Bell,
    groups: Users,
    "appearance-general": SlidersHorizontal,
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
    `${uiText(category.label)} ${uiText(category.description)} ${category.label} ${category.description} ${appearanceSettingGroups[appearanceSections[category.id]]?.join(" ") ?? ""} ${writingControls
      .filter((c) => c.category === appearanceSections[category.id])
      .map((c) => `${c.label} ${c.hint}`)
      .join(" ")}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <nav
      className="settings-center-nav settings-page-navigation"
      aria-label={uiText("Settings categories")}
    >
      <SearchField
        wrapperClassName="settings-search"
        aria-label={uiText("Find settings category")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={uiText("Find a setting…")}
        onClear={() => setSearch("")}
        clearLabel={uiText("Clear category search")}
      />
      {!matches.length && (
        <p className="settings-nav-empty" role="status">
          <I18nText id="No matching categories. Try “font”, “code”, or “storage”." />
        </p>
      )}
      {["Account", "Appearance", "Writing", "Storage", "Extensions"].map(
        (group) => {
          const entries = matches.filter(
            (category) => category.group === group,
          );
          return entries.length ? (
            <section key={group}>
              <h3>{uiText(group)}</h3>
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
                    {uiText(category.label)}
                  </WorkspaceLink>
                );
              })}
            </section>
          ) : null;
        },
      )}
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
  useInterfaceLocale();
  const { appearance, editorSettings, navigate, session, spaces, open } =
      useWorkspace(),
    { params, path } = useLocation();
  const section = settingsCategory(inputSection, params.get("section"));
  const preference = preferenceCategory(section);
  const draft = useSettingsDraft(appearance, editorSettings, active);
  const forms = useRef(new Map<string, RetainedForm>()),
    visitedForms = useRef(new Set<string>());
  if (
    active &&
    ["profile", "notifications", "extensions", "language"].includes(section)
  )
    visitedForms.current.add(section);
  const formsDirty = () =>
    [...forms.current.values()].some((form) => form.dirty);
  const draftRef = useRef(draft);
  const activeRef = useRef(active);
  draftRef.current = draft;
  activeRef.current = active;
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
      if (!activeRef.current || event.defaultPrevented) return;
      if (
        event.type === "axiom:before-navigate" &&
        navigation.detail.destination.startsWith(BASE + "/settings")
      )
        return;
      if (!draftRef.current.dirty && !formsDirty()) return;
      event.preventDefault();
      setLeaving({ proceed: navigation.detail.proceed });
      if (event.type === "axiom:close-settings")
        queueMicrotask(() => go(currentPath.current, false, true));
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (draftRef.current.dirty || formsDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("axiom:close-settings", before);
    window.addEventListener("axiom:before-navigate", before);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("axiom:close-settings", before);
      window.removeEventListener("axiom:before-navigate", before);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  const [dataContext, setDataContext] = useState(""),
    openAction = useAction();
  const context =
      dataContext ||
      (spaces.find((space) => space.kind === "personal")?.id ??
        spaces.find((space) => space.role)?.id ??
        ""),
    research = useResearch(
      active && section === "data" ? session.user.id : undefined,
      context,
    );
  const labels: Readonly<Record<string, MessageId>> = {
    language: "Language",
    profile: "Your researcher profile",
    appearance: "Make Axiom your own",
    security: "Account security",
    notifications: "A quieter inbox",
    storage: "Storage & file versions",
    data: "Your offline research",
    connections: "Connected applications",
    groups: "Your research groups",
    exports: "Portable exports",
    extensions: "Extensions",
  };
  return (
    <SettingsForms.Provider value={forms.current}>
      <main
        hidden={!active}
        style={!active ? { display: "none" } : undefined}
        className={`ws-page ws-settings-page ${preference ? "ws-appearance-page" : ""} ${section === "extensions" ? "ws-extensions-page" : ""}`}
        data-settings-section={section}
      >
        <div className="settings-center-heading">
          <button
            data-dialog-cancel
            className="text-button"
            onClick={() => go(returnPath.current)}
          >
            <ArrowLeft size={16} />
            <I18nText id="Back to workspace" />
          </button>
          <span>
            <I18nText
              id="Settings · {group}"
              values={{
                group: uiText(
                  settingsCategories.find((category) => category.id === section)
                    ?.group ?? "",
                ),
              }}
            />
          </span>
        </div>
        {!preference && (
          <PageHeading title={uiText(labels[section] ?? "Settings")}>
            {uiText(
              settingsCategories.find((category) => category.id === section)
                ?.description ?? "",
            )}
          </PageHeading>
        )}
        {!preference && draft.dirty && (
          <section
            className="settings-pending-preferences"
            aria-label={uiText("Pending appearance and writing changes")}
          >
            <span>
              <I18nText id="Appearance & writing changes are still in preview." />
            </span>
            <ActionRow>
              <Button
                className="button secondary small"
                onClick={draft.discard}
              >
                <I18nText id="Discard preference changes" />
              </Button>
              <Button className="button primary small" onClick={draft.apply}>
                <I18nText id="Apply preferences" />
              </Button>
            </ActionRow>
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
        ) : section === "extensions" ? null : section === "connections" ? (
          <ConnectionsSettings />
        ) : section === "profile" || section === "language" ? null : section ===
          "security" ? (
          <SecuritySettings />
        ) : section === "notifications" ? null : section === "storage" ? (
          <StorageSettings />
        ) : section === "groups" ? (
          <GroupsHub embedded />
        ) : section === "exports" ? (
          <ExportsPage />
        ) : section === "data" ? (
          <>
            <InstallControls />
            <OfflineSettings />
            <label>
              <I18nText id="Reading workspace" />
              <NativeSelect
                aria-label={uiText("Reading workspace")}
                value={context}
                onChange={(event) => setDataContext(event.target.value)}
              >
                {spaces
                  .filter((space) => space.role)
                  .map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                      {space.group_name
                        ? ` · ${space.group_name}`
                        : uiText(" · Personal")}
                    </option>
                  ))}
              </NativeSelect>
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
          <Empty title={uiText("Choose a setting")}>
            <I18nText id="Use the account navigation to find what you need." />
          </Empty>
        )}
        {visitedForms.current.has("profile") && (
          <div hidden={section !== "profile"}>
            <ProfileSettings />
          </div>
        )}
        {visitedForms.current.has("language") && (
          <div hidden={section !== "language"}>
            <LanguageSettings />
          </div>
        )}
        {visitedForms.current.has("notifications") && (
          <div hidden={section !== "notifications"}>
            <NotificationSettings />
          </div>
        )}
        {visitedForms.current.has("extensions") && (
          <div
            className="settings-retained-extension"
            hidden={section !== "extensions"}
          >
            <ExtensionsSettings />
          </div>
        )}
        {active && leaving && (
          <Dialog
            title={
              formsDirty()
                ? uiText("Keep your unsaved settings?")
                : uiText("Apply your preference changes?")
            }
            subtitle={
              formsDirty()
                ? uiText(
                    "Some settings forms are unsaved. Stay to save them, or discard all changes before leaving settings.",
                  )
                : uiText(
                    "Your appearance and writing preferences are in live preview. Choose what to keep before leaving.",
                  )
            }
            onClose={() => setLeaving(null)}
            size="compact"
          >
            <div className="button-row">
              <Button
                className="button secondary"
                onClick={() => setLeaving(null)}
              >
                <I18nText id="Stay in settings" />
              </Button>
              <Button
                className="button secondary"
                onClick={() => {
                  draft.discard();
                  for (const form of forms.current.values()) form.discard();
                  setLeaving(null);
                  leaving.proceed();
                }}
              >
                <I18nText id="Discard changes" />
              </Button>
              <Button
                className="button primary"
                disabled={formsDirty()}
                onClick={() => {
                  if (draft.apply()) leaving.proceed();
                  else setLeaving(null);
                }}
              >
                <I18nText id="Apply and leave" />
              </Button>
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
  useInterfaceLocale();
  const [draft, setDraft] = useState(profile),
    [base, setBase] = useState(profile),
    [links, setLinks] = useState(profile.links.join("\n")),
    [saved, setSaved] = useState(false),
    [avatarFile, setAvatarFile] = useState<File | null>(null),
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
    <>
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
              <h2>
                <I18nText id="Identity" />
              </h2>
              <p>
                <I18nText id="How your collaborators see you in Axiom." />
              </p>
            </header>
            <div className="ws-profile-photo">
              <Avatar person={draft} />
              <div>
                <Button
                  type="button"
                  className="button secondary"
                  disabled={action.busy}
                  onClick={() => avatar.current?.click()}
                >
                  <Upload size={16} />
                  <I18nText id="Change photo" />
                </Button>
                <p className="ws-small muted">
                  <I18nText id="PNG, JPEG, GIF or WebP, up to 5 MB. Images are resized and metadata is removed. Crop and preview before saving your photo." />
                </p>
              </div>
              <input
                ref={avatar}
                type="file"
                aria-label={uiText("Upload profile picture")}
                hidden
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setAvatarFile(file);
                  event.target.value = "";
                }}
              />
            </div>
            <div className="ws-form-grid">
              <label>
                <I18nText id="Full name" />
                <TextInput
                  required
                  maxLength={100}
                  value={draft.name}
                  onChange={(event) => set("name", event.target.value)}
                />
              </label>
              <label>
                <I18nText id="Email address" />
                <TextInput value={draft.email} readOnly autoComplete="email" />
                <small>
                  <I18nText id="Contact your administrator for account identity changes." />
                </small>
              </label>
            </div>
            <label>
              <I18nText id="Institution or affiliation" />
              <TextInput
                maxLength={200}
                value={draft.affiliation}
                onChange={(event) => set("affiliation", event.target.value)}
                placeholder={uiText("Your lab, university, or research group")}
              />
            </label>
          </section>
          <section className="settings-form-section">
            <header>
              <h2>
                <I18nText id="Research profile" />
              </h2>
              <p>
                <I18nText id="Share your interests, background, and published work." />
              </p>
            </header>
            <label>
              <I18nText id="Research interests" />
              <TextInput
                maxLength={500}
                value={draft.interests}
                onChange={(event) => set("interests", event.target.value)}
                placeholder={uiText(
                  "e.g. Scientific ML, dynamical systems, quantum information",
                )}
              />
            </label>
            <label>
              <I18nText id="Biography" />
              <TextArea
                aria-label={uiText("Biography")}
                maxLength={3000}
                rows={5}
                value={draft.biography}
                onChange={(event) => set("biography", event.target.value)}
              />
              <span className="settings-field-note">
                <span>
                  <I18nText id="A short introduction for your group." />
                </span>
                <span>
                  <I18nText
                    id="{used, number} / {limit, number} characters"
                    values={{ used: draft.biography.length, limit: 3000 }}
                  />
                </span>
              </span>
            </label>
            <label>
              <I18nText id="Research links (one per line, up to eight)" />
              <TextArea
                aria-label={uiText(
                  "Research links (one per line, up to eight)",
                )}
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
                <span>
                  <I18nText id="ORCID, publications, or your lab website." />
                </span>
                <span>
                  <I18nText
                    id="{used, number} / {limit, number} links"
                    values={{ used: normalizedLinks.length, limit: 8 }}
                  />
                </span>
              </span>
              {normalizedLinks.length > 8 && (
                <small className="form-error" role="alert">
                  <I18nText id="Keep up to eight research links before saving." />
                </small>
              )}
            </label>
          </section>
          <section className="settings-form-section">
            <header>
              <h2>
                <I18nText id="Working rhythm" />
              </h2>
              <p>
                <I18nText id="Your local time and a realistic weekly planning target." />
              </p>
            </header>
            <div className="ws-form-grid">
              <label>
                <I18nText id="Time zone" />
                <TimeZoneInput
                  required
                  aria-label={uiText("Time zone")}
                  value={draft.timezone}
                  onChange={(zone) => set("timezone", zone)}
                />
              </label>
              <label>
                <I18nText id="Weekly planning capacity (hours)" />
                <TextInput
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
        <HelpText>
          <I18nText id="Your name, affiliation, biography, interests, links, and time zone are visible to people who share a group with you. Personal-space contents are not." />
        </HelpText>
        <ErrorNotice message={action.error} />
        {saved && (
          <p role="status">
            <Check size={15} />
            <I18nText id="Profile saved." />
          </p>
        )}
        <div className="settings-form-actions">
          <span>
            {dirty
              ? uiText("Unsaved profile changes")
              : uiText("Your profile is up to date")}
          </span>
          <Button
            data-dialog-cancel
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
            <I18nText id="Cancel changes" />
          </Button>
          <Button
            className="button primary"
            disabled={action.busy || !dirty || normalizedLinks.length > 8}
            pending={!!action.busy}
          >
            {uiText("Save profile")}
          </Button>
        </div>
      </form>
      {avatarFile && (
        <AvatarCropDialog
          file={avatarFile}
          version={draft.version}
          onClose={() => setAvatarFile(null)}
          onSaved={(data) => {
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
            setAvatarFile(null);
            setSaved(false);
            onSaved();
          }}
        />
      )}
    </>
  );
}
function SecuritySettings() {
  useInterfaceLocale();
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
                <h2>
                  <I18nText id="Two-step verification" />
                </h2>
                <p>
                  <I18nText id="Use an authenticator app to add a second check to password sign-in. Institutional sign-in follows your institution’s own multi-factor policy." />
                </p>
              </div>
              <Badge tone={security.twoFactorEnabled ? "success" : "neutral"}>
                {security.twoFactorEnabled
                  ? uiText("Enabled")
                  : uiText("Not enabled")}
              </Badge>
            </div>
            <ActionRow>
              <Button
                className="button primary"
                onClick={() =>
                  setDialog(security.twoFactorEnabled ? "disable" : "enable")
                }
              >
                {security.twoFactorEnabled
                  ? uiText("Disable verification")
                  : uiText("Set up authenticator")}
              </Button>
              {security.twoFactorEnabled && (
                <Button
                  className="button secondary"
                  onClick={() => setDialog("recovery")}
                >
                  <I18nText id="Replace recovery codes" />
                </Button>
              )}
            </ActionRow>
          </section>
          <section className="ws-card">
            <div className="ws-setting-row">
              <span className="ws-resource-glyph">
                <KeyRound size={24} />
              </span>
              <div>
                <h2>
                  <I18nText id="Password" />
                </h2>
                <p>
                  <I18nText id="Choose a unique password of at least 12 characters." />
                </p>
              </div>
              <Button
                className="button secondary"
                onClick={() => setDialog("password")}
              >
                <I18nText id="Change password" />
              </Button>
            </div>
          </section>
          <section className="ws-card">
            <h2>
              <I18nText id="Institutional identity" />
            </h2>
            <p className="muted">
              <I18nText id="An institutional login does not automatically admit anyone to a group. Existing members link their verified account explicitly." />
            </p>
            {security.institution.enabled ? (
              <div className="ws-setting-row">
                <div>
                  <strong>{security.institution.name}</strong>
                  <p>
                    {security.accounts.some(
                      (account: any) => account.provider_id === "institution",
                    )
                      ? uiText("Your institutional account is linked.")
                      : uiText(
                          "Sign in through your institution to link this account. Email addresses must match.",
                        )}
                  </p>
                </div>
                <Button
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
                    ? uiText("Unlink institution")
                    : uiText("Link institution")}
                </Button>
              </div>
            ) : (
              <HelpText>
                <I18nText id="Not configured. A deployment administrator must provide your institution’s OIDC discovery URL and application credentials. Password login remains available." />
              </HelpText>
            )}
          </section>
          <section className="ws-card">
            <div className="ws-section-heading">
              <h2>
                <I18nText id="Signed-in devices" />
              </h2>
              <Button
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
                <I18nText id="Sign out other devices" />
              </Button>
            </div>
            {security.sessions.map((session: any) => (
              <div className="ws-session" key={session.id}>
                <Monitor size={20} />
                <div>
                  <strong>
                    {session.current
                      ? uiText("This device")
                      : uiText("Another device")}
                  </strong>
                  <p>
                    {session.user_agent || "Device information unavailable"}
                  </p>
                  <small>
                    <I18nText id="Last active" /> {timeAgo(session.updated_at)}{" "}
                    <I18nText id="· Expires" />{" "}
                    {new Date(session.expires_at).toLocaleDateString(
                      currentLocale(),
                    )}
                  </small>
                </div>
                {session.current ? (
                  <Badge>
                    <I18nText id="Current" />
                  </Badge>
                ) : (
                  <Button
                    className="button secondary"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        await post("me/sessions", { id: session.id });
                        data.reload();
                      })
                    }
                  >
                    <I18nText id="Revoke" />
                  </Button>
                )}
              </div>
            ))}
            <p className="ws-small muted">
              <I18nText id="Revocation ends online access and live collaboration. It cannot recall files already downloaded or trusted-device offline copies." />
            </p>
          </section>
        </>
      )}
      {dialog && (
        <Dialog
          title={
            dialog === "password"
              ? uiText("Change password")
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
                  ? uiText(
                      "Your previous recovery codes stop working when new codes are generated. Store the replacement codes somewhere safe.",
                    )
                  : uiText("Confirm your current password to continue.")}
              </p>
              <label>
                <I18nText id="Current password" />
                <TextInput
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
                  <I18nText id="New password" />
                  <TextInput
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
                <Button
                  data-dialog-cancel
                  type="button"
                  className="button secondary"
                  onClick={close}
                  disabled={action.busy}
                >
                  <I18nText id="Cancel" />
                </Button>
                <Button className="button primary" disabled={action.busy}>
                  <I18nText id="Continue" />
                </Button>
              </div>
            </form>
          ) : (
            <div className="ws-mfa-setup">
              {setup.totpURI && (
                <>
                  <p>
                    <I18nText id="Add Axiom to your authenticator using this setup key. This secret is shown only here; never share it." />
                  </p>
                  <label>
                    <I18nText id="Authenticator setup key" />
                    <TextInput
                      readOnly
                      value={
                        new URL(setup.totpURI).searchParams.get("secret") ?? ""
                      }
                      autoComplete="off"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                  <p className="ws-small muted">
                    <I18nText id="Time-based code · SHA-1 · 6 digits · 30 seconds" />
                  </p>
                </>
              )}
              <h3>
                <I18nText id="Recovery codes" />
              </h3>
              <p>
                <I18nText id="Each code works once if you lose access to your authenticator. Store them outside this browser." />
              </p>
              <div className="ws-recovery-codes">
                {setup.backupCodes.map((value) => (
                  <code key={value}>{value}</code>
                ))}
              </div>
              <Button
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
                <I18nText id="Download codes" />
              </Button>
              <label className="ws-checkbox">
                <Checkbox
                  checked={savedCodes}
                  onChange={(event) => setSavedCodes(event.target.checked)}
                />
                <I18nText id="I stored these codes in a safe place." />
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
                    <I18nText id="Six-digit authenticator code" />
                    <TextInput
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
                    <Button
                      className="button primary"
                      disabled={action.busy || !savedCodes}
                    >
                      <I18nText id="Verify and enable" />
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="dialog-footer">
                  <Button
                    className="button primary"
                    disabled={!savedCodes}
                    onClick={close}
                  >
                    <I18nText id="Done" />
                  </Button>
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
  useInterfaceLocale();
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
      <Switch
        aria-label={labels[key][0]}

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
            <h2>
              <I18nText id="In your inbox" />
            </h2>
            <p>
              <I18nText id="Choose the research updates that deserve your attention." />
            </p>
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
            <h2>
              <I18nText id="Delivery" />
            </h2>
            <p>
              <I18nText id="Your inbox stays available whether or not email is configured." />
            </p>
          </header>
          {control("email")}
          {!emailAvailable && (
            <HelpText>
              <I18nText id="Email delivery is not configured on this server. Your in-app inbox still works." />
            </HelpText>
          )}
        </section>
      </fieldset>
      <ErrorNotice message={action.error} />
      {message && <p role="status">{message}</p>}
      <div className="settings-form-actions">
        <span>
          {dirty
            ? uiText("Unsaved notification changes")
            : uiText("Notification preferences are up to date")}
        </span>
        <Button
          data-dialog-cancel
          type="button"
          className="button secondary"
          disabled={!dirty || action.busy}
          onClick={() => {
            setDraft(base);
            setMessage("");
            action.setError("");
          }}
        >
          <I18nText id="Cancel changes" />
        </Button>
        <Button
          className="button primary"
          disabled={action.busy || !dirty}
          pending={!!action.busy}
        >
          {uiText("Save preferences")}
        </Button>
      </div>
    </form>
  );
}
export function StorageSettings({ scopeId }: { scopeId?: string } = {}) {
  useInterfaceLocale();
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
            <I18nText id="Space" />
            <NativeSelect
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
            </NativeSelect>
          </label>
        )}
        {storage?.space.can_manage && storage.space.kind !== "project" && (
          <Button
            className="button secondary"
            disabled={storage.space.effective_status !== "active"}
            title={
              storage.space.effective_status !== "active"
                ? uiText(
                    "Restore or unarchive this workspace before changing its storage limit.",
                  )
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
            <I18nText id="Set storage limit" />
          </Button>
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
                  <small>
                    <I18nText id="stored in this space" />
                  </small>
                </h2>
                <p>
                  {storage.quotaBytes === null
                    ? uiText("No administrative quota")
                    : `${bytes(storage.quotaBytes)} ${storage.space.kind === "personal" ? "personal" : "shared group"} quota`}
                </p>
                <p className="ws-small muted">
                  <I18nText id="Project and team libraries share their group quota. Space totals below cover only the selected space." />
                </p>
              </div>
              <dl className="ws-facts">
                <div>
                  <dt>
                    <I18nText id="Current files" />
                  </dt>
                  <dd>{bytes(storage.totals.originals)}</dd>
                </div>
                <div>
                  <dt>
                    <I18nText id="Previous versions" />
                  </dt>
                  <dd>{bytes(storage.totals.versions)}</dd>
                </div>
                <div>
                  <dt>
                    <I18nText id="Image working drafts" />
                  </dt>
                  <dd>{bytes(storage.totals.drafts ?? 0)}</dd>
                </div>
                <div>
                  <dt>
                    <I18nText id="Generated previews" />
                  </dt>
                  <dd>{bytes(storage.totals.previews ?? 0)}</dd>
                </div>
                <div>
                  <dt>
                    <I18nText id="Website releases" />
                  </dt>
                  <dd>{bytes(storage.totals.publications ?? 0)}</dd>
                </div>
                <div>
                  <dt>
                    <I18nText id="In trash" />
                  </dt>
                  <dd>{bytes(storage.totals.trash)}</dd>
                </div>
                <div>
                  <dt>
                    <I18nText id="Uploads reserved" />
                  </dt>
                  <dd>{bytes(storage.reserved)}</dd>
                </div>
              </dl>
            </div>
            <HelpText>
              <I18nText id="Completed files and versions are retained until explicit manual cleanup. Existing pinned links remain tied to their immutable version. Maximum upload: 1 GB per file." />
            </HelpText>
            <div className="ws-section-heading">
              <h2>
                <I18nText id="Largest current files" />
              </h2>
              <WorkspaceLink to={`/trash?space=${spaceId}`}>
                <Trash2 size={14} />
                <I18nText id="Review trash" />
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
                        {file.versions} <I18nText id="versions" />
                        {file.deleted_at ? uiText(" · In trash") : ""}
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
                    ? uiText("File contents are private")
                    : uiText("No stored files")
                }
              >
                {!storage.space.role
                  ? uiText(
                      "Your management role includes storage totals, but not access to this project's files. Ask a project lead for content access.",
                    )
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
          title={uiText("Storage limit")}
          subtitle={uiText(
            "A limit prevents new uploads. It never deletes existing files.",
          )}
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
              <I18nText id="Limit in GB (leave blank for no quota)" />
              <TextInput
                type="number"
                min={0}
                step="0.1"
                value={quota}
                onChange={(event) => setQuota(event.target.value)}
              />
            </label>
            <ErrorNotice message={action.error} />
            <div className="dialog-footer">
              <Button
                data-dialog-cancel
                type="button"
                className="button secondary"
                onClick={() => setQuotaDialog(false)}
                disabled={action.busy}
              >
                <I18nText id="Cancel" />
              </Button>
              <Button className="button primary" disabled={action.busy}>
                <I18nText id="Save limit" />
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

export { default as GroupAdminPage } from "./GroupAdministration";
