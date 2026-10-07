"use client";
import {
  Button,
  Checkbox,
  HelpText,
  IconButton,
  TextInput,
  NativeSelect,
} from "../ui/controls";
import { useEffect, useState } from "react";
import { Download, RefreshCw, Save, ShieldCheck } from "lucide-react";
import {
  siteAnalyticsSettingsSchema,
  type SiteAnalyticsReport,
  type SiteAnalyticsSettings,
  type SiteMetrics,
} from "@axiom/shared/site-insights";
import type { SiteConfig } from "@axiom/shared/sites";
import {
  ErrorNotice,
  Loading,
  mutate,
  useAction,
  useData,
  useWorkspace,
} from "../workspace/ui";
import DraftGuard from "../workspace/DraftGuard";

const today = () => new Date().toISOString().slice(0, 10);
const start = (days: number) =>
  new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
const count = (value: number) => value.toLocaleString();
const metrics: [keyof SiteMetrics, string][] = [
  ["views", "Page views"],
  ["engaged", "Engaged views"],
  ["seconds", "Active seconds"],
  ["completed", "Scroll completions"],
  ["downloads", "Download clicks"],
  ["citations", "Citation copies"],
  ["outbound", "Outbound clicks"],
];
const change = (value: number, previous: number) =>
  previous
    ? `${value >= previous ? "+" : ""}${Math.round(((value - previous) / previous) * 100)}% vs previous period`
    : value
      ? "No prior-period activity"
      : "No change";

