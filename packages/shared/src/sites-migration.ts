export const sitesMigration = `
CREATE TABLE workspace_sites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL UNIQUE REFERENCES spaces ON DELETE CASCADE,
 slug text NOT NULL UNIQUE, config jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
 enabled boolean NOT NULL DEFAULT false, live_release_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE site_releases (
 id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES workspace_sites ON DELETE CASCADE,
 created_by text NOT NULL REFERENCES "user", snapshot jsonb NOT NULL, fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','building','ready','failed')),
 lease_until timestamptz, error text, warnings jsonb NOT NULL DEFAULT '[]', published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_release_queue ON site_releases(created_at) WHERE status IN ('queued','building');
CREATE TABLE site_release_files (
 release_id uuid NOT NULL REFERENCES site_releases ON DELETE CASCADE, path text NOT NULL,
 storage_key uuid NOT NULL, mime text NOT NULL, bytes bigint NOT NULL, sha256 text NOT NULL, download boolean NOT NULL DEFAULT false,
 PRIMARY KEY(release_id,path)
);
CREATE INDEX site_files_storage ON site_release_files(storage_key);
CREATE TABLE site_domains (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL UNIQUE REFERENCES workspace_sites ON DELETE CASCADE,
 hostname text NOT NULL UNIQUE, token text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified')),
 verified_at timestamptz, error text, created_at timestamptz NOT NULL DEFAULT now()
);
-- Trashing a workspace withdraws its site and never republishes on restore.
CREATE FUNCTION axiom_suspend_site() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF axiom_space_state(NEW.id) IN ('trashed','purging') THEN UPDATE workspace_sites SET enabled=false WHERE space_id=NEW.id; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER axiom_site_lifecycle AFTER UPDATE ON spaces FOR EACH ROW EXECUTE FUNCTION axiom_suspend_site();
CREATE FUNCTION axiom_suspend_group_sites() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.lifecycle_status IN ('trashed','purging') THEN UPDATE workspace_sites SET enabled=false WHERE space_id IN (SELECT id FROM spaces WHERE group_id=NEW.id); END IF;
 RETURN NEW; END $$;
CREATE TRIGGER axiom_group_sites_lifecycle AFTER UPDATE OF lifecycle_status ON groups FOR EACH ROW EXECUTE FUNCTION axiom_suspend_group_sites();
CREATE FUNCTION axiom_site_file_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO workspace_jobs(kind,dedupe_key,payload) VALUES('delete-blob','site-file:'||OLD.storage_key::text,jsonb_build_object('key',OLD.storage_key)) ON CONFLICT(dedupe_key) DO NOTHING;
 RETURN OLD; END $$;
CREATE TRIGGER axiom_site_file_cleanup AFTER DELETE ON site_release_files FOR EACH ROW EXECUTE FUNCTION axiom_site_file_cleanup();
`;
