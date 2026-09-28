export const assistantProductivityMigration = `
ALTER TABLE assistant_contexts ADD COLUMN agent_config jsonb;
CREATE TABLE assistant_runs (
 id uuid PRIMARY KEY REFERENCES tool_jobs ON DELETE CASCADE,
 context_id uuid NOT NULL REFERENCES assistant_contexts ON DELETE CASCADE,
 round integer NOT NULL DEFAULT 0, messages jsonb NOT NULL DEFAULT '[]',
 actions jsonb NOT NULL DEFAULT '[]', activity jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE assistant_run_steps (
 run_id uuid NOT NULL REFERENCES assistant_runs ON DELETE CASCADE,
 ordinal integer NOT NULL, provider_id uuid REFERENCES tool_providers ON DELETE SET NULL,
 dispatched_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 PRIMARY KEY(run_id,ordinal)
);
CREATE INDEX assistant_run_steps_quota ON assistant_run_steps(provider_id,dispatched_at) WHERE ordinal>1;
CREATE TABLE workspace_change_sets (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
 connection_id uuid REFERENCES integration_connections ON DELETE CASCADE, grant_version text,
 context_id uuid REFERENCES assistant_contexts ON DELETE CASCADE, run_id uuid REFERENCES assistant_runs ON DELETE SET NULL,
 title text NOT NULL, space_ids uuid[] NOT NULL, request_hash text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','queued','applying','complete','partial','cancelled','undone')),
 version integer NOT NULL DEFAULT 1, preview jsonb, approved_at timestamptz, lease_until timestamptz,
 error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_change_sets_owner ON workspace_change_sets(owner_id,updated_at DESC);
CREATE INDEX workspace_change_sets_queue ON workspace_change_sets(created_at) WHERE status='queued';
CREATE TABLE workspace_change_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), set_id uuid NOT NULL REFERENCES workspace_change_sets ON DELETE CASCADE,
 key text NOT NULL, position integer NOT NULL, entity_id uuid NOT NULL DEFAULT gen_random_uuid(), data jsonb NOT NULL,
 selected boolean NOT NULL DEFAULT false, state text NOT NULL DEFAULT 'pending',
 before_data jsonb, prepared jsonb, result jsonb, error text,
 completed_at timestamptz, UNIQUE(set_id,key)
);
CREATE TABLE assistant_workflow_presets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
 space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE, name text NOT NULL, instructions text NOT NULL,
 destination_id uuid REFERENCES resources ON DELETE SET NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
UPDATE integration_approvals SET status='rejected',decided_at=now(),error='Review again under the all-writes approval policy.' WHERE status IN ('pending','approved');
ALTER TABLE audit_events ADD COLUMN change_set_id uuid;
CREATE FUNCTION axiom_audit_change_set() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.change_set_id := nullif(current_setting('axiom.change_set_id',true),'')::uuid; RETURN NEW; END $$;
CREATE TRIGGER axiom_audit_change_set BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION axiom_audit_change_set();
`;
