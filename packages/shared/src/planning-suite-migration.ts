/** Additive planning metadata. Existing identities and document bytes are intact. */
export const planningSuiteMigration = `
ALTER TABLE task_dependencies ADD COLUMN lag_days integer NOT NULL DEFAULT 0 CHECK(lag_days BETWEEN -365 AND 365);
ALTER TABLE tasks ADD COLUMN progress_percent integer NOT NULL DEFAULT 0 CHECK(progress_percent BETWEEN 0 AND 100);
CREATE INDEX IF NOT EXISTS tasks_active_parent ON tasks(parent_id) WHERE deleted_at IS NULL;
CREATE TABLE planning_views (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,
 user_id text REFERENCES "user" ON DELETE CASCADE, name text NOT NULL, state jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX planning_views_scope ON planning_views(space_id,user_id);
CREATE TABLE planning_goals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,
 title text NOT NULL,body text NOT NULL DEFAULT '',owner_id text REFERENCES "user" ON DELETE SET NULL,due_on date,
 kind text NOT NULL CHECK(kind IN ('linked','metric')),target numeric NOT NULL DEFAULT 1 CHECK(target>0),current_value numeric NOT NULL DEFAULT 0 CHECK(current_value>=0),unit text NOT NULL DEFAULT '',
 task_ids uuid[] NOT NULL DEFAULT '{}',milestone_ids uuid[] NOT NULL DEFAULT '{}',archived boolean NOT NULL DEFAULT false,
 created_by text REFERENCES "user" ON DELETE SET NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX planning_goals_scope ON planning_goals(space_id,archived,updated_at DESC);
CREATE TABLE planning_intake (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,
 created_by text REFERENCES "user" ON DELETE SET NULL,kind text NOT NULL CHECK(kind IN ('research','experiment','paper-review','data-request')),
 title text NOT NULL,body text NOT NULL DEFAULT '',due_on date,priority text NOT NULL DEFAULT 'normal',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','needs-changes','accepted','rejected','withdrawn')),
 decision_note text NOT NULL DEFAULT '',reviewed_by text REFERENCES "user" ON DELETE SET NULL,task_id uuid REFERENCES tasks ON DELETE SET NULL,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX planning_intake_scope ON planning_intake(space_id,status,updated_at DESC);
CREATE TABLE planning_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,
 entity_id uuid NOT NULL,kind text NOT NULL,actor_id text REFERENCES "user" ON DELETE SET NULL,
 summary text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX planning_history_entity ON planning_history(space_id,entity_id,created_at DESC);
ALTER TABLE task_recurrences ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE schedule_previews ADD COLUMN capacity_context jsonb;
ALTER TABLE groups ADD COLUMN planning_context_version bigint NOT NULL DEFAULT 1;
CREATE FUNCTION axiom_planning_context_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid uuid; BEGIN
 gid:=coalesce(NEW.group_id,OLD.group_id);
 IF gid IS NOT NULL THEN UPDATE groups SET planning_context_version=planning_context_version+1 WHERE id=gid; END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER planning_context_space AFTER INSERT OR UPDATE OR DELETE ON spaces FOR EACH ROW EXECUTE FUNCTION axiom_planning_context_revision();
CREATE TRIGGER planning_context_member AFTER INSERT OR UPDATE OR DELETE ON members FOR EACH ROW EXECUTE FUNCTION axiom_planning_context_revision();
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('axiom_planning_audit()'::regprocedure);
 definition:=replace(definition,'''depends_on'',''resource_id''','''depends_on'',''lag_days'',''resource_id''');
 definition:=replace(definition,'''estimate_hours'',''labels''','''estimate_hours'',''progress_percent'',''labels''');
 EXECUTE definition;
END $$;
`;
