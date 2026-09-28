"use client";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChartNoAxesCombined,
  Check,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Globe2,
  LayoutTemplate,
  Link2,
  Plus,
  Rocket,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  defaultSiteConfig,
  publicationFileMime,
  siteConfigSchema,
  siteEntrySchema,
  siteSlug,
  type SiteConfig,
  type SiteEntry,
  type SiteRelease,
  type WorkspaceSite,
} from "@axiom/shared/sites";
import type { Resource, ResourcePage, Space } from "@axiom/shared/workspace";
import Dialog, { DialogFooter } from "../Dialog";
import DraftGuard from "../workspace/DraftGuard";
import {
  Badge,
  Empty,
  ErrorNotice,
  Loading,
  mutate,
  useAction,
  useData,
  useWorkspace,
  WorkspaceLink,
} from "../workspace/ui";
import SiteDesigner from "./SiteDesigner";
import SiteAnalytics from "./SiteAnalytics";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 70)
    .replace(/^-|-$/g, "") || "research";
const tabs = [
  ["overview", "Overview", Globe2],
  ["content", "Content", FileText],
  ["design", "Design", LayoutTemplate],
  ["people", "People & navigation", Users],
  ["domains", "Domain", Link2],
  ["releases", "Review & publish", Rocket],
  ["analytics", "Analytics", ChartNoAxesCombined],
] as const;
type Tab = (typeof tabs)[number][0];
type Response = {
  site: WorkspaceSite | null;
  canManage?: boolean;
  canEdit?: boolean;
  suggested?: SiteConfig;
};

