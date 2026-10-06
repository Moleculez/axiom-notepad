/** Forward-only lab metadata. No document, source or CRDT rewrite. */
export const planningLabMigration = `
ALTER TABLE spaces ADD COLUMN planning_fields_version integer NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(custom_fields)='object');
CREATE UNIQUE INDEX tasks_lab_scope ON tasks(id,space_id);
CREATE TABLE planning_fields (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,
 name text NOT NULL,kind text NOT NULL CHECK(kind IN ('text','number','date','checkbox','url','select','multiselect','person')),
 unit text NOT NULL DEFAULT '',options jsonb NOT NULL DEFAULT '[]',used_options uuid[] NOT NULL DEFAULT '{}',archived boolean NOT NULL DEFAULT false,position integer NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 1,created_by text REFERENCES "user" ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,space_id)
);
CREATE UNIQUE INDEX planning_fields_name ON planning_fields(space_id,lower(name)) WHERE NOT archived;
CREATE INDEX planning_fields_scope ON planning_fields(space_id,archived,position,id);
CREATE TABLE planning_field_values (
 task_id uuid NOT NULL,space_id uuid NOT NULL,field_id uuid NOT NULL,value jsonb NOT NULL,
 text_value text GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(value)='string' THEN value#>>'{}' END) STORED,
 number_value numeric GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(value)='number' THEN (value#>>'{}')::numeric END) STORED,
 PRIMARY KEY(task_id,field_id),FOREIGN KEY(task_id,space_id) REFERENCES tasks(id,space_id) ON DELETE CASCADE,
 FOREIGN KEY(field_id,space_id) REFERENCES planning_fields(id,space_id) ON DELETE CASCADE
);
CREATE INDEX planning_field_text ON planning_field_values(space_id,field_id,text_value,task_id);
CREATE INDEX planning_field_number ON planning_field_values(space_id,field_id,number_value,task_id);
CREATE INDEX planning_field_json ON planning_field_values USING gin(value jsonb_path_ops);
CREATE FUNCTION axiom_task_custom_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND NEW.custom_fields IS NOT DISTINCT FROM OLD.custom_fields THEN RETURN NEW; END IF;
 DELETE FROM planning_field_values WHERE task_id=NEW.id AND NOT(NEW.custom_fields ? field_id::text);
 INSERT INTO planning_field_values(task_id,space_id,field_id,value) SELECT NEW.id,NEW.space_id,key::uuid,value FROM jsonb_each(NEW.custom_fields)
 ON CONFLICT(task_id,field_id) DO UPDATE SET value=excluded.value WHERE planning_field_values.value IS DISTINCT FROM excluded.value;
 WITH choices AS (
  SELECT v.field_id,array_agg(choice.id::uuid) AS ids FROM planning_field_values v
  JOIN planning_fields definition ON definition.id=v.field_id AND definition.kind IN ('select','multiselect')
  CROSS JOIN LATERAL jsonb_array_elements_text(
   CASE jsonb_typeof(v.value) WHEN 'array' THEN v.value WHEN 'string' THEN jsonb_build_array(v.value) ELSE '[]'::jsonb END
  ) choice(id) WHERE v.task_id=NEW.id GROUP BY v.field_id
 )
 UPDATE planning_fields f SET used_options=ARRAY(SELECT DISTINCT id FROM unnest(f.used_options||c.ids) used(id) ORDER BY id)
 FROM choices c WHERE c.field_id=f.id AND NOT f.used_options @> c.ids;
 IF TG_OP='UPDATE' THEN
  INSERT INTO audit_events(actor_id,actor_name,space_id,group_id,entity_id,entity_type,entity_name,action,before_values,after_values,operation_id)
  SELECT nullif(current_setting('axiom.actor_id',true),''),coalesce((SELECT name FROM "user" WHERE id=nullif(current_setting('axiom.actor_id',true),'')),'System'),NEW.space_id,s.group_id,NEW.id::text,'task',NEW.title,'update',
   jsonb_build_object('custom_fields',OLD.custom_fields),jsonb_build_object('custom_fields',NEW.custom_fields),nullif(current_setting('axiom.operation_id',true),'')::uuid FROM spaces s WHERE s.id=NEW.space_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aa_task_custom_projection AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION axiom_task_custom_projection();
CREATE TABLE planning_time (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,task_id uuid NOT NULL,
 author_id text REFERENCES "user" ON DELETE SET NULL,spent_on date NOT NULL,minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 1440),note text NOT NULL DEFAULT '',
 withdrawn boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(task_id,space_id) REFERENCES tasks(id,space_id) ON DELETE CASCADE
);
CREATE INDEX planning_time_page ON planning_time(space_id,spent_on DESC,id DESC);
CREATE INDEX planning_time_task ON planning_time(task_id,withdrawn,spent_on);
CREATE INDEX planning_time_member ON planning_time(space_id,author_id,spent_on);
CREATE TABLE planning_time_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entry_id uuid NOT NULL REFERENCES planning_time ON DELETE CASCADE,space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,
 actor_id text REFERENCES "user" ON DELETE SET NULL,reason text NOT NULL DEFAULT '',before_data jsonb,after_data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX planning_time_history_entry ON planning_time_history(entry_id,created_at DESC,id DESC);
CREATE TABLE planning_automations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,name text NOT NULL,config jsonb NOT NULL,
 enabled boolean NOT NULL DEFAULT false,archived boolean NOT NULL DEFAULT false,configured_by text REFERENCES "user" ON DELETE SET NULL,
 enabled_at timestamptz,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX planning_automations_scope ON planning_automations(space_id,enabled,archived,id);
CREATE TABLE planning_automation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,rule_id uuid NOT NULL REFERENCES planning_automations ON DELETE CASCADE,
 rule_version integer NOT NULL,field_version integer NOT NULL,event_key text NOT NULL,changes jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','noop','blocked','applied','cancelled','undone')),
 error text,preview jsonb,approved_by text REFERENCES "user" ON DELETE SET NULL,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(rule_id,rule_version,event_key)
);
CREATE INDEX planning_automation_run_page ON planning_automation_runs(space_id,created_at DESC,id DESC);
CREATE TABLE planning_automation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,task_id uuid NOT NULL REFERENCES tasks ON DELETE CASCADE,
 task_version integer NOT NULL,kind text NOT NULL CHECK(kind IN ('created','changed')),before_data jsonb,after_data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz,
 UNIQUE(task_id,task_version)
);
CREATE INDEX planning_automation_event_pending ON planning_automation_events(space_id,created_at,id) WHERE processed_at IS NULL;
CREATE UNIQUE INDEX planning_automation_event_coalesced ON planning_automation_events(task_id,kind) WHERE processed_at IS NULL;
CREATE FUNCTION axiom_task_automation_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b jsonb; a jsonb; BEGIN
 IF nullif(current_setting('axiom.automation_origin',true),'') IS NOT NULL OR NEW.deleted_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM planning_automations WHERE space_id=NEW.space_id AND enabled AND NOT archived AND config->>'trigger'=CASE TG_OP WHEN 'INSERT' THEN 'created' ELSE 'changed' END) THEN RETURN NEW; END IF;
 a:=jsonb_build_object('id',NEW.id,'version',NEW.version,'title',NEW.title,'status',NEW.status,'priority',NEW.priority,'assignee_id',NEW.assignee_id,'labels',NEW.labels,'due_on',NEW.due_on,'custom_fields',NEW.custom_fields);
 IF TG_OP='UPDATE' THEN
  b:=jsonb_build_object('id',OLD.id,'version',OLD.version,'title',OLD.title,'status',OLD.status,'priority',OLD.priority,'assignee_id',OLD.assignee_id,'labels',OLD.labels,'due_on',OLD.due_on,'custom_fields',OLD.custom_fields);
  IF (a-'version') IS NOT DISTINCT FROM (b-'version') THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM planning_automations r CROSS JOIN LATERAL jsonb_array_elements_text(r.config->'watched') k WHERE r.space_id=NEW.space_id AND r.enabled AND NOT r.archived AND r.config->>'trigger'='changed' AND a->k.value IS DISTINCT FROM b->k.value) THEN RETURN NEW; END IF;
 END IF;
 INSERT INTO planning_automation_events(space_id,task_id,task_version,kind,before_data,after_data) VALUES(NEW.space_id,NEW.id,NEW.version,CASE TG_OP WHEN 'INSERT' THEN 'created' ELSE 'changed' END,b,a)
 ON CONFLICT(task_id,kind) WHERE processed_at IS NULL DO UPDATE SET task_version=excluded.task_version,after_data=excluded.after_data;
 RETURN NEW;
END $$;
CREATE TRIGGER ab_task_automation_event AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION axiom_task_automation_event();
`;
