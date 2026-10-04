export const pluginsMigration = `
CREATE TABLE plugin_packages (
  hash text PRIMARY KEY CHECK(hash ~ '^[a-f0-9]{64}$'),
  plugin_id text NOT NULL, version text NOT NULL, manifest jsonb NOT NULL,
  bundle text NOT NULL, archive bytea NOT NULL, builtin boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE plugin_package_owners (
  package_hash text NOT NULL REFERENCES plugin_packages(hash), user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  PRIMARY KEY(package_hash,user_id)
);
CREATE TABLE plugin_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  plugin_id text NOT NULL, package_hash text NOT NULL REFERENCES plugin_packages(hash),
  previous_hash text REFERENCES plugin_packages(hash), enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1, settings jsonb NOT NULL DEFAULT '{}', bindings jsonb NOT NULL DEFAULT '{}', uninstalled_at timestamptz,
  private_state jsonb NOT NULL DEFAULT '{}', storage_version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,plugin_id)
);
CREATE TABLE plugin_group_approvals (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE, package_hash text NOT NULL REFERENCES plugin_packages(hash),
  plugin_id text NOT NULL, space_ids uuid[] NOT NULL DEFAULT '{}', enabled boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1, approved_by text NOT NULL REFERENCES "user"(id),
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(group_id,plugin_id)
);
CREATE TABLE plugin_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), installation_id uuid NOT NULL REFERENCES plugin_installations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  package_hash text NOT NULL REFERENCES plugin_packages(hash), capabilities text[] NOT NULL,
  revision integer NOT NULL DEFAULT 1, approval_revision integer, revoked_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(installation_id,space_id)
);
CREATE TABLE plugin_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  installation_id uuid REFERENCES plugin_installations(id) ON DELETE SET NULL, grant_id uuid REFERENCES plugin_grants(id) ON DELETE SET NULL,
  space_id uuid REFERENCES spaces(id) ON DELETE SET NULL, package_hash text NOT NULL,
  method text NOT NULL, outcome text NOT NULL, change_set_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plugin_activity_owner_time ON plugin_activity(user_id,created_at DESC);
CREATE INDEX plugin_activity_rate ON plugin_activity(grant_id,created_at DESC);
ALTER TABLE workspace_change_sets ADD COLUMN plugin_grant_id uuid REFERENCES plugin_grants(id);
ALTER TABLE workspace_change_sets ADD COLUMN plugin_package_hash text;
ALTER TABLE workspace_change_sets ADD COLUMN plugin_grant_revision integer;
ALTER TABLE audit_events ADD COLUMN plugin_grant_id uuid, ADD COLUMN plugin_package_hash text;
CREATE FUNCTION axiom_audit_plugin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.plugin_grant_id := nullif(current_setting('axiom.plugin_grant_id',true),'')::uuid;
 NEW.plugin_package_hash := nullif(current_setting('axiom.plugin_package_hash',true),'');
 RETURN NEW;
END $$;
CREATE TRIGGER axiom_audit_plugin BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION axiom_audit_plugin();
`;
