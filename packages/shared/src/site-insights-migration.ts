export const siteInsightsMigration = `
ALTER TABLE site_releases ADD COLUMN public_catalog jsonb;
CREATE TABLE site_entry_publications (
 site_id uuid NOT NULL REFERENCES workspace_sites ON DELETE CASCADE, entry_id uuid NOT NULL,
 first_published_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(site_id,entry_id)
);
INSERT INTO site_entry_publications(site_id,entry_id,first_published_at)
 SELECT r.site_id,(e->>'id')::uuid,min(r.published_at) FROM site_releases r
 CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'config'->'entries') e
 WHERE r.published_at IS NOT NULL AND coalesce((e->>'included')::boolean,true)
 GROUP BY r.site_id,(e->>'id')::uuid ON CONFLICT DO NOTHING;
CREATE TABLE site_analytics_settings (
 site_id uuid PRIMARY KEY REFERENCES workspace_sites ON DELETE CASCADE,
 settings jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
 started_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE site_analytics_visits (
 site_id uuid NOT NULL REFERENCES workspace_sites ON DELETE CASCADE, visit_id uuid NOT NULL,
 release_id uuid NOT NULL, page text NOT NULL, entry_id text NOT NULL DEFAULT '', day date NOT NULL,
 referrer text NOT NULL DEFAULT '', seconds integer NOT NULL DEFAULT 0, depth integer NOT NULL DEFAULT 0,
 downloads integer NOT NULL DEFAULT 0,citations integer NOT NULL DEFAULT 0,outbound integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site_id,visit_id)
);
CREATE INDEX site_analytics_visits_expiry ON site_analytics_visits(created_at);
CREATE TABLE site_analytics_daily (
 site_id uuid NOT NULL REFERENCES workspace_sites ON DELETE CASCADE,day date NOT NULL,entry_id text NOT NULL DEFAULT '',referrer text NOT NULL DEFAULT '',
 views bigint NOT NULL DEFAULT 0,engaged bigint NOT NULL DEFAULT 0,seconds bigint NOT NULL DEFAULT 0,completed bigint NOT NULL DEFAULT 0,
 downloads bigint NOT NULL DEFAULT 0,citations bigint NOT NULL DEFAULT 0,outbound bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(site_id,day,entry_id,referrer)
);
CREATE INDEX site_analytics_daily_expiry ON site_analytics_daily(day);
CREATE TABLE site_analytics_totals (
 site_id uuid NOT NULL REFERENCES workspace_sites ON DELETE CASCADE,entry_id text NOT NULL DEFAULT '',
 views bigint NOT NULL DEFAULT 0, downloads bigint NOT NULL DEFAULT 0,PRIMARY KEY(site_id,entry_id)
);
`;