export default function WorkspaceWebsite({ space }: { space: Space }) {
  const { revision } = useWorkspace();
  const data = useData<Response>(`spaces/${space.id}/site`, revision);
  const pending = data.data?.site?.releases.some(
    (r) => r.status === "queued" || r.status === "building",
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") data.revalidate();
    }, 3000);
    return () => clearInterval(timer);
  }, [pending, data.revalidate]);
  return (
    <div className="website-workbench">
      <ErrorNotice message={data.error} retry={data.reload} />
      {!data.data && data.loading ? (
        <Loading label="Opening website studio…" />
      ) : data.data?.site ? (
        <WebsiteEditor
          key={data.data.site.id}
          site={data.data.site}
          space={space}
          reload={data.revalidate}
        />
      ) : data.data ? (
        <WebsiteSetup
          space={space}
          canManage={
            !!data.data.canManage && space.effective_status === "active"
          }
          reload={data.reload}
        />
      ) : null}
    </div>
  );
}
function WebsiteSetup({
  space,
  canManage,
  reload,
}: {
  space: Space;
  canManage: boolean;
  reload: () => void;
}) {
  const [title, setTitle] = useState(space.name),
    [slug, setSlug] = useState(slugify(space.name)),
    action = useAction();
  return (
    <section className="website-setup">
      <span className="website-emblem">
        <Globe2 size={28} />
      </span>
      <p className="eyebrow">YOUR WORK, IN THE OPEN</p>
      <h2>A home for your research</h2>
      <p>
        Publish a{" "}
        {space.kind === "personal"
          ? "personal researcher homepage"
          : "research team website"}
        , papers and a blog from this workspace. Working files stay private
        until a manager approves a frozen release.
      </p>
      <div className="website-principles">
        <span>
          <ShieldCheck size={18} />
          Explicit publication
        </span>
        <span>
          <LayoutTemplate size={18} />
          Designed for research
        </span>
        <span>
          <Download size={18} />
          Portable static export
        </span>
      </div>
      {canManage ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await mutate(`spaces/${space.id}/site`, {
                slug: siteSlug.parse(slug),
                config: defaultSiteConfig(title, space.kind === "personal"),
              });
              reload();
            });
          }}
        >
          <label>
            Website title
            <input
              required
              maxLength={150}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Site address
            <span className="website-slug">
              <span>/sites/</span>
              <input
                aria-label="Site address"
                required
                minLength={2}
                maxLength={80}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </span>
          </label>
          <button className="button primary" disabled={action.busy}>
            <Plus size={16} />
            Create private website draft
          </button>
          <ErrorNotice message={action.error} />
        </form>
      ) : (
        <p className="ws-note">A workspace manager can set up this website.</p>
      )}
    </section>
  );
}
function WebsiteEditor({
  site,
  space,
  reload,
}: {
  site: WorkspaceSite;
  space: Space;
  reload: () => void;
}) {
  const { notify } = useWorkspace(),
    action = useAction();
  const [baseline, setBaseline] = useState({
      config: site.config,
      version: site.version,
    }),
    [config, setConfig] = useState(site.config),
    [tab, setTab] = useState<Tab>("overview"),
    [analyticsVisited, setAnalyticsVisited] = useState(false),
    [picker, setPicker] = useState<"content" | "assets" | "logo" | null>(null),
    [entry, setEntry] = useState<string | null>(null),
    [review, setReview] = useState<SiteRelease | null>(null),
    [withdraw, setWithdraw] = useState(false);
  const dirty = JSON.stringify(config) !== JSON.stringify(baseline.config),
    editable = site.canEdit && space.effective_status === "active",
    manage = site.canManage && space.effective_status === "active";
  useEffect(() => {
    if (!dirty && site.version !== baseline.version) {
      setConfig(site.config);
      setBaseline({ config: site.config, version: site.version });
    }
  }, [site.version, dirty]);
  const set = (patch: Partial<SiteConfig>) =>
    setConfig((c) => ({ ...c, ...patch }));
  const save = () =>
    action.run(async () => {
      const value = siteConfigSchema.parse(config);
      await mutate(
        `spaces/${space.id}/site`,
        { config: value, version: baseline.version },
        "PATCH",
      );
      setBaseline({ config: value, version: baseline.version + 1 });
      setConfig(value);
      reload();
      notify("Website draft saved. The public site has not changed.");
    });
  const included = config.entries.filter((e) => e.included);
  const publicUrl = site.domains.find((d) => d.status === "verified")
    ? `https://${site.domains.find((d) => d.status === "verified")!.hostname}/`
    : site.publicUrl;
  const removeEntry = (id: string) =>
    set({
      entries: config.entries.filter((e) => e.id !== id),
      navigation: config.navigation.filter((n) => n.entryId !== id),
      design: {
        ...config.design,
        sections: config.design.sections.map((s) => ({
          ...s,
          entryIds: s.entryIds.filter((v) => v !== id),
        })),
      },
    });
  return (
    <>
      <DraftGuard dirty={dirty} title="Unsaved website draft" />
      <header className="website-heading">
        <div>
          <p className="eyebrow">WORKSPACE WEBSITE</p>
          <h2>
            {site.config.title}
            <Badge>{site.enabled ? "Published" : "Private"}</Badge>
          </h2>
          <p>Draft freely. Review precisely. Publish deliberately.</p>
        </div>
        {site.enabled && (
          <a
            className="button secondary"
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={15} />
            Visit site
          </a>
        )}
      </header>
      <nav className="website-tabs" aria-label="Website sections">
        {tabs
          .filter(
            ([key]) => key !== "analytics" || site.canEdit || site.canManage,
          )
          .map(([key, label, Icon]) => (
            <button
              key={key}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => {
                setTab(key);
                if (key === "analytics") setAnalyticsVisited(true);
              }}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
      </nav>
      <ErrorNotice message={action.error} />
      {dirty && site.version !== baseline.version && (
        <ErrorNotice message="Another editor saved a newer website draft. Your local changes are retained; copy anything you need, then discard to load the latest version." />
      )}
      <div className="website-body">
        {tab === "overview" && (
          <div className="website-overview-grid">
            <section className="settings-card">
              <h3>Site identity</h3>
              <p>
                {config.identity === "personal"
                  ? "A personal page for your research and writing."
                  : "A shared identity for your lab, team or research group."}
              </p>
              <fieldset disabled={!editable || action.busy}>
                <label>
                  Website title
                  <input
                    value={config.title}
                    maxLength={150}
                    onChange={(e) => set({ title: e.target.value })}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    rows={4}
                    value={config.description}
                    maxLength={2000}
                    onChange={(e) => set({ description: e.target.value })}
                  />
                </label>
                <div className="website-inline-actions">
                  <button
                    className="button secondary"
                    onClick={() => setPicker("logo")}
                  >
                    Choose site logo
                  </button>
                  {config.logoId && (
                    <button
                      className="text-button"
                      onClick={() => set({ logoId: null })}
                    >
                      Remove logo
                    </button>
                  )}
                </div>
              </fieldset>
              <dl className="website-facts">
                <div>
                  <dt>Public address</dt>
                  <dd>{publicUrl}</dd>
                </div>
                <div>
                  <dt>Publication</dt>
                  <dd>
                    {site.enabled
                      ? "A reviewed release is live"
                      : "No public website"}
                  </dd>
                </div>
                <div>
                  <dt>Next release</dt>
                  <dd>
                    {included.length} pages · {config.assetIds.length}{" "}
                    supporting resources
                  </dd>
                </div>
              </dl>
            </section>
            <section className="settings-card website-safety">
              <ShieldCheck size={24} />
              <h3>You control what becomes public</h3>
              <p>
                Only selected content and supporting resources are copied.
                Comments, annotations, discussions, tasks and private profiles
                are not published.
              </p>
              <ol>
                <li>Choose content and customize your website.</li>
                <li>Save, then build a frozen preview.</li>
                <li>A manager reviews it and publishes the exact release.</li>
              </ol>
              <p className="ws-note">
                Deleting a private source does not remove its published copy.
                Unpublish or replace the website release separately. Trashing
                the workspace suspends its site.
              </p>
              <button
                className="button secondary"
                onClick={() => setTab("content")}
              >
                Choose content
              </button>
            </section>
          </div>
        )}
        {tab === "content" && (
          <>
            <div className="website-section-heading">
              <div>
                <h3>Pages, papers & posts</h3>
                <p>
                  Use existing files; edit the working source in its usual
                  editor.
                </p>
              </div>
              <button
                className="button primary"
                disabled={!editable}
                onClick={() => setPicker("content")}
              >
                <Plus size={16} />
                Add from workspace
              </button>
            </div>
            {!config.entries.length ? (
              <Empty title="Start with a paper or a note">
                Nothing in this workspace is public automatically.
              </Empty>
            ) : (
              <div className="website-entry-list">
                {config.entries.map((e) => {
                  const available =
                    site.sourceStatus?.find((s) => s.id === e.resourceId)
                      ?.available !== false;
                  return (
                    <article key={e.id}>
                      <FileText size={20} />
                      <div>
                        <button
                          className="website-entry-title"
                          onClick={() => setEntry(e.id)}
                        >
                          {e.title}
                        </button>
                        <p>
                          {e.kind} · /{e.slug}/{" "}
                          {!available && (
                            <span className="website-warning">
                              · Private source unavailable
                            </span>
                          )}
                        </p>
                      </div>
                      <Badge>
                        {e.included ? "In next release" : "Excluded"}
                      </Badge>
                      <WorkspaceLink
                        className="icon-button"
                        title="Edit private source"
                        aria-label={`Edit source of ${e.title}`}
                        to={`/notes/${e.resourceId}`}
                      >
                        <ExternalLink size={16} />
                      </WorkspaceLink>
                      <button
                        className="icon-button"
                        title="Remove from draft"
                        aria-label={`Remove ${e.title} from draft`}
                        disabled={!editable}
                        onClick={() => removeEntry(e.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
            <section className="settings-card website-assets">
              <div className="website-section-heading">
                <div>
                  <h3>Supporting resources</h3>
                  <p>
                    Select images and linked canvas/files explicitly. Their
                    read-only resource pages and approved bytes will be public.
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={!editable}
                  onClick={() => setPicker("assets")}
                >
                  <Plus size={15} />
                  Choose resources
                </button>
              </div>
              <p>
                {config.assetIds.length} selected. Missing assets are replaced
                with a notice; remote images are never fetched.
              </p>
              <ResourceNames
                spaceId={space.id}
                ids={config.assetIds}
                onRemove={(id) =>
                  set({ assetIds: config.assetIds.filter((v) => v !== id) })
                }
                disabled={!editable}
              />
            </section>
          </>
        )}
        {tab === "design" && (
          <SiteDesigner
            spaceId={space.id}
            config={config}
            onChange={setConfig}
            disabled={!editable}
          />
        )}
        {analyticsVisited && (site.canEdit || site.canManage) && (
          <div hidden={tab !== "analytics"}>
            <SiteAnalytics
              spaceId={space.id}
              config={site.config}
              manage={manage}
            />
          </div>
        )}
        {tab === "people" && (
          <PeopleAndNavigation config={config} set={set} disabled={!editable} />
        )}
        {tab === "domains" && (
          <DomainSettings
            site={site}
            spaceId={space.id}
            manage={manage}
            reload={reload}
          />
        )}
        {tab === "releases" && (
          <>
            <div className="website-section-heading">
              <div>
                <h3>Frozen releases</h3>
                <p>
                  Preview, approve and roll back without exposing newer working
                  edits.
                </p>
              </div>
              <button
                className="button primary"
                disabled={
                  !editable ||
                  dirty ||
                  action.busy ||
                  site.releases.some((r) =>
                    ["queued", "building"].includes(r.status),
                  )
                }
                onClick={() =>
                  void action.run(async () => {
                    await mutate(`spaces/${space.id}/site/review`, {
                      version: baseline.version,
                    });
                    reload();
                    notify(
                      "Building a private preview. The public site is unchanged.",
                    );
                  })
                }
              >
                <Eye size={16} />
                Build review preview
              </button>
            </div>
            {dirty && (
              <p className="ws-note">
                Save your draft before building a preview.
              </p>
            )}
            {!site.releases.length && (
              <Empty title="No release yet">
                Build a preview when your content and design are ready.
              </Empty>
            )}
            <div className="website-release-list">
              {site.releases.map((r) => (
                <article key={r.id}>
                  <span className={`website-release-dot is-${r.status}`} />
                  <div>
                    <strong>{new Date(r.created_at).toLocaleString()}</strong>
                    <p>
                      {r.id.slice(0, 8)} · {r.status}
                      {r.id === site.live_release_id
                        ? site.enabled
                          ? " · Live"
                          : " · Last live release"
                        : r.published_at
                          ? " · Previously published"
                          : " · Private preview"}
                    </p>
                    {r.error && <p className="website-warning">{r.error}</p>}
                  </div>
                  {r.status === "ready" && (
                    <button
                      className="button secondary"
                      onClick={() => setReview(r)}
                    >
                      <Eye size={15} />
                      Review
                    </button>
                  )}
                  {!r.published_at &&
                    !["queued", "building"].includes(r.status) && (
                      <button
                        className="icon-button"
                        aria-label="Remove unused release"
                        title="Remove unused release"
                        disabled={!manage || action.busy}
                        onClick={() =>
                          void action.run(async () => {
                            await mutate(
                              `spaces/${space.id}/site/releases/${r.id}`,
                              {},
                              "DELETE",
                            );
                            reload();
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                </article>
              ))}
            </div>
            {site.enabled && (
              <section className="settings-card website-withdraw">
                <div>
                  <h3>Unpublish website</h3>
                  <p>
                    Remove public access immediately. Private files, saved
                    releases and exported copies are unchanged.
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={!manage}
                  onClick={() => setWithdraw(true)}
                >
                  Unpublish…
                </button>
              </section>
            )}
          </>
        )}
      </div>
      {dirty && (
        <footer className="website-savebar">
          <span>
            <span className="unsaved-dot" />
            Unsaved website draft
          </span>
          <button
            className="button secondary"
            disabled={action.busy}
            onClick={() => {
              setConfig(site.config);
              setBaseline({ config: site.config, version: site.version });
            }}
          >
            Discard changes
          </button>
          <button
            className="button primary"
            disabled={!editable || action.busy}
            onClick={() => void save()}
          >
            <Save size={15} />
            {action.busy ? "Saving…" : "Save draft"}
          </button>
        </footer>
      )}
      {picker && (
        <ResourcePicker
          spaceId={space.id}
          images={picker === "logo"}
          selected={
            picker === "logo"
              ? []
              : picker === "assets"
                ? config.assetIds
                : config.entries.map((e) => e.resourceId)
          }
          onClose={() => setPicker(null)}
          onChoose={(resources) => {
            if (picker === "logo") set({ logoId: resources[0].id });
            else if (picker === "assets")
              set({
                assetIds: [
                  ...new Set([
                    ...config.assetIds,
                    ...resources.map((r) => r.id),
                  ]),
                ],
              });
            else {
              const slugs = new Set(config.entries.map((e) => e.slug));
              const additions = resources
                .filter(
                  (r) => !config.entries.some((e) => e.resourceId === r.id),
                )
                .map((r) => {
                  let slug = slugify(r.name);
                  if (slug.length < 2) slug += "-note";
                  if (slugs.has(slug))
                    slug += "-" + crypto.randomUUID().slice(0, 6);
                  slugs.add(slug);
                  return siteEntrySchema.parse({
                    id: crypto.randomUUID(),
                    resourceId: r.id,
                    kind:
                      r.mime === "application/pdf"
                        ? "paper"
                        : r.kind === "note"
                          ? "post"
                          : "resource",
                    title: r.name,
                    slug,
                    tags: r.tags,
                    date: new Date().toISOString().slice(0, 10),
                  });
                });
              set({ entries: [...config.entries, ...additions] });
            }
            setPicker(null);
          }}
        />
      )}
      {entry && config.entries.some((e) => e.id === entry) && (
        <EntryDetails
          key={entry}
          entry={config.entries.find((e) => e.id === entry)!}
          config={config}
          disabled={!editable}
          spaceId={space.id}
          onClose={() => setEntry(null)}
          onSave={(value) => {
            set({
              entries: config.entries.map((e) =>
                e.id === value.id ? value : e,
              ),
            });
            setEntry(null);
          }}
        />
      )}
      {review && (
        <ReleaseReview
          site={site}
          release={review}
          manage={manage}
          spaceId={space.id}
          onClose={() => setReview(null)}
          reload={reload}
        />
      )}
      {withdraw && (
        <Dialog
          title="Unpublish this website?"
          subtitle="Public pages and resources will stop being served."
          onClose={() => !action.busy && setWithdraw(false)}
        >
          <p>
            This does not erase copies already downloaded, cached or exported by
            visitors. Restoring a previous release requires a manager’s
            approval.
          </p>
          <ErrorNotice message={action.error} />
          <DialogFooter>
            <button
              className="button secondary"
              disabled={action.busy}
              onClick={() => setWithdraw(false)}
            >
              Keep published
            </button>
            <button
              className="button danger"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await mutate(`spaces/${space.id}/site/unpublish`, {});
                  reload();
                  setWithdraw(false);
                  notify("Website unpublished.");
                })
              }
            >
              Unpublish website
            </button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );
}

export function ResourcePicker({
  spaceId,
  selected,
  onChoose,
  onClose,
  images = false,
}: {
  spaceId: string;
  selected: string[];
  onChoose: (resources: Resource[]) => void;
  onClose: () => void;
  images?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [chosen, setChosen] = useState<Resource[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setCursor(null);
    }, 180);
    return () => clearTimeout(timer);
  }, [search]);
  const data = useData<ResourcePage>(
    `resources?spaceId=${spaceId}&view=all&limit=60&name=${encodeURIComponent(query)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  return (
    <Dialog
      title={images ? "Choose image" : "Choose workspace resources"}
      size="wide"
      subtitle="Only resources you explicitly select will enter the publication draft."
      onClose={onClose}
    >
      <input
        type="search"
        autoFocus
        aria-label="Find resource"
        placeholder="Find by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ErrorNotice message={data.error} retry={data.reload} />
      <div className="website-picker-list">
        {data.data?.items
          .filter((r) => r.kind === "note" || r.kind === "file")
          .filter(
            (r) =>
              !images ||
              publicationFileMime(r.name, r.mime).startsWith("image/") ||
              r.mime === "application/vnd.axiom.image+zip",
          )
          .map((r) => (
            <label key={r.id}>
              <input
                type={images ? "radio" : "checkbox"}
                name={images ? "website-image" : undefined}
                disabled={selected.includes(r.id)}
                checked={
                  selected.includes(r.id) || chosen.some((v) => v.id === r.id)
                }
                onChange={(e) =>
                  setChosen((v) =>
                    e.target.checked
                      ? images
                        ? [r]
                        : [...v, r]
                      : v.filter((x) => x.id !== r.id),
                  )
                }
              />
              <FileText size={18} />
              <span>
                <strong>{r.name}</strong>
                <small>
                  {r.document_type ?? r.mime ?? r.kind}
                  {selected.includes(r.id) ? " · Already selected" : ""}
                </small>
              </span>
            </label>
          ))}
        {data.loading && <Loading label="Loading resources…" />}
        {data.data && !data.data.items.length && <p>No matching resources.</p>}
      </div>
      <div className="website-picker-pagination">
        <button
          className="text-button"
          disabled={!cursor}
          onClick={() => setCursor(null)}
        >
          First page
        </button>
        <button
          className="text-button"
          disabled={!data.data?.nextCursor}
          onClick={() => setCursor(data.data!.nextCursor)}
        >
          Next page
        </button>
      </div>
      <DialogFooter>
        <span>{chosen.length} selected</span>
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!chosen.length}
          onClick={() => onChoose(chosen)}
        >
          Add selection
        </button>
      </DialogFooter>
    </Dialog>
  );
}
function ResourceNames({
  spaceId,
  ids,
  onRemove,
  disabled,
}: {
  spaceId: string;
  ids: string[];
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  const data = useData<ResourcePage>(
    `resources?spaceId=${spaceId}&view=all&limit=100`,
  );
  return (
    <div className="website-resource-chips">
      {ids.map((id) => (
        <span key={id}>
          {data.data?.items.find((r) => r.id === id)?.name ??
            `Resource ${id.slice(0, 8)}`}
          <button
            disabled={disabled}
            aria-label={`Remove resource ${id.slice(0, 8)}`}
            title="Remove supporting resource"
            onClick={() => onRemove(id)}
          >
            <X size={14} />
          </button>
        </span>
      ))}
    </div>
  );
}
function EntryDetails({
  entry,
  config,
  disabled,
  spaceId,
  onSave,
  onClose,
}: {
  entry: SiteEntry;
  config: SiteConfig;
  disabled: boolean;
  spaceId: string;
  onSave: (value: SiteEntry) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(entry),
    [tags, setTags] = useState(entry.tags.join(", ")),
    [cover, setCover] = useState(false),
    action = useAction();
  const set = (patch: Partial<SiteEntry>) =>
    setValue((v) => ({ ...v, ...patch }));
  return (
    <Dialog
      title="Publication details"
      size="wide"
      subtitle="Public metadata is independent of the private file’s name and contents."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () =>
            onSave(
              siteEntrySchema.parse({
                ...value,
                tags: [
                  ...new Set(
                    tags
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  ),
                ],
              }),
            ),
          );
        }}
      >
        <fieldset disabled={disabled} className="website-fields">
          <label className="full">
            Title
            <input
              required
              maxLength={200}
              value={value.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </label>
          <label>
            Type
            <select
              value={value.kind}
              onChange={(e) =>
                set({ kind: e.target.value as SiteEntry["kind"] })
              }
            >
              {["post", "paper", "page", "resource"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            URL slug
            <input
              required
              minLength={2}
              maxLength={80}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              value={value.slug}
              onChange={(e) => set({ slug: e.target.value })}
            />
          </label>
          <label className="full">
            Summary
            <textarea
              rows={3}
              maxLength={2000}
              value={value.summary}
              onChange={(e) => set({ summary: e.target.value })}
            />
          </label>
          <label>
            Date
            <input
              type="date"
              value={value.date ?? ""}
              onChange={(e) => set({ date: e.target.value || undefined })}
            />
          </label>
          <label>
            Tags, comma separated
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
          <label>
            DOI
            <input
              maxLength={200}
              value={value.doi}
              placeholder="10.…"
              onChange={(e) => set({ doi: e.target.value })}
            />
          </label>
          <label>
            License
            <input
              maxLength={100}
              value={value.license}
              placeholder="e.g. CC BY 4.0"
              onChange={(e) => set({ license: e.target.value })}
            />
          </label>
          <div className="full">
            <span className="website-field-label">Public authors</span>
            {!config.authors.length && (
              <p className="ws-note">
                Add authors in People & navigation first.
              </p>
            )}
            <div className="website-resource-chips">
              {config.authors.map((a) => (
                <label className="website-check" key={a.id}>
                  <input
                    type="checkbox"
                    checked={value.authorIds.includes(a.id)}
                    onChange={(e) =>
                      set({
                        authorIds: e.target.checked
                          ? [...value.authorIds, a.id]
                          : value.authorIds.filter((id) => id !== a.id),
                      })
                    }
                  />
                  {a.name}
                </label>
              ))}
            </div>
          </div>
          <div className="full website-inline-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setCover(true)}
            >
              Choose cover image
            </button>
            {value.coverId && (
              <button
                type="button"
                className="text-button"
                onClick={() => set({ coverId: null })}
              >
                Remove cover
              </button>
            )}
          </div>
          <label className="website-check full">
            <input
              type="checkbox"
              checked={value.included}
              onChange={(e) => set({ included: e.target.checked })}
            />
            Include in the next release
          </label>
          <label className="website-check full">
            <input
              type="checkbox"
              checked={value.originalDownload}
              onChange={(e) => set({ originalDownload: e.target.checked })}
            />
            Offer the original file for download
          </label>
          <p className="ws-note full">
            Original files can expose hidden cells, speaker notes, comments or
            metadata. Images are otherwise flattened and stripped of metadata;
            PDF and media previews necessarily expose complete source bytes.
          </p>
        </fieldset>
        <ErrorNotice message={action.error} />
        <DialogFooter>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={disabled}>
            Apply to draft
          </button>
        </DialogFooter>
      </form>
      {cover && (
        <ResourcePicker
          spaceId={spaceId}
          images
          selected={[]}
          onClose={() => setCover(false)}
          onChoose={(items) => {
            set({ coverId: items[0].id });
            setCover(false);
          }}
        />
      )}
    </Dialog>
  );
}
function PeopleAndNavigation({
  config,
  set,
  disabled,
}: {
  config: SiteConfig;
  set: (value: Partial<SiteConfig>) => void;
  disabled: boolean;
}) {
  return (
    <div className="website-overview-grid">
      <section className="settings-card">
        <div className="website-section-heading">
          <div>
            <h3>Public profiles</h3>
            <p>
              Choose what to disclose; private member profiles are never
              imported.
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Add public author"
            title="Add author"
            disabled={disabled || config.authors.length >= 100}
            onClick={() =>
              set({
                authors: [
                  ...config.authors,
                  {
                    id: crypto.randomUUID(),
                    name: "New author",
                    bio: "",
                    affiliation: "",
                    url: "",
                    orcid: "",
                  },
                ],
              })
            }
          >
            <Plus size={17} />
          </button>
        </div>
        {config.authors.map((a) => (
          <details className="website-author" key={a.id} open>
            <summary>{a.name}</summary>
            <fieldset disabled={disabled}>
              {(["name", "affiliation", "bio", "url", "orcid"] as const).map(
                (key) => (
                  <label key={key}>
                    {
                      {
                        name: "Name",
                        affiliation: "Affiliation",
                        bio: "Biography",
                        url: "Website (HTTPS)",
                        orcid: "ORCID",
                      }[key]
                    }
                    {key === "bio" ? (
                      <textarea
                        rows={3}
                        maxLength={2000}
                        value={a[key]}
                        onChange={(e) =>
                          set({
                            authors: config.authors.map((v) =>
                              v.id === a.id
                                ? { ...v, [key]: e.target.value }
                                : v,
                            ),
                          })
                        }
                      />
                    ) : (
                      <input
                        value={a[key]}
                        maxLength={
                          key === "url"
                            ? 2000
                            : key === "orcid"
                              ? 50
                              : key === "name"
                                ? 120
                                : 200
                        }
                        onChange={(e) =>
                          set({
                            authors: config.authors.map((v) =>
                              v.id === a.id
                                ? { ...v, [key]: e.target.value }
                                : v,
                            ),
                          })
                        }
                      />
                    )}
                  </label>
                ),
              )}
              <button
                className="text-button"
                onClick={() =>
                  set({
                    authors: config.authors.filter((v) => v.id !== a.id),
                    entries: config.entries.map((e) => ({
                      ...e,
                      authorIds: e.authorIds.filter((id) => id !== a.id),
                    })),
                  })
                }
              >
                <Trash2 size={14} />
                Remove profile
              </button>
            </fieldset>
          </details>
        ))}
      </section>
      <section className="settings-card">
        <div className="website-section-heading">
          <div>
            <h3>Navigation</h3>
            <p>Archive, search and RSS are always available.</p>
          </div>
          <button
            className="icon-button"
            aria-label="Add navigation link"
            title="Add link"
            disabled={disabled || config.navigation.length >= 20}
            onClick={() =>
              set({
                navigation: [
                  ...config.navigation,
                  {
                    label: "New link",
                    ...(config.entries[0]
                      ? { entryId: config.entries[0].id }
                      : { url: "https://" }),
                  },
                ],
              })
            }
          >
            <Plus size={17} />
          </button>
        </div>
        {config.navigation.map((n, i) => (
          <fieldset
            className="website-navigation-item"
            disabled={disabled}
            key={i}
          >
            <label>
              Label
              <input
                maxLength={60}
                value={n.label}
                onChange={(e) =>
                  set({
                    navigation: config.navigation.map((v, k) =>
                      i === k ? { ...v, label: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            <label>
              Destination
              <select
                value={n.entryId ?? "external"}
                onChange={(e) =>
                  set({
                    navigation: config.navigation.map((v, k) =>
                      i === k
                        ? {
                            label: v.label,
                            ...(e.target.value === "external"
                              ? { url: "https://" }
                              : { entryId: e.target.value }),
                          }
                        : v,
                    ),
                  })
                }
              >
                <option value="external">External HTTPS link</option>
                {config.entries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                    {e.included ? "" : " (excluded)"}
                  </option>
                ))}
              </select>
            </label>
            {n.url !== undefined && (
              <label>
                HTTPS address
                <input
                  type="url"
                  value={n.url}
                  onChange={(e) =>
                    set({
                      navigation: config.navigation.map((v, k) =>
                        i === k ? { ...v, url: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
            )}
            <div className="website-inline-actions">
              <button
                className="icon-button"
                title="Move up"
                aria-label="Move link up"
                disabled={i === 0}
                onClick={() => {
                  const next = [...config.navigation];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  set({ navigation: next });
                }}
              >
                <ArrowUp size={15} />
              </button>
              <button
                className="icon-button"
                title="Move down"
                aria-label="Move link down"
                disabled={i === config.navigation.length - 1}
                onClick={() => {
                  const next = [...config.navigation];
                  [next[i + 1], next[i]] = [next[i], next[i + 1]];
                  set({ navigation: next });
                }}
              >
                <ArrowDown size={15} />
              </button>
              <button
                className="icon-button"
                title="Remove link"
                aria-label="Remove navigation link"
                onClick={() =>
                  set({
                    navigation: config.navigation.filter((_, k) => i !== k),
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          </fieldset>
        ))}
      </section>
    </div>
  );
}
function DomainSettings({
  site,
  spaceId,
  manage,
  reload,
}: {
  site: WorkspaceSite;
  spaceId: string;
  manage: boolean;
  reload: () => void;
}) {
  const [hostname, setHostname] = useState(""),
    action = useAction(),
    domain = site.domains[0];
  return (
    <section className="settings-card website-domain">
      <h3>Your own address</h3>
      <p>
        Keep the built-in address or connect one verified domain. With the
        bundled Caddy gateway, certificates are issued automatically for
        verified, published sites.
      </p>
      <dl className="website-facts">
        <div>
          <dt>Built-in address</dt>
          <dd>{site.publicUrl}</dd>
        </div>
        <div>
          <dt>Server target</dt>
          <dd>
            {site.domainTarget ?? "Not configured by the server administrator"}
          </dd>
        </div>
      </dl>
      {!site.domainTarget && (
        <p className="ws-note">
          Set PUBLISH_DOMAIN_TARGET to this deployment’s public hostname and
          configure the publication gateway before connecting a domain.
        </p>
      )}
      {!domain ? (
        <form
          className="website-domain-form"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await mutate(`spaces/${spaceId}/site/domains`, { hostname });
              reload();
              setHostname("");
            });
          }}
        >
          <label>
            Domain
            <input
              required
              placeholder="research.example.org"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
            />
          </label>
          <button
            className="button primary"
            disabled={!manage || action.busy || !site.domainTarget}
          >
            <Plus size={15} />
            Connect domain
          </button>
        </form>
      ) : (
        <>
          <h4>
            {domain.hostname} <Badge>{domain.status}</Badge>
          </h4>
          <p>
            Add these records with your DNS provider. For an apex domain, use
            A/AAAA records matching the server target instead of CNAME.
          </p>
          <div className="website-dns-table">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>TXT</td>
                  <td>_axiom.{domain.hostname}</td>
                  <td>
                    <code>axiom-site={domain.token}</code>
                  </td>
                </tr>
                <tr>
                  <td>CNAME</td>
                  <td>{domain.hostname}</td>
                  <td>{site.domainTarget}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="ws-note">
            DNS changes can take time to propagate. The built-in URL becomes a
            redirect after verification. This does not publish a private
            website.
          </p>
          <div className="website-inline-actions">
            <button
              className="button primary"
              disabled={!manage || action.busy}
              onClick={() =>
                void action.run(async () => {
                  await mutate(
                    `spaces/${spaceId}/site/domains/${domain.id}/verify`,
                    {},
                  );
                  reload();
                })
              }
            >
              <Check size={15} />
              Verify DNS
            </button>
            <button
              className="button secondary"
              disabled={!manage || action.busy}
              onClick={() =>
                void action.run(async () => {
                  await mutate(
                    `spaces/${spaceId}/site/domains/${domain.id}`,
                    {},
                    "DELETE",
                  );
                  reload();
                })
              }
            >
              Disconnect domain
            </button>
          </div>
        </>
      )}
      <ErrorNotice message={action.error} />
    </section>
  );
}
function ReleaseReview({
  site,
  release,
  manage,
  spaceId,
  onClose,
  reload,
}: {
  site: WorkspaceSite;
  release: SiteRelease;
  manage: boolean;
  spaceId: string;
  onClose: () => void;
  reload: () => void;
}) {
  const [consent, setConsent] = useState(false),
    [includeGoogle, setIncludeGoogle] = useState(false),
    [exportUrl, setExportUrl] = useState(site.publicUrl),
    action = useAction(),
    { notify } = useWorkspace();
  const data = useData<SiteRelease>(
    `spaces/${spaceId}/site/releases/${release.id}`,
  );
  const preview = `/api/v1/spaces/${spaceId}/site/releases/${release.id}/preview/`;
  const restore = !!release.published_at;
  return (
    <Dialog
      title={restore ? "Review published release" : "Review before publication"}
      subtitle={`Frozen ${new Date(release.created_at).toLocaleString()} · ${release.fingerprint.slice(0, 16)}`}
      size="visual"
      className="website-review-dialog"
      onClose={() => !action.busy && onClose()}
    >
      <div className="website-review-layout">
        <div className="website-review-preview">
          <div>
            <span>Read-only public preview</span>
            <a href={preview} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              Open preview
            </a>
          </div>
          <iframe
            src={preview}
            title="Frozen website preview"
            sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"
            allow="fullscreen"
          />
        </div>
        <aside>
          <h3>Publication checklist</h3>
          <p>
            {data.data?.snapshot?.config.entries.filter((e) => e.included)
              .length ?? "…"}{" "}
            pages · {data.data?.snapshot?.sources.length ?? "…"} explicitly
            selected sources
          </p>
          <p>
            The live website will use this exact release. New private edits stay
            private.
          </p>
          {!!release.warnings.length && (
            <section className="website-review-warnings">
              <h4>Check these details</h4>
              <ul>
                {release.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          )}
          <p className="ws-note">
            Confirm permission to publish all selected text, figures, files and
            public profiles. Downloaded or exported copies cannot be recalled.
          </p>
          {manage && (
            <label className="website-check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I reviewed this preview and approve its contents for public
              access.
            </label>
          )}
          {manage && (
            <details className="website-static-export">
              <summary>Export a static website</summary>
              <label>
                Deployment base URL
                <input
                  type="url"
                  value={exportUrl}
                  onChange={(e) => setExportUrl(e.target.value)}
                />
              </label>
              <a
                className="button secondary"
                href={`/api/v1/spaces/${spaceId}/site/releases/${release.id}/export?baseUrl=${encodeURIComponent(exportUrl)}${includeGoogle ? "&includeGoogle=1" : ""}`}
              >
                <Download size={15} />
                Download ZIP
              </a>
              <label className="website-check">
                <input
                  type="checkbox"
                  checked={includeGoogle}
                  onChange={(e) => setIncludeGoogle(e.target.checked)}
                />
                Include configured Google Analytics (visitor consent required)
              </label>
              <p className="ws-note">
                First-party analytics and live counters are not included.
                Exported sites are independent public copies. Serve over
                HTTP(S), not file://.
              </p>
            </details>
          )}
          {!manage && (
            <p className="ws-note">
              A workspace manager must approve publication.
            </p>
          )}
          <ErrorNotice message={data.error || action.error} />
        </aside>
      </div>
      <DialogFooter>
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={onClose}
        >
          Close preview
        </button>
        <button
          className="button primary"
          disabled={!manage || !consent || !data.data || action.busy}
          onClick={() =>
            void action.run(async () => {
              await mutate(
                `spaces/${spaceId}/site/${restore ? "rollback" : "publish"}`,
                {
                  releaseId: release.id,
                  fingerprint: release.fingerprint,
                  consent: true,
                },
              );
              reload();
              onClose();
              notify(
                restore ? "Published release restored." : "Website published.",
              );
            })
          }
        >
          <Rocket size={16} />
          {action.busy
            ? "Publishing…"
            : restore
              ? "Restore this release"
              : "Publish this release"}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
