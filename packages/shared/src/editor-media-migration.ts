export const editorMediaMigration = `
ALTER TABLE spaces ADD COLUMN reference_prefix text;
ALTER TABLE resources ADD COLUMN reference_code text;
CREATE UNIQUE INDEX resources_reference_code ON resources(reference_code);
CREATE TABLE resource_code_prefixes(prefix text PRIMARY KEY,space_id uuid REFERENCES spaces ON DELETE SET NULL,next_number bigint NOT NULL DEFAULT 0);
CREATE TABLE resource_reference_codes(code text PRIMARY KEY,resource_id uuid UNIQUE REFERENCES resources ON DELETE SET NULL);
CREATE FUNCTION axiom_assign_resource_code() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE chosen_prefix text; ordinal bigint; claimed uuid; BEGIN
 IF TG_OP='UPDATE' AND OLD.reference_code IS NOT NULL THEN
  IF NEW.reference_code IS DISTINCT FROM OLD.reference_code THEN RAISE EXCEPTION 'File reference codes are immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.kind NOT IN ('note','file') THEN NEW.reference_code=NULL; RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('file-code:'||NEW.space_id::text));
 SELECT reference_prefix INTO chosen_prefix FROM spaces WHERE id=NEW.space_id;
 IF chosen_prefix IS NULL THEN
  SELECT coalesce(nullif(left(regexp_replace(upper(name),'[^A-Z0-9]','','g'),6),''),'AX')||upper(left(replace(id::text,'-',''),6)) INTO chosen_prefix FROM spaces WHERE id=NEW.space_id;
  LOOP
   claimed=NULL;
   INSERT INTO resource_code_prefixes(prefix,space_id) VALUES(chosen_prefix,NEW.space_id) ON CONFLICT DO NOTHING RETURNING space_id INTO claimed;
   EXIT WHEN claimed=NEW.space_id;
   chosen_prefix='AX'||upper(left(replace(gen_random_uuid()::text,'-',''),10));
  END LOOP;
  UPDATE spaces SET reference_prefix=chosen_prefix WHERE id=NEW.space_id;
 END IF;
 UPDATE resource_code_prefixes SET next_number=next_number+1 WHERE resource_code_prefixes.prefix=chosen_prefix RETURNING next_number INTO ordinal;
 NEW.reference_code=chosen_prefix||'-'||ordinal;
 RETURN NEW;
END $$;
CREATE TRIGGER axiom_resource_code BEFORE INSERT OR UPDATE OF reference_code ON resources FOR EACH ROW EXECUTE FUNCTION axiom_assign_resource_code();
CREATE FUNCTION axiom_record_resource_code() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.reference_code IS NOT NULL THEN INSERT INTO resource_reference_codes(code,resource_id) VALUES(NEW.reference_code,NEW.id) ON CONFLICT DO NOTHING; END IF; RETURN NEW;
END $$;
CREATE TRIGGER axiom_resource_code_record AFTER INSERT OR UPDATE OF reference_code ON resources FOR EACH ROW EXECUTE FUNCTION axiom_record_resource_code();
DO $$ DECLARE r record; BEGIN FOR r IN SELECT id FROM resources WHERE kind IN ('file','note') ORDER BY created_at,id LOOP UPDATE resources SET reference_code=NULL WHERE id=r.id; END LOOP; END $$;
CREATE TABLE editor_snippets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,space_id uuid REFERENCES spaces ON DELETE CASCADE,name text NOT NULL,body text NOT NULL,tags text[] NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,archived boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX editor_snippets_owner ON editor_snippets(owner_id,updated_at DESC);
CREATE INDEX editor_snippets_space ON editor_snippets(space_id,updated_at DESC);
CREATE TABLE snippet_asset_references(snippet_id uuid NOT NULL REFERENCES editor_snippets ON DELETE CASCADE,version_id uuid NOT NULL REFERENCES file_versions(id),PRIMARY KEY(snippet_id,version_id));
CREATE INDEX snippet_asset_versions ON snippet_asset_references(version_id);
ALTER TABLE upload_sessions ADD COLUMN completed_version_id uuid REFERENCES file_versions ON DELETE SET NULL;
UPDATE upload_sessions u SET completed_version_id=(SELECT v.id FROM file_versions v JOIN attachments a ON a.id=v.id WHERE v.resource_id=u.completed_resource_id AND a.storage_key=u.storage_key::text ORDER BY v.ordinal LIMIT 1) WHERE u.status='complete';
`;
