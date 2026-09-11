/** Additive lifecycle metadata. Never rewrites Markdown, CRDT state or resource trash. */
export const spaceLifecycleMigration = `
ALTER TABLE spaces ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','trashed','purging')),
 ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD COLUMN restore_state text NOT NULL DEFAULT 'active' CHECK(restore_state IN ('active','archived')),
 ADD COLUMN deleted_at timestamptz;
UPDATE spaces s SET status='archived' FROM projects p WHERE s.project_id=p.id AND p.archived_at IS NOT NULL;
CREATE TABLE space_lifecycle_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL,group_id uuid,actor_id text REFERENCES "user" ON DELETE SET NULL,action text NOT NULL,name text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX space_lifecycle_events_scope ON space_lifecycle_events(space_id,created_at DESC);
CREATE TABLE space_tombstones(space_id uuid PRIMARY KEY,group_id uuid,project_id uuid,deleted_by text REFERENCES "user" ON DELETE SET NULL,deleted_at timestamptz NOT NULL DEFAULT now(),counts jsonb NOT NULL DEFAULT '{}');
CREATE FUNCTION axiom_space_state(scope uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN s.status='purging' OR parent.status='purging' THEN 'purging'
 WHEN s.status='trashed' OR parent.status='trashed' THEN 'trashed'
 WHEN s.status='archived' OR parent.status='archived' THEN 'archived' ELSE 'active' END
 FROM spaces s LEFT JOIN spaces parent ON s.kind='project' AND parent.kind='team' AND parent.group_id=s.group_id WHERE s.id=scope;
$$;
CREATE FUNCTION axiom_base_space_role(who text,scope uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN s.kind='personal' THEN CASE WHEN s.owner_id=who THEN 'editor' END
 WHEN m.user_id IS NULL THEN NULL WHEN s.kind='team' OR p.audience='group' THEN coalesce(pm.role,m.content_role) ELSE pm.role END
 FROM spaces s LEFT JOIN members m ON m.group_id=s.group_id AND m.user_id=who
 LEFT JOIN projects p ON p.id=s.project_id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=who WHERE s.id=scope;
$$;
CREATE OR REPLACE FUNCTION axiom_space_role(who text,scope uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN axiom_space_state(scope) IN ('trashed','purging') THEN NULL
 WHEN axiom_space_state(scope)='archived' THEN CASE WHEN axiom_base_space_role(who,scope) IS NOT NULL THEN 'viewer' END
 ELSE axiom_base_space_role(who,scope) END;
$$;
CREATE TRIGGER axiom_space_lifecycle_access AFTER UPDATE OF status ON spaces FOR EACH STATEMENT EXECUTE FUNCTION axiom_revoke_connections();
`;