export default function SiteAnalytics({
  spaceId,
  config,
  manage,
}: {
  spaceId: string;
  config: SiteConfig;
  manage: boolean;
}) {
  const [range, setRange] = useState({ from: start(30), to: today() }),
    [dates, setDates] = useState(range),
    [filters, setFilters] = useState({
      author: "",
      tag: "",
      kind: "",
      entry: "",
    });
  const { revision } = useWorkspace();
  const params = new URLSearchParams({ ...range, ...filters });
  const path = `spaces/${spaceId}/site/analytics?${params}`;
  const data = useData<SiteAnalyticsReport>(path, revision),
    report = data.data;
  const tags = [
    ...new Set(config.entries.filter((e) => e.included).flatMap((e) => e.tags)),
  ].sort();
  const [chartMetric, setChartMetric] = useState<keyof SiteMetrics>("views");
  const peak = Math.max(1, ...(report?.days.map((d) => d[chartMetric]) ?? []));
  return (
    <div className="website-analytics">
      <div className="website-section-heading">
        <div>
          <h3>Research & readership</h3>
          <p>
            Aggregate reading signals and the shape of your published work.
            Dates use UTC.
          </p>
        </div>
        <div className="website-inline-actions">
          <IconButton
            className="icon-button"
            title="Refresh analytics"
            aria-label="Refresh analytics"
            onClick={data.revalidate}
          >
            <RefreshCw size={16} />
          </IconButton>
          <a className="button secondary" href={`/api/v1/${path}&format=csv`}>
            <Download size={15} />
            Export CSV
          </a>
        </div>
      </div>
      <div className="site-insights-filters">
        <div
          className="website-preview-switch"
          aria-label="Analytics date presets"
        >
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              aria-pressed={range.from === start(days) && range.to === today()}
              onClick={() => {
                const next = { from: start(days), to: today() };
                setRange(next);
                setDates(next);
              }}
            >
              {days} days
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setRange(dates);
          }}
        >
          <label>
            From
            <TextInput
              type="date"
              required
              value={dates.from}
              max={dates.to}
              onChange={(e) => setDates({ ...dates, from: e.target.value })}
            />
          </label>
          <label>
            To
            <TextInput
              type="date"
              required
              value={dates.to}
              min={dates.from}
              max={today()}
              onChange={(e) => setDates({ ...dates, to: e.target.value })}
            />
          </label>
          <Button className="button secondary">Apply dates</Button>
        </form>
        <div className="website-fields">
          <label>
            Author
            <NativeSelect
              value={filters.author}
              onChange={(e) =>
                setFilters({ ...filters, author: e.target.value })
              }
            >
              <option value="">All authors</option>
              {config.authors.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            Topic
            <NativeSelect
              value={filters.tag}
              onChange={(e) => setFilters({ ...filters, tag: e.target.value })}
            >
              <option value="">All topics</option>
              {tags.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </NativeSelect>
          </label>
          <label>
            Content
            <NativeSelect
              value={filters.kind}
              onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
            >
              <option value="">All types</option>
              {["post", "paper", "page", "resource"].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </NativeSelect>
          </label>
          <label>
            Article
            <NativeSelect
              value={filters.entry}
              onChange={(e) =>
                setFilters({ ...filters, entry: e.target.value })
              }
            >
              <option value="">All articles</option>
              {config.entries
                .filter((e) => e.included)
                .map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.title}
                  </option>
                ))}
            </NativeSelect>
          </label>
        </div>
      </div>
      <ErrorNotice message={data.error} retry={data.reload} />
      {!report ? (
        data.loading ? (
          <Loading label="Loading publication insights…" />
        ) : (
          <HelpText>
            Choose a valid date range or retry to load publication insights.
          </HelpText>
        )
      ) : (
        <>
          {(!report.supported || !report.live || !report.settings.enabled) && (
            <p className="site-insights-notice">
              <ShieldCheck size={17} />
              {!report.live
                ? "This website is not live. Publish a reviewed release to make it accessible."
                : !report.supported
                  ? "Rebuild and publish a reviewed release to activate the new reading features and analytics."
                  : "First-party collection is off. Existing aggregate history is retained; a manager can enable future collection below."}
            </p>
          )}
          <div className="site-insights-metrics">
            {metrics.map(([key, label]) => (
              <section key={key}>
                <span>{label}</span>
                <strong>{count(report.current[key])}</strong>
                <small>
                  {change(report.current[key], report.previous[key])}
                </small>
              </section>
            ))}
          </div>
          <section className="settings-card site-insights-chart">
            <div className="website-section-heading">
              <div>
                <h3>Reading activity</h3>
                <p>
                  {report.from} — {report.to}
                </p>
              </div>
              <label>
                Chart metric
                <NativeSelect
                  value={chartMetric}
                  onChange={(e) =>
                    setChartMetric(e.target.value as keyof SiteMetrics)
                  }
                >
                  {metrics.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </div>
            <svg
              viewBox="0 0 800 160"
              role="img"
              aria-label={`${metrics.find(([key]) => key === chartMetric)?.[1]} by day; equivalent data in the table below`}
            >
              <path
                d="M0 150H800M0 80H800M0 10H800"
                className="site-chart-grid"
              />
              <polyline
                points={report.days
                  .map(
                    (d, i) =>
                      `${(i / Math.max(1, report.days.length - 1)) * 800},${150 - (d[chartMetric] / peak) * 140}`,
                  )
                  .join(" ")}
                className="site-chart-line"
              />
              {report.days.map((d, i) => (
                <circle
                  key={d.day}
                  cx={(i / Math.max(1, report.days.length - 1)) * 800}
                  cy={150 - (d[chartMetric] / peak) * 140}
                  r="2.5"
                >
                  <title>
                    {d.day}: {count(d[chartMetric])}
                  </title>
                </circle>
              ))}
            </svg>
            <details>
              <summary>View daily data</summary>
              <div className="site-insights-table">
                <table>
                  <caption>Daily activity, UTC</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      {metrics.map(([key, label]) => (
                        <th scope="col" key={key}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.days.map((d) => (
                      <tr key={d.day}>
                        <th scope="row">{d.day}</th>
                        {metrics.map(([key]) => (
                          <td key={key}>{count(d[key])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <div className="site-insights-columns">
            <section className="settings-card">
              <h3>Published research</h3>
              <p>
                Current live release, independent of the readership date range.
                Binary files have no estimated text counts.
              </p>
              <dl className="site-editorial-totals">
                {(
                  [
                    ["Publications", report.publishing.entries],
                    ["Words", report.publishing.words],
                    ["Equations", report.publishing.equations],
                    ["Tables", report.publishing.tables],
                    ["Code blocks", report.publishing.codeBlocks],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{count(n)}</dd>
                  </div>
                ))}
              </dl>
              <h4>Publication cadence</h4>
              <ul className="site-insights-list">
                {report.publishing.cadence.map((d) => (
                  <li key={d.month}>
                    <span>{d.month}</span>
                    <strong>{d.entries}</strong>
                  </li>
                ))}
              </ul>
              <h4>Topics</h4>
              <ul className="site-insights-list">
                {report.publishing.topics.map((t) => (
                  <li key={t.tag}>
                    <span>{t.tag}</span>
                    <strong>{t.entries}</strong>
                  </li>
                ))}
              </ul>
            </section>
            <section className="settings-card">
              <h3>Referring domains</h3>
              <p>
                Domains only; no referring paths or search queries are stored.
              </p>
              {report.referrers.length ? (
                <ul className="site-insights-list">
                  {report.referrers.map((r) => (
                    <li key={r.domain}>
                      <span>{r.domain}</span>
                      <strong>{count(r.views)}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No recorded referring traffic in this period.</p>
              )}
            </section>
          </div>
          <section className="settings-card">
            <h3>Articles</h3>
            <div className="site-insights-table">
              <table>
                <caption>Published article performance</caption>
                <thead>
                  <tr>
                    <th scope="col">Article</th>
                    <th scope="col">Words</th>
                    <th scope="col">Views</th>
                    <th scope="col">Engaged</th>
                    <th scope="col">Completion</th>
                    <th scope="col">Downloads</th>
                    <th scope="col">Citations</th>
                  </tr>
                </thead>
                <tbody>
                  {report.entries.map((e) => (
                    <tr key={e.id}>
                      <th scope="row">
                        {e.title}
                        <small>{e.kind}</small>
                      </th>
                      <td>{e.reading ? count(e.reading.words) : "—"}</td>
                      <td>{count(e.views)}</td>
                      <td>{count(e.engaged)}</td>
                      <td>
                        {e.views
                          ? `${Math.round((e.completed / e.views) * 100)}%`
                          : "—"}
                      </td>
                      <td>{count(e.downloads)}</td>
                      <td>{count(e.citations)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.entries.length && (
              <p>No matching publications in the live release.</p>
            )}
          </section>
          <section className="settings-card">
            <h3>Authors</h3>
            <p>
              Each coauthor receives full credit for a shared article. Site
              totals count the article only once.
            </p>
            <div className="site-insights-table">
              <table>
                <caption>Author publication and reading totals</caption>
                <thead>
                  <tr>
                    <th scope="col">Author</th>
                    <th scope="col">Publications</th>
                    <th scope="col">Words</th>
                    <th scope="col">Views</th>
                    <th scope="col">Engaged</th>
                    <th scope="col">Downloads</th>
                  </tr>
                </thead>
                <tbody>
                  {report.authors.map((a) => (
                    <tr key={a.id}>
                      <th scope="row">{a.name}</th>
                      <td>{a.entries}</td>
                      <td>{count(a.words)}</td>
                      <td>{count(a.views)}</td>
                      <td>{count(a.engaged)}</td>
                      <td>{count(a.downloads)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <details className="settings-card site-insights-definitions">
            <summary>How to interpret these numbers</summary>
            <p>
              A view is a page load, not a unique person. An engaged view has at
              least 10 active seconds. A scroll completion combines 90% article
              depth and 10 active seconds. Download counts are clicks, not
              confirmed completed downloads. Counts exclude known bots,
              previews, browser privacy signals and opted-out visitors, but
              cannot prove human readership.
            </p>
            <p>
              Daily aggregates are kept for thirteen months; ephemeral
              page-event deduplication records for seven days. Public counters
              are lifetime totals for currently published entries. Anonymous
              first-party counts store no raw IPs, account identity or
              persistent visitor IDs. Ordinary local development does not
              collect data.
            </p>
          </details>
          <AnalyticsPreferences
            spaceId={spaceId}
            report={report}
            manage={manage}
            reload={data.revalidate}
          />
        </>
      )}
    </div>
  );
}

function AnalyticsPreferences({
  spaceId,
  report,
  manage,
  reload,
}: {
  spaceId: string;
  report: SiteAnalyticsReport;
  manage: boolean;
  reload: () => void;
}) {
  const [baseline, setBaseline] = useState({
      settings: report.settings,
      version: report.settingsVersion,
    }),
    [settings, setSettings] = useState(report.settings);
  const action = useAction(),
    { notify } = useWorkspace();
  const dirty = JSON.stringify(settings) !== JSON.stringify(baseline.settings);
  useEffect(() => {
    if (!dirty && report.settingsVersion > baseline.version) {
      setBaseline({
        settings: report.settings,
        version: report.settingsVersion,
      });
      setSettings(report.settings);
    }
  }, [report.settingsVersion, dirty]);
  const toggle = (
    key: Exclude<keyof SiteAnalyticsSettings, "googleMeasurementId">,
    label: string,
    description: string,
  ) => (
    <label className="site-insights-setting" key={key}>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <Checkbox
        checked={settings[key]}
        onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
      />
    </label>
  );
  return (
    <section className="settings-card site-insights-preferences">
      <DraftGuard dirty={dirty} title="Leave unsaved analytics preferences?" />
      <h3>Collection & disclosure</h3>
      <p>
        Manager-only operational settings take effect without republishing. They
        do not change your frozen article content.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const value = siteAnalyticsSettingsSchema.parse(settings);
            await mutate(
              `spaces/${spaceId}/site/analytics/settings`,
              { settings: value, version: baseline.version },
              "PATCH",
            );
            setSettings(value);
            setBaseline({ settings: value, version: baseline.version + 1 });
            reload();
            notify("Website analytics preferences saved.");
          });
        }}
      >
        <fieldset disabled={!manage || action.busy}>
          {toggle(
            "enabled",
            "Anonymous first-party analytics",
            "Off by default. Collect aggregate readership with no tracking cookies; respect Do Not Track, Global Privacy Control and visitor opt-out.",
          )}
          {toggle(
            "publicViews",
            "Show public view counts",
            "Display lifetime page views on currently published articles.",
          )}
          {toggle(
            "publicDownloads",
            "Show public download clicks",
            "Display click totals, not completed downloads.",
          )}
          {toggle(
            "publicSiteTotals",
            "Show website totals in the footer",
            "Use the selected public metrics above; never expose the private dashboard.",
          )}
          <label>
            External analytics measurement ID
            <TextInput
              placeholder="G-ABC1234567"
              maxLength={22}
              value={settings.googleMeasurementId}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  googleMeasurementId: e.target.value.toUpperCase(),
                })
              }
              spellCheck={false}
            />
          </label>
          <HelpText>
            Optional Google Analytics 4 integration with your own property. No
            Google requests occur until the visitor explicitly accepts.
            Advertising storage and signals remain disabled. Reports stay in
            Google Analytics; this dashboard uses only first-party aggregates.
          </HelpText>
          {report.settingsVersion !== baseline.version && dirty && (
            <ErrorNotice message="Another manager changed these preferences. Discard your local changes to load the latest settings before saving." />
          )}
          <div className="website-inline-actions">
            <Button
              className="button primary"
              disabled={!dirty || report.settingsVersion !== baseline.version}
              pending={!!action.busy}
            >
              <Save size={15} />
              {"Save privacy preferences"}
            </Button>
            <Button
              type="button"
              className="button secondary"
              disabled={!dirty}
              onClick={() => {
                setSettings(report.settings);
                setBaseline({
                  settings: report.settings,
                  version: report.settingsVersion,
                });
              }}
            >
              Discard changes
            </Button>
          </div>
        </fieldset>
      </form>
      <ErrorNotice message={action.error} />
      {!manage && (
        <HelpText>
          Only a workspace manager can change collection or public disclosures.
        </HelpText>
      )}
    </section>
  );
}
