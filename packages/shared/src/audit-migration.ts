/** Immutable metadata only. Bodies remain in separately retained, authorized versions. */
export const auditMigration = `
CREATE TABLE audit_scopes (
 space_id uuid PRIMARY KEY, group_id uuid, project_id uuid, owner_id text,
 name text NOT NULL, kind text NOT NULL, final_readers text[] NOT NULL DEFAULT '{}',
 purged_at timestamptz
);
CREATE TABLE audit_group_owners(group_id uuid PRIMARY KEY, owner_id text NOT NULL);
CREATE TABLE audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_id text, actor_name text NOT NULL DEFAULT 'System', contributors text[] NOT NULL DEFAULT '{}',
 space_id uuid, group_id uuid, entity_id text NOT NULL, entity_type text NOT NULL,
 entity_name text NOT NULL, action text NOT NULL, before_values jsonb, after_values jsonb,
 operation_id uuid, version_id uuid, private_user_id text, administrative boolean NOT NULL DEFAULT false,
 evidence text NOT NULL DEFAULT 'recorded', legacy_key text UNIQUE
);
CREATE INDEX audit_events_timeline ON audit_events(created_at DESC,id DESC);
CREATE INDEX audit_events_scope ON audit_events(space_id,id DESC);
CREATE INDEX audit_events_entity ON audit_events(entity_id,id DESC);
CREATE INDEX audit_events_actor ON audit_events(actor_id,id DESC);
CREATE TABLE document_checkpoint_pending (
 note_id uuid PRIMARY KEY REFERENCES notes ON DELETE CASCADE,
 first_edit_at timestamptz NOT NULL DEFAULT now(), last_edit_at timestamptz NOT NULL DEFAULT now(),
 contributors text[] NOT NULL DEFAULT '{}'
);
ALTER TABLE snapshots ADD COLUMN contributors text[] NOT NULL DEFAULT '{}';
CREATE FUNCTION axiom_checkpoint_pending() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE who text := nullif(current_setting('axiom.actor_id',true),''); nid uuid;
BEGIN
 SELECT id INTO nid FROM notes WHERE id::text=split_part(NEW.room,':',1) AND generation::text=split_part(NEW.room,':',2);
 IF nid IS NOT NULL THEN
   INSERT INTO document_checkpoint_pending(note_id,contributors) VALUES(nid,CASE WHEN who IS NULL THEN '{}'::text[] ELSE ARRAY[who] END)
   ON CONFLICT(note_id) DO UPDATE SET last_edit_at=now(),
     contributors=ARRAY(SELECT DISTINCT unnest(document_checkpoint_pending.contributors||EXCLUDED.contributors));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER axiom_checkpoint_pending AFTER INSERT ON document_updates FOR EACH ROW EXECUTE FUNCTION axiom_checkpoint_pending();
INSERT INTO document_checkpoint_pending(note_id,first_edit_at,last_edit_at)
 SELECT n.id,min(u.created_at),max(u.created_at) FROM document_updates u JOIN notes n ON u.room=n.id::text||':'||n.generation::text GROUP BY n.id;
ALTER TABLE resources ADD COLUMN deleted_by text;
ALTER TABLE trash_operations ADD COLUMN destination_id uuid,
 ADD COLUMN target_kind text NOT NULL DEFAULT 'files' CHECK(target_kind IN ('files','workspaces')),
 ADD COLUMN conflict_policy text NOT NULL DEFAULT 'keep-both' CHECK(conflict_policy IN ('keep-both','skip'));

INSERT INTO audit_scopes(space_id,group_id,project_id,owner_id,name,kind)
 SELECT s.id,s.group_id,s.project_id,s.owner_id,coalesce(p.name,g.name,'Personal space'),s.kind
 FROM spaces s LEFT JOIN projects p ON p.id=s.project_id LEFT JOIN groups g ON g.id=s.group_id;

CREATE FUNCTION axiom_audit_fields(value jsonb, fields text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(jsonb_object_agg(key,val),'{}') FROM jsonb_each(value) AS j(key,val) WHERE key=ANY(fields);
$$;
CREATE FUNCTION axiom_audit_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 oldv jsonb := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 newv jsonb := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 v jsonb := coalesce(newv,oldv); fields text[]; sid uuid; gid uuid; eid text; etype text; label text;
 actor text := nullif(current_setting('axiom.actor_id',true),''); actorname text;
 privatewho text; adminonly boolean := false; verb text := lower(TG_OP); vid uuid;
 people text[] := '{}'; beforev jsonb; afterv jsonb;
BEGIN
 IF TG_TABLE_NAME='resources' THEN
   sid := (v->>'space_id')::uuid; eid := v->>'id'; etype := v->>'kind'; label := v->>'name';
   fields := ARRAY['name','description','tags','parent_id','space_id','deleted_at','current_version_id','shortcut_target_id'];
   IF TG_OP='UPDATE' THEN
     IF oldv->>'deleted_at' IS NULL AND newv->>'deleted_at' IS NOT NULL THEN
       NEW.deleted_by := actor; newv := to_jsonb(NEW); verb := 'trash';
     ELSIF oldv->>'deleted_at' IS NOT NULL AND newv->>'deleted_at' IS NULL THEN verb := 'restore';
     ELSIF oldv->'name' IS DISTINCT FROM newv->'name' THEN verb := 'rename';
     ELSIF oldv->'parent_id' IS DISTINCT FROM newv->'parent_id' OR oldv->'space_id' IS DISTINCT FROM newv->'space_id' THEN verb := 'move';
     ELSIF oldv->'current_version_id' IS DISTINCT FROM newv->'current_version_id' THEN verb := 'replace'; END IF;
   END IF;
 ELSIF TG_TABLE_NAME='spaces' THEN
   sid := (v->>'id')::uuid; gid := (v->>'group_id')::uuid; eid := sid::text; etype := 'workspace';
   SELECT coalesce(p.name,g.name,'Personal space') INTO label FROM (SELECT 1) x
     LEFT JOIN projects p ON p.id=(v->>'project_id')::uuid LEFT JOIN groups g ON g.id=gid;
   fields := ARRAY['status','quota_bytes','restore_state'];
   INSERT INTO audit_scopes(space_id,group_id,project_id,owner_id,name,kind,final_readers,purged_at)
   VALUES(sid,gid,(v->>'project_id')::uuid,v->>'owner_id',label,v->>'kind',
     ARRAY(SELECT user_id FROM members WHERE group_id=gid AND axiom_base_space_role(user_id,sid) IS NOT NULL),
     CASE WHEN TG_OP='DELETE' THEN now() END)
   ON CONFLICT(space_id) DO UPDATE SET name=EXCLUDED.name,
     final_readers=CASE WHEN audit_scopes.purged_at IS NOT NULL THEN audit_scopes.final_readers ELSE EXCLUDED.final_readers END,
     purged_at=EXCLUDED.purged_at;
   IF TG_OP='UPDATE' AND oldv->'status' IS DISTINCT FROM newv->'status' THEN verb := newv->>'status'; END IF;
 ELSIF TG_TABLE_NAME IN ('groups','projects') THEN
   gid := CASE WHEN TG_TABLE_NAME='groups' THEN (v->>'id')::uuid ELSE (v->>'group_id')::uuid END;
   eid := v->>'id'; etype := CASE WHEN TG_TABLE_NAME='groups' THEN 'group' ELSE 'project' END; label := v->>'name';
   SELECT id INTO sid FROM spaces WHERE (TG_TABLE_NAME='groups' AND group_id=gid AND kind='team') OR (TG_TABLE_NAME='projects' AND project_id=eid::uuid) LIMIT 1;
   fields := ARRAY['name','description','color','audience','timezone'];
   UPDATE audit_scopes SET name=label WHERE space_id=sid;
   IF TG_TABLE_NAME='groups' AND TG_OP='DELETE' THEN
     INSERT INTO audit_group_owners SELECT gid,user_id FROM members WHERE group_id=gid AND role='owner'
       ON CONFLICT(group_id) DO UPDATE SET owner_id=EXCLUDED.owner_id;
   END IF;
   IF TG_OP='UPDATE' AND oldv->'name' IS DISTINCT FROM newv->'name' THEN verb := 'rename'; END IF;
 ELSIF TG_TABLE_NAME IN ('members','project_members','invitations','tool_providers') THEN
   gid := (v->>'group_id')::uuid;
   IF TG_TABLE_NAME='project_members' THEN SELECT group_id,id INTO gid,sid FROM spaces WHERE project_id=(v->>'project_id')::uuid; END IF;
   IF sid IS NULL THEN SELECT id INTO sid FROM spaces WHERE group_id=gid AND kind='team'; END IF;
   eid := coalesce(v->>'id',coalesce(v->>'project_id',v->>'group_id')||':'||(v->>'user_id'));
   etype := CASE TG_TABLE_NAME WHEN 'tool_providers' THEN 'integration' WHEN 'invitations' THEN 'invitation' ELSE 'membership' END;
   label := coalesce(v->>'name',v->>'email',(SELECT name FROM "user" WHERE id=v->>'user_id'),'Member');
   fields := ARRAY['role','content_role','can_manage','email','expires_at','accepted_at','revoked_at','name','kind','model','capabilities','enabled','daily_limit'];
   adminonly := true;
   -- Credentials and endpoint query strings are never copied to the log.
   IF TG_TABLE_NAME='tool_providers' AND TG_OP='UPDATE' AND oldv->'credential' IS DISTINCT FROM newv->'credential' THEN verb := 'credential-rotated'; END IF;
 ELSIF TG_TABLE_NAME IN ('resource_favorites','resource_personalization') THEN
   eid := v->>'resource_id'; privatewho := v->>'user_id';
   SELECT space_id,name INTO sid,label FROM resources WHERE id=eid::uuid;
   etype := CASE WHEN TG_TABLE_NAME='resource_favorites' THEN 'favorite' ELSE 'folder-color' END;
   fields := ARRAY['color'];
 ELSIF TG_TABLE_NAME='snapshots' THEN
   IF TG_OP='DELETE' THEN RETURN OLD; END IF;
   eid := v->>'note_id'; vid := (v->>'id')::uuid; etype := 'document-version'; label := v->>'title';
   SELECT space_id INTO sid FROM resources WHERE note_id=eid::uuid;
   fields := ARRAY['title','label','generation']; actor := coalesce(actor,v->>'author_id');
   SELECT ARRAY(SELECT jsonb_array_elements_text(v->'contributors')) INTO people;
   verb := CASE WHEN v->>'label' IS NULL THEN 'checkpoint' ELSE 'named-version' END;
 ELSIF TG_TABLE_NAME='file_versions' THEN
   eid := v->>'resource_id'; vid := (v->>'id')::uuid; etype := 'file-version';
   SELECT space_id,name INTO sid,label FROM resources WHERE id=eid::uuid;
   fields := ARRAY['ordinal']; actor := coalesce(actor,v->>'created_by');
   verb := CASE WHEN TG_OP='DELETE' THEN 'remove-version' ELSE 'file-version' END;
 ELSIF TG_TABLE_NAME='notes' THEN
   IF TG_OP<>'UPDATE' OR oldv->'generation'=newv->'generation' THEN RETURN coalesce(NEW,OLD); END IF;
   eid := v->>'id'; etype := 'note'; label := v->>'title'; fields := ARRAY['generation']; verb := 'restore-version';
   SELECT space_id INTO sid FROM resources WHERE note_id=eid::uuid;
 ELSE RETURN coalesce(NEW,OLD);
 END IF;
 IF gid IS NULL THEN SELECT group_id INTO gid FROM audit_scopes WHERE space_id=sid; END IF;
 beforev := CASE WHEN oldv IS NULL THEN NULL ELSE axiom_audit_fields(oldv,fields) END;
 afterv := CASE WHEN newv IS NULL THEN NULL ELSE axiom_audit_fields(newv,fields) END;
 IF TG_OP='UPDATE' AND beforev IS NOT DISTINCT FROM afterv AND verb<>'credential-rotated' THEN RETURN NEW; END IF;
 SELECT name INTO actorname FROM "user" WHERE id=actor;
 INSERT INTO audit_events(actor_id,actor_name,contributors,space_id,group_id,entity_id,entity_type,entity_name,action,before_values,after_values,operation_id,version_id,private_user_id,administrative)
 VALUES(actor,coalesce(actorname,CASE WHEN cardinality(people)>0 THEN 'Collaborators' ELSE 'System' END),people,sid,gid,eid,etype,coalesce(label,'Unavailable item'),
 CASE verb WHEN 'insert' THEN 'create' WHEN 'delete' THEN 'purge' ELSE verb END,beforev,afterv,
 nullif(current_setting('axiom.operation_id',true),'')::uuid,vid,privatewho,adminonly);
 RETURN coalesce(NEW,OLD);
END $$;
${["resources", "spaces", "groups", "projects", "members", "project_members", "invitations", "tool_providers", "resource_favorites", "resource_personalization", "snapshots", "file_versions", "notes"].map((table) => `CREATE TRIGGER audit_capture AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION axiom_audit_capture();`).join("\n")}
CREATE FUNCTION axiom_audit_preserve_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='groups' THEN
   INSERT INTO audit_group_owners SELECT OLD.id,user_id FROM members WHERE group_id=OLD.id AND role='owner'
     ON CONFLICT(group_id) DO UPDATE SET owner_id=EXCLUDED.owner_id;
 END IF;
 UPDATE audit_scopes a SET purged_at=now(),final_readers=ARRAY(
   SELECT user_id FROM members WHERE group_id=a.group_id AND axiom_base_space_role(user_id,a.space_id) IS NOT NULL)
 WHERE a.purged_at IS NULL AND CASE TG_TABLE_NAME WHEN 'groups' THEN a.group_id=OLD.id
   WHEN 'projects' THEN a.project_id=OLD.id ELSE a.space_id=OLD.id END;
 RETURN OLD;
END $$;
${["spaces", "groups", "projects"].map((table) => `CREATE TRIGGER aaa_audit_preserve BEFORE DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION axiom_audit_preserve_scope();`).join("\n")}
CREATE FUNCTION axiom_resource_deleted_actor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN NEW.deleted_by := nullif(current_setting('axiom.actor_id',true),''); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER axiom_resource_deleted_actor BEFORE UPDATE OF deleted_at ON resources FOR EACH ROW EXECUTE FUNCTION axiom_resource_deleted_actor();

-- Actual older evidence only; no invented before/after values or attribution.
INSERT INTO audit_events(created_at,actor_id,actor_name,space_id,group_id,entity_id,entity_type,entity_name,action,evidence,legacy_key,administrative)
 SELECT a.created_at,a.actor_id,coalesce(u.name,'Unknown'),a.space_id,s.group_id,coalesce(a.resource_id::text,a.space_id::text),
 CASE WHEN a.resource_id IS NULL THEN 'activity' ELSE 'legacy-resource' END,a.title,a.kind,'legacy-summary','activity:'||a.id,a.kind ~* '(member|invit|owner|provider|admin)'
 FROM workspace_activity a JOIN spaces s ON s.id=a.space_id LEFT JOIN "user" u ON u.id=a.actor_id;
INSERT INTO audit_events(created_at,actor_id,actor_name,space_id,group_id,entity_id,entity_type,entity_name,action,evidence,legacy_key)
 SELECT a.created_at,a.actor_id,coalesce(u.name,'Unknown'),a.space_id,a.group_id,a.space_id::text,'workspace',a.name,a.action,'legacy-summary','lifecycle:'||a.id
 FROM space_lifecycle_events a LEFT JOIN "user" u ON u.id=a.actor_id;
INSERT INTO audit_events(created_at,actor_id,actor_name,space_id,group_id,entity_id,entity_type,entity_name,action,version_id,after_values,evidence,legacy_key)
 SELECT v.created_at,v.author_id,coalesce(u.name,'Unknown'),r.space_id,s.group_id,v.note_id::text,'document-version',v.title,
 CASE WHEN v.label IS NULL THEN 'checkpoint' ELSE 'named-version' END,v.id,jsonb_build_object('label',v.label,'generation',v.generation),'retained-version','version:'||v.id
 FROM snapshots v JOIN resources r ON r.note_id=v.note_id JOIN spaces s ON s.id=r.space_id LEFT JOIN "user" u ON u.id=v.author_id;

CREATE FUNCTION axiom_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Audit records are append-only';
END $$;
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION axiom_audit_immutable();

CREATE FUNCTION axiom_audit_visible(who text,e audit_events) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT (e.private_user_id IS NULL OR e.private_user_id=who) AND CASE
 WHEN e.group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM groups WHERE id=e.group_id)
   THEN EXISTS(SELECT 1 FROM audit_group_owners WHERE group_id=e.group_id AND owner_id=who)
 WHEN e.administrative THEN CASE WHEN e.space_id IS NOT NULL AND EXISTS(SELECT 1 FROM spaces WHERE id=e.space_id)
   THEN axiom_manage_space(who,e.space_id)
   ELSE EXISTS(SELECT 1 FROM members WHERE group_id=e.group_id AND user_id=who AND role IN ('owner','admin')) END
 WHEN e.entity_type IN ('group','workspace','project') THEN
   coalesce(axiom_base_space_role(who,e.space_id) IS NOT NULL OR axiom_manage_space(who,e.space_id),false)
   OR EXISTS(SELECT 1 FROM members WHERE group_id=e.group_id AND user_id=who AND (e.entity_type='group' OR role IN ('owner','admin')))
 WHEN EXISTS(SELECT 1 FROM resources WHERE id::text=e.entity_id) THEN
   EXISTS(SELECT 1 FROM resources r WHERE r.id::text=e.entity_id AND axiom_base_space_role(who,r.space_id) IS NOT NULL)
 WHEN EXISTS(SELECT 1 FROM spaces WHERE id=e.space_id) THEN axiom_base_space_role(who,e.space_id) IS NOT NULL
 ELSE EXISTS(SELECT 1 FROM audit_scopes s WHERE s.space_id=e.space_id AND
   (s.owner_id=who OR (who=ANY(s.final_readers) AND EXISTS(SELECT 1 FROM members WHERE group_id=s.group_id AND user_id=who))))
 END;
$$;
`;
