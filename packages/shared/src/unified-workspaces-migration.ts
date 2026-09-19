/** Forward-only unification. Content identities and CRDT bytes are never rewritten. */
export const unifiedWorkspacesMigration = `
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM spaces WHERE status='purging') OR EXISTS(SELECT 1 FROM workspace_jobs WHERE kind='purge-space' AND status IN ('queued','running')) OR EXISTS(SELECT 1 FROM trash_operations WHERE status IN ('queued','running')) THEN
  RAISE EXCEPTION 'Finish or cancel pending workspace deletion operations before upgrading.';
 END IF;
END $$;
ALTER TABLE groups ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN ('active','archived','trashed','purging')),
 ADD COLUMN lifecycle_restore_state text NOT NULL DEFAULT 'active', ADD COLUMN lifecycle_version integer NOT NULL DEFAULT 1;
UPDATE groups g SET lifecycle_status=s.status,lifecycle_restore_state=s.restore_state FROM spaces s WHERE s.group_id=g.id AND s.kind='team';
ALTER TABLE spaces ADD COLUMN name text NOT NULL DEFAULT '',ADD COLUMN description text NOT NULL DEFAULT '',ADD COLUMN color text NOT NULL DEFAULT 'blue',
 ADD COLUMN timezone text NOT NULL DEFAULT 'UTC',ADD COLUMN planning_calendar jsonb NOT NULL DEFAULT '{"workingDays":[1,2,3,4,5],"exceptions":[]}',ADD COLUMN planning_version integer NOT NULL DEFAULT 1;
UPDATE spaces s SET name=CASE WHEN s.kind='personal' THEN 'Personal space' WHEN s.kind='team' THEN g.name ELSE p.name END,
 description=coalesce(p.description,g.description,''),color=coalesce(p.color,'blue'),timezone=coalesce(p.timezone,pr.timezone,'UTC')
 FROM spaces origin LEFT JOIN groups g ON g.id=origin.group_id LEFT JOIN projects p ON p.id=origin.project_id LEFT JOIN user_profiles pr ON pr.user_id=origin.owner_id WHERE s.id=origin.id;
UPDATE spaces SET status='active',restore_state='active',deleted_at=NULL WHERE kind='team';
CREATE OR REPLACE FUNCTION axiom_space_state(scope uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN s.status='purging' OR g.lifecycle_status='purging' THEN 'purging'
 WHEN s.status='trashed' OR g.lifecycle_status='trashed' THEN 'trashed'
 WHEN s.status='archived' OR g.lifecycle_status='archived' THEN 'archived' ELSE 'active' END
 FROM spaces s LEFT JOIN groups g ON g.id=s.group_id WHERE s.id=scope;
$$;
CREATE TRIGGER axiom_group_lifecycle_access AFTER UPDATE OF lifecycle_status ON groups FOR EACH STATEMENT EXECUTE FUNCTION axiom_revoke_connections();
CREATE OR REPLACE FUNCTION axiom_new_space() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='user' THEN INSERT INTO spaces(kind,owner_id,name) VALUES('personal',NEW.id,'Personal space');
 ELSIF TG_TABLE_NAME='groups' THEN INSERT INTO spaces(kind,group_id,name,description) VALUES('team',NEW.id,NEW.name,NEW.description);
 ELSE
  INSERT INTO spaces(kind,group_id,project_id,name,description,color,timezone) VALUES('project',NEW.group_id,NEW.id,NEW.name,NEW.description,NEW.color,NEW.timezone);
  IF NEW.created_by IS NOT NULL THEN INSERT INTO project_members(project_id,user_id,can_manage) VALUES(NEW.id,NEW.created_by,true); END IF;
 END IF; RETURN NEW;
END $$;
ALTER TABLE tasks ADD COLUMN space_id uuid REFERENCES spaces ON DELETE CASCADE,ALTER COLUMN project_id DROP NOT NULL,
 ADD COLUMN position double precision NOT NULL DEFAULT 0;
ALTER TABLE project_milestones ADD COLUMN space_id uuid REFERENCES spaces ON DELETE CASCADE,ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE task_recurrences ADD COLUMN space_id uuid REFERENCES spaces ON DELETE CASCADE,ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE project_discussions ADD COLUMN space_id uuid REFERENCES spaces ON DELETE CASCADE,ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE review_requests ADD COLUMN space_id uuid REFERENCES spaces ON DELETE CASCADE;
UPDATE tasks t SET space_id=s.id FROM spaces s WHERE s.project_id=t.project_id;
UPDATE project_milestones t SET space_id=s.id FROM spaces s WHERE s.project_id=t.project_id;
UPDATE task_recurrences t SET space_id=s.id FROM spaces s WHERE s.project_id=t.project_id;
UPDATE project_discussions t SET space_id=s.id FROM spaces s WHERE s.project_id=t.project_id;
UPDATE review_requests t SET space_id=r.space_id FROM resources r WHERE r.id=coalesce(t.resource_id,t.note_id);
ALTER TABLE tasks ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE project_milestones ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE task_recurrences ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE project_discussions ALTER COLUMN space_id SET NOT NULL;
CREATE FUNCTION axiom_planning_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.space_id IS NULL AND NEW.project_id IS NOT NULL THEN SELECT id INTO NEW.space_id FROM spaces WHERE project_id=NEW.project_id; END IF;
 IF TG_TABLE_NAME='review_requests' AND NEW.space_id IS NULL THEN SELECT space_id INTO NEW.space_id FROM resources WHERE id=coalesce(NEW.resource_id,NEW.note_id); END IF;
 IF NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM spaces WHERE id=NEW.space_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'Planning scope mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER axiom_task_scope BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION axiom_planning_scope();
CREATE TRIGGER axiom_milestone_scope BEFORE INSERT OR UPDATE ON project_milestones FOR EACH ROW EXECUTE FUNCTION axiom_planning_scope();
CREATE TRIGGER axiom_recurrence_scope BEFORE INSERT OR UPDATE ON task_recurrences FOR EACH ROW EXECUTE FUNCTION axiom_planning_scope();
CREATE TRIGGER axiom_discussion_scope BEFORE INSERT OR UPDATE ON project_discussions FOR EACH ROW EXECUTE FUNCTION axiom_planning_scope();
CREATE TRIGGER axiom_review_scope BEFORE INSERT OR UPDATE ON review_requests FOR EACH ROW EXECUTE FUNCTION axiom_planning_scope();
CREATE INDEX tasks_space ON tasks(space_id,deleted_at,due_on,id);
CREATE INDEX milestones_space ON project_milestones(space_id,due_on,id);
CREATE INDEX discussions_space ON project_discussions(space_id,created_at,id);
CREATE TABLE task_resources(task_id uuid NOT NULL REFERENCES tasks ON DELETE CASCADE,resource_id uuid NOT NULL REFERENCES resources ON DELETE RESTRICT,PRIMARY KEY(task_id,resource_id));
INSERT INTO task_resources SELECT id,note_id FROM tasks WHERE note_id IS NOT NULL ON CONFLICT DO NOTHING;
CREATE TABLE schedule_previews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
 planning_version integer NOT NULL,plan jsonb NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',applied_at timestamptz,inverse jsonb,undone_at timestamptz);
CREATE INDEX schedule_previews_expiry ON schedule_previews(expires_at);
CREATE FUNCTION axiom_planning_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 UPDATE spaces SET planning_version=planning_version+1 WHERE id=coalesce(NEW.space_id,OLD.space_id);
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER axiom_task_revision AFTER INSERT OR UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION axiom_planning_revision();
CREATE TRIGGER axiom_milestone_revision AFTER INSERT OR UPDATE OR DELETE ON project_milestones FOR EACH ROW EXECUTE FUNCTION axiom_planning_revision();
CREATE FUNCTION axiom_dependency_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 UPDATE spaces SET planning_version=planning_version+1 WHERE id=(SELECT space_id FROM tasks WHERE id=coalesce(NEW.task_id,OLD.task_id));
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER axiom_dependency_revision AFTER INSERT OR UPDATE OR DELETE ON task_dependencies FOR EACH ROW EXECUTE FUNCTION axiom_dependency_revision();
CREATE FUNCTION axiom_planning_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oldv jsonb := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 newv jsonb := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 v jsonb := coalesce(newv,oldv); sid uuid; gid uuid; eid text; label text; fields text[]; etype text;
 actor text := nullif(current_setting('axiom.actor_id',true),''); beforev jsonb; afterv jsonb;
BEGIN
 IF TG_TABLE_NAME='spaces' THEN
  sid:=(v->>'id')::uuid; label:=v->>'name'; eid:=sid::text; etype:='workspace';
  UPDATE audit_scopes SET name=label WHERE space_id=sid;
  fields:=ARRAY['name','description','color','timezone','planning_calendar'];
 ELSIF TG_TABLE_NAME='groups' THEN
  gid:=(v->>'id')::uuid; eid:=gid::text; label:=v->>'name'; etype:='group';
  SELECT id INTO sid FROM spaces WHERE group_id=gid AND kind='team';
  UPDATE audit_scopes a SET name=s.name FROM spaces s WHERE a.space_id=s.id AND s.group_id=gid;
  fields:=ARRAY['lifecycle_status'];
 ELSIF TG_TABLE_NAME IN ('task_dependencies','task_resources') THEN
  eid:=v->>'task_id'; SELECT space_id,title INTO sid,label FROM tasks WHERE id=eid::uuid;
  etype:='task'; fields:=ARRAY['task_id','depends_on','resource_id'];
 ELSE
  sid:=(v->>'space_id')::uuid; eid:=v->>'id'; label:=v->>'title';
  etype:=CASE WHEN TG_TABLE_NAME='tasks' THEN 'task' ELSE 'milestone' END;
  fields:=ARRAY['title','status','priority','parent_id','assignee_id','start_on','due_on','estimate_hours','labels','milestone_id','deleted_at','completed_at'];
 END IF;
 IF sid IS NULL THEN RETURN coalesce(NEW,OLD); END IF;
 SELECT group_id INTO gid FROM spaces WHERE id=sid;
 beforev:=CASE WHEN oldv IS NULL THEN NULL ELSE axiom_audit_fields(oldv,fields) END;
 afterv:=CASE WHEN newv IS NULL THEN NULL ELSE axiom_audit_fields(newv,fields) END;
 IF TG_OP='UPDATE' AND beforev IS NOT DISTINCT FROM afterv THEN RETURN NEW; END IF;
 INSERT INTO audit_events(actor_id,actor_name,space_id,group_id,entity_id,entity_type,entity_name,action,before_values,after_values,operation_id,administrative)
 VALUES(actor,coalesce((SELECT name FROM "user" WHERE id=actor),'System'),sid,gid,eid,etype,coalesce(label,'Planning item'),
 CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'DELETE' THEN 'remove' ELSE 'update' END,beforev,afterv,nullif(current_setting('axiom.operation_id',true),'')::uuid,TG_TABLE_NAME='groups');
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER zz_planning_audit AFTER INSERT OR UPDATE ON spaces FOR EACH ROW EXECUTE FUNCTION axiom_planning_audit();
CREATE TRIGGER zz_planning_audit AFTER UPDATE ON groups FOR EACH ROW EXECUTE FUNCTION axiom_planning_audit();
CREATE TRIGGER zz_planning_audit AFTER INSERT OR UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION axiom_planning_audit();
CREATE TRIGGER zz_planning_audit AFTER INSERT OR UPDATE OR DELETE ON project_milestones FOR EACH ROW EXECUTE FUNCTION axiom_planning_audit();
CREATE TRIGGER zz_planning_audit AFTER INSERT OR UPDATE OR DELETE ON task_dependencies FOR EACH ROW EXECUTE FUNCTION axiom_planning_audit();
CREATE TRIGGER zz_planning_audit AFTER INSERT OR UPDATE OR DELETE ON task_resources FOR EACH ROW EXECUTE FUNCTION axiom_planning_audit();
UPDATE audit_scopes a SET name=s.name FROM spaces s WHERE a.space_id=s.id;
`;
