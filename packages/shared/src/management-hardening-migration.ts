/** Forward-only follow-up: persist deletion context and retain names through cascades. */
export const managementHardeningMigration = `
ALTER TABLE resources ADD COLUMN deleted_path text, ADD COLUMN deleted_actor_name text;
ALTER TABLE spaces ADD COLUMN deleted_by text;
CREATE OR REPLACE FUNCTION axiom_resource_deleted_actor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
   NEW.deleted_by := nullif(current_setting('axiom.actor_id',true),'');
   SELECT name INTO NEW.deleted_actor_name FROM "user" WHERE id=NEW.deleted_by;
   SELECT coalesce(string_agg(name,' / ' ORDER BY depth DESC),'Workspace root') INTO NEW.deleted_path
   FROM (WITH RECURSIVE ancestors AS (
     SELECT id,parent_id,name,1 AS depth FROM resources WHERE id=NEW.parent_id
     UNION ALL SELECT p.id,p.parent_id,p.name,a.depth+1 FROM resources p JOIN ancestors a ON p.id=a.parent_id
   ) SELECT name,depth FROM ancestors) history;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION axiom_space_deleted_actor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status='trashed' AND OLD.status<>'trashed' THEN NEW.deleted_by := nullif(current_setting('axiom.actor_id',true),''); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER axiom_space_deleted_actor BEFORE UPDATE OF status ON spaces FOR EACH ROW EXECUTE FUNCTION axiom_space_deleted_actor();
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('axiom_audit_capture()'::regprocedure) INTO definition;
 IF position('SELECT coalesce(p.name,g.name,''Personal space'') INTO label' IN definition)=0 THEN
   RAISE EXCEPTION 'Unexpected audit function; refusing an ambiguous migration';
 END IF;
 definition := replace(definition,'SELECT coalesce(p.name,g.name,''Personal space'') INTO label',
   'SELECT coalesce(p.name,g.name,(SELECT name FROM audit_scopes WHERE space_id=sid),''Personal space'') INTO label');
 EXECUTE definition;
END $$;
`;
