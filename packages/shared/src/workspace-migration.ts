/** Additive workspace migration. Existing note content, identities and generations are untouched. */
export const workspaceMigration = `
ALTER TABLE members ADD COLUMN content_role text NOT NULL DEFAULT 'editor' CHECK(content_role IN ('viewer','commenter','editor'));
ALTER TABLE projects ADD COLUMN audience text NOT NULL DEFAULT 'group' CHECK(audience IN ('group','restricted')),
 ADD COLUMN created_by text REFERENCES "user", ADD COLUMN timezone text NOT NULL DEFAULT 'UTC',
 ADD COLUMN archived_at timestamptz, ADD COLUMN version integer NOT NULL DEFAULT 1;
UPDATE projects p SET created_by=(SELECT m.user_id FROM members m WHERE m.group_id=p.group_id AND m.role='owner' LIMIT 1);
ALTER TABLE projects ALTER COLUMN audience SET DEFAULT 'restricted';
CREATE TABLE project_members (project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,role text NOT NULL DEFAULT 'editor' CHECK(role IN ('viewer','commenter','editor')),can_manage boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,user_id));
INSERT INTO project_members(project_id,user_id,can_manage) SELECT id,created_by,true FROM projects WHERE created_by IS NOT NULL;
CREATE TABLE spaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('personal','team','project')),owner_id text REFERENCES "user" ON DELETE CASCADE,group_id uuid REFERENCES groups ON DELETE CASCADE,project_id uuid REFERENCES projects ON DELETE CASCADE,quota_bytes bigint CHECK(quota_bytes IS NULL OR quota_bytes>=0),created_at timestamptz NOT NULL DEFAULT now(),CHECK((kind='personal' AND owner_id IS NOT NULL AND group_id IS NULL AND project_id IS NULL) OR (kind='team' AND owner_id IS NULL AND group_id IS NOT NULL AND project_id IS NULL) OR (kind='project' AND owner_id IS NULL AND group_id IS NOT NULL AND project_id IS NOT NULL)));
CREATE UNIQUE INDEX spaces_personal ON spaces(owner_id) WHERE kind='personal';
CREATE UNIQUE INDEX spaces_team ON spaces(group_id) WHERE kind='team';
CREATE UNIQUE INDEX spaces_project ON spaces(project_id) WHERE kind='project';
INSERT INTO spaces(kind,owner_id) SELECT 'personal',id FROM "user";
INSERT INTO spaces(kind,group_id) SELECT 'team',id FROM groups;
INSERT INTO spaces(kind,group_id,project_id) SELECT 'project',group_id,id FROM projects;
CREATE FUNCTION axiom_new_space() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='user' THEN INSERT INTO spaces(kind,owner_id) VALUES('personal',NEW.id);
 ELSIF TG_TABLE_NAME='groups' THEN INSERT INTO spaces(kind,group_id) VALUES('team',NEW.id);
 ELSE
  INSERT INTO spaces(kind,group_id,project_id) VALUES('project',NEW.group_id,NEW.id);
  IF NEW.created_by IS NOT NULL THEN INSERT INTO project_members(project_id,user_id,can_manage) VALUES(NEW.id,NEW.created_by,true); END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER axiom_user_space AFTER INSERT ON "user" FOR EACH ROW EXECUTE FUNCTION axiom_new_space();
CREATE TRIGGER axiom_group_space AFTER INSERT ON groups FOR EACH ROW EXECUTE FUNCTION axiom_new_space();
CREATE TRIGGER axiom_project_space AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION axiom_new_space();

-- group_id remains legacy provenance for citation contexts, not personal ownership.
ALTER TABLE notes DROP CONSTRAINT notes_group_id_fkey, ALTER COLUMN group_id DROP NOT NULL;
ALTER TABLE notes ADD CONSTRAINT notes_group_id_fkey FOREIGN KEY(group_id) REFERENCES groups ON DELETE SET NULL;
ALTER TABLE attachments ALTER COLUMN note_id DROP NOT NULL;
CREATE TABLE resources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,parent_id uuid REFERENCES resources DEFERRABLE INITIALLY DEFERRED,kind text NOT NULL CHECK(kind IN ('folder','note','file')),name text NOT NULL,description text NOT NULL DEFAULT '',owner_id text NOT NULL REFERENCES "user",note_id uuid UNIQUE REFERENCES notes ON DELETE CASCADE,current_version_id uuid,version integer NOT NULL DEFAULT 1,tags text[] NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,CHECK((kind='note' AND note_id=id) OR (kind<>'note' AND note_id IS NULL)));
CREATE INDEX resources_parent ON resources(space_id,parent_id,updated_at DESC,id);
CREATE INDEX resources_name ON resources USING gin(lower(name) gin_trgm_ops);
INSERT INTO resources(id,space_id,parent_id,kind,name,owner_id,note_id,version,tags,created_at,updated_at,deleted_at)
 SELECT n.id,s.id,n.parent_id,'note',n.title,n.author_id,n.id,n.version,n.tags,n.created_at,n.updated_at,n.deleted_at FROM notes n JOIN spaces s ON
 (n.visibility='private' AND s.kind='personal' AND s.owner_id=n.author_id) OR
 (n.visibility='shared' AND n.project_id IS NOT NULL AND s.kind='project' AND s.project_id=n.project_id) OR
 (n.visibility='shared' AND n.project_id IS NULL AND s.kind='team' AND s.group_id=n.group_id);
CREATE TABLE file_versions (id uuid PRIMARY KEY REFERENCES attachments ON DELETE RESTRICT,resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,ordinal integer NOT NULL,created_by text REFERENCES "user",created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(resource_id,ordinal));
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE resources ADD CONSTRAINT resources_current_version FOREIGN KEY(current_version_id) REFERENCES file_versions DEFERRABLE INITIALLY DEFERRED;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO resources(id,space_id,parent_id,kind,name,owner_id,current_version_id,created_at,updated_at)
 SELECT a.id,r.space_id,r.id,'file',a.name,r.owner_id,a.id,a.created_at,a.created_at FROM attachments a JOIN resources r ON r.note_id=a.note_id;
INSERT INTO file_versions(id,resource_id,ordinal,created_by,created_at) SELECT a.id,a.id,1,r.owner_id,a.created_at FROM attachments a JOIN resources r ON r.id=a.id;
CREATE TABLE resource_favorites(user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,PRIMARY KEY(user_id,resource_id));
INSERT INTO resource_favorites SELECT user_id,note_id FROM favorites;
CREATE TABLE resource_recents(user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,opened_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,resource_id));
CREATE TABLE saved_views(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,name text NOT NULL,filters jsonb NOT NULL,version integer NOT NULL DEFAULT 1);
CREATE TABLE resource_references(source_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,version_id uuid NOT NULL REFERENCES file_versions ON DELETE RESTRICT,snapshot_id uuid REFERENCES snapshots ON DELETE CASCADE,PRIMARY KEY(source_id,version_id));
CREATE TABLE personal_citations(note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE,cite_key text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(note_id,cite_key));
INSERT INTO personal_citations SELECT n.id,b.cite_key,to_jsonb(b) FROM notes n JOIN bibliography b ON b.group_id=n.group_id WHERE n.visibility='private';
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

CREATE FUNCTION axiom_space_role(who text,scope uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN s.kind='personal' THEN CASE WHEN s.owner_id=who THEN 'editor' END
  WHEN m.user_id IS NULL THEN NULL
  WHEN s.kind='team' OR p.audience='group' THEN coalesce(pm.role,m.content_role)
  ELSE pm.role END
 FROM spaces s LEFT JOIN members m ON m.group_id=s.group_id AND m.user_id=who
 LEFT JOIN projects p ON p.id=s.project_id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=who WHERE s.id=scope;
$$;
CREATE FUNCTION axiom_manage_space(who text,scope uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce((s.kind='personal' AND s.owner_id=who) OR m.role IN ('owner','admin') OR (m.user_id IS NOT NULL AND pm.can_manage),false)
 FROM spaces s LEFT JOIN members m ON m.group_id=s.group_id AND m.user_id=who LEFT JOIN project_members pm ON pm.project_id=s.project_id AND pm.user_id=who WHERE s.id=scope;
$$;
CREATE FUNCTION axiom_can_read_note(who text,note uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM resources r WHERE r.note_id=note AND axiom_space_role(who,r.space_id) IS NOT NULL) $$;
CREATE FUNCTION axiom_can_read_attachment(who text,attachment uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM file_versions v JOIN resources r ON r.id=v.resource_id WHERE v.id=attachment AND axiom_space_role(who,r.space_id) IS NOT NULL) $$;
CREATE FUNCTION axiom_resource_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE parent resources%ROWTYPE; BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(NEW.space_id::text));
 IF NEW.parent_id IS NOT NULL THEN
 SELECT * INTO parent FROM resources WHERE id=NEW.parent_id;
 IF NOT FOUND OR parent.space_id<>NEW.space_id OR parent.kind='file' OR parent.deleted_at IS NOT NULL OR EXISTS(WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM resources WHERE id=NEW.parent_id UNION SELECT r.id,r.parent_id FROM resources r JOIN ancestors a ON r.id=a.parent_id) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'Invalid resource hierarchy' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.space_id IS DISTINCT FROM OLD.space_id AND EXISTS(SELECT 1 FROM resources WHERE parent_id=NEW.id AND space_id<>NEW.space_id) THEN RAISE EXCEPTION 'Move the complete hierarchy together' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER axiom_resource_hierarchy BEFORE INSERT OR UPDATE OF parent_id,space_id ON resources FOR EACH ROW EXECUTE FUNCTION axiom_resource_hierarchy();
CREATE OR REPLACE FUNCTION axiom_validate_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE parent notes%ROWTYPE; BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(coalesce(NEW.group_id::text,NEW.author_id)));
 IF NEW.parent_id IS NOT NULL THEN SELECT * INTO parent FROM notes WHERE id=NEW.parent_id;
 IF NOT FOUND OR parent.visibility<>NEW.visibility OR (NEW.visibility='private' AND parent.author_id<>NEW.author_id) OR (NEW.visibility='shared' AND (parent.group_id IS DISTINCT FROM NEW.group_id OR parent.project_id IS DISTINCT FROM NEW.project_id)) OR EXISTS(WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM notes WHERE id=NEW.parent_id UNION SELECT n.id,n.parent_id FROM notes n JOIN ancestors a ON n.id=a.parent_id) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'Invalid note hierarchy' USING ERRCODE='23514'; END IF; END IF; RETURN NEW; END $$;
CREATE FUNCTION axiom_index_note_resource() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE scope uuid; BEGIN
 IF current_setting('axiom.resource_write',true)='1' THEN RETURN NEW; END IF;
 SELECT id INTO scope FROM spaces WHERE (NEW.visibility='private' AND kind='personal' AND owner_id=NEW.author_id) OR (NEW.visibility='shared' AND NEW.project_id IS NOT NULL AND kind='project' AND project_id=NEW.project_id) OR (NEW.visibility='shared' AND NEW.project_id IS NULL AND kind='team' AND group_id=NEW.group_id);
 INSERT INTO resources(id,space_id,parent_id,kind,name,owner_id,note_id,version,tags,created_at,updated_at,deleted_at) VALUES(NEW.id,scope,NEW.parent_id,'note',NEW.title,NEW.author_id,NEW.id,NEW.version,NEW.tags,NEW.created_at,NEW.updated_at,NEW.deleted_at)
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,tags=excluded.tags,version=resources.version+1,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at;
 IF TG_OP='UPDATE' AND (NEW.parent_id IS DISTINCT FROM OLD.parent_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.visibility IS DISTINCT FROM OLD.visibility) THEN UPDATE resources SET space_id=scope,parent_id=NEW.parent_id WHERE id=NEW.id; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER axiom_note_resource AFTER INSERT OR UPDATE OF title,parent_id,project_id,visibility,tags,deleted_at ON notes FOR EACH ROW EXECUTE FUNCTION axiom_index_note_resource();
CREATE FUNCTION axiom_index_attachment_resource() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE n resources%ROWTYPE; BEGIN
 IF NEW.note_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO n FROM resources WHERE note_id=NEW.note_id;
 INSERT INTO resources(id,space_id,parent_id,kind,name,owner_id,current_version_id,created_at,updated_at) VALUES(NEW.id,n.space_id,n.id,'file',NEW.name,n.owner_id,NEW.id,NEW.created_at,NEW.created_at);
 INSERT INTO file_versions(id,resource_id,ordinal,created_by,created_at) VALUES(NEW.id,NEW.id,1,n.owner_id,NEW.created_at); RETURN NEW; END $$;
CREATE TRIGGER axiom_attachment_resource AFTER INSERT ON attachments FOR EACH ROW EXECUTE FUNCTION axiom_index_attachment_resource();

CREATE TABLE upload_sessions(id uuid PRIMARY KEY,owner_id text NOT NULL REFERENCES "user",space_id uuid NOT NULL REFERENCES spaces,parent_id uuid REFERENCES resources,resource_id uuid REFERENCES resources,name text NOT NULL,bytes bigint NOT NULL CHECK(bytes>0 AND bytes<=1000000000),status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','verifying','complete','cancelled','failed')),storage_key uuid NOT NULL,multipart_id text,sha256 text,error text,completed_resource_id uuid REFERENCES resources,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX upload_sessions_owner ON upload_sessions(owner_id,status);
CREATE TABLE upload_chunks(upload_id uuid NOT NULL REFERENCES upload_sessions ON DELETE CASCADE,part integer NOT NULL CHECK(part>=1),bytes integer NOT NULL,sha256 text NOT NULL,etag text,PRIMARY KEY(upload_id,part));
CREATE TABLE file_derivatives(version_id uuid NOT NULL REFERENCES file_versions ON DELETE CASCADE,kind text NOT NULL,storage_key uuid NOT NULL,mime text NOT NULL,bytes bigint NOT NULL,PRIMARY KEY(version_id,kind));
CREATE TABLE workspace_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,dedupe_key text UNIQUE,payload jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','failed')),attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),leased_until timestamptz,error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX workspace_jobs_ready ON workspace_jobs(status,available_at);
CREATE TABLE workspace_activity(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,actor_id text REFERENCES "user",kind text NOT NULL,title text NOT NULL,resource_id uuid REFERENCES resources ON DELETE SET NULL,task_id uuid,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX workspace_activity_scope ON workspace_activity(space_id,created_at DESC);
CREATE TABLE inbox_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,kind text NOT NULL,title text NOT NULL,resource_id uuid REFERENCES resources ON DELETE SET NULL,task_id uuid,read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),dedupe_key text UNIQUE);
CREATE INDEX inbox_events_user ON inbox_events(user_id,created_at DESC);
CREATE TABLE user_profiles(user_id text PRIMARY KEY REFERENCES "user" ON DELETE CASCADE,affiliation text NOT NULL DEFAULT '',interests text NOT NULL DEFAULT '',biography text NOT NULL DEFAULT '',links jsonb NOT NULL DEFAULT '[]',timezone text NOT NULL DEFAULT 'UTC',weekly_capacity numeric NOT NULL DEFAULT 40,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE notification_preferences(user_id text PRIMARY KEY REFERENCES "user" ON DELETE CASCADE,data jsonb NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1);
CREATE TABLE project_milestones(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,title text NOT NULL,due_on date,completed_at timestamptz,version integer NOT NULL DEFAULT 1);
CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,parent_id uuid REFERENCES tasks,created_by text NOT NULL REFERENCES "user",title text NOT NULL,body text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','in_review','done','cancelled')),priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),assignee_id text REFERENCES "user",start_on date,due_on date,estimate_hours numeric CHECK(estimate_hours>=0 AND estimate_hours<=10000),labels text[] NOT NULL DEFAULT '{}',milestone_id uuid REFERENCES project_milestones ON DELETE SET NULL,note_id uuid REFERENCES notes ON DELETE SET NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,CHECK(start_on IS NULL OR due_on IS NULL OR start_on<=due_on));
CREATE INDEX tasks_project ON tasks(project_id,deleted_at,status,due_on);
CREATE INDEX tasks_assignee ON tasks(assignee_id,due_on);
CREATE TABLE task_dependencies(task_id uuid NOT NULL REFERENCES tasks ON DELETE CASCADE,depends_on uuid NOT NULL REFERENCES tasks ON DELETE CASCADE,PRIMARY KEY(task_id,depends_on),CHECK(task_id<>depends_on));
CREATE TABLE task_recurrences(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,created_by text NOT NULL REFERENCES "user",rule jsonb NOT NULL,template jsonb NOT NULL,last_date date,enabled boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1);
CREATE TABLE task_occurrences(recurrence_id uuid NOT NULL REFERENCES task_recurrences ON DELETE CASCADE,occurs_on date NOT NULL,task_id uuid NOT NULL REFERENCES tasks ON DELETE CASCADE,PRIMARY KEY(recurrence_id,occurs_on));
CREATE TABLE project_discussions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,task_id uuid REFERENCES tasks ON DELETE CASCADE,parent_id uuid REFERENCES project_discussions ON DELETE CASCADE,author_id text NOT NULL REFERENCES "user",body text NOT NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz);
CREATE TABLE review_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE,snapshot_id uuid NOT NULL REFERENCES snapshots ON DELETE RESTRICT,requested_by text NOT NULL REFERENCES "user",reviewer_id text NOT NULL REFERENCES "user",status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','changes_requested','cancelled')),message text NOT NULL DEFAULT '',response text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE workspace_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,name text NOT NULL,description text NOT NULL DEFAULT '',body text NOT NULL,created_by text NOT NULL REFERENCES "user",version integer NOT NULL DEFAULT 1);
CREATE TABLE workspace_mutations(user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,id uuid NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,id));
`;
