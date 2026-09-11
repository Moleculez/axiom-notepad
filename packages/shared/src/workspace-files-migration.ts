export const workspaceFilesMigration = `
ALTER TABLE resource_references DROP CONSTRAINT resource_references_pkey;
ALTER TABLE resource_references ADD COLUMN id bigserial PRIMARY KEY;
CREATE UNIQUE INDEX resource_reference_live ON resource_references(source_id,version_id) WHERE snapshot_id IS NULL;
CREATE UNIQUE INDEX resource_reference_snapshot ON resource_references(source_id,version_id,snapshot_id) WHERE snapshot_id IS NOT NULL;
CREATE FUNCTION axiom_file_references(source text) RETURNS SETOF uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT DISTINCT match[1]::uuid FROM regexp_matches(source,'/api/v1/attachments/([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})','g') AS match;
$$;
CREATE FUNCTION axiom_index_file_references() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE source uuid; snapshot uuid; BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtext('axiom:file-references'));
 IF TG_TABLE_NAME='notes' THEN source=NEW.id; snapshot=NULL; ELSE source=NEW.note_id; snapshot=NEW.id; END IF;
 IF NOT EXISTS(SELECT 1 FROM resources WHERE id=source) THEN RETURN NEW; END IF;
 IF snapshot IS NULL THEN DELETE FROM resource_references WHERE source_id=source AND snapshot_id IS NULL; END IF;
 INSERT INTO resource_references(source_id,version_id,snapshot_id) SELECT source,v.id,snapshot FROM axiom_file_references(NEW.body) f JOIN file_versions v ON v.id=f ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_axiom_note_file_references AFTER INSERT OR UPDATE OF body ON notes FOR EACH ROW EXECUTE FUNCTION axiom_index_file_references();
CREATE TRIGGER zz_axiom_snapshot_file_references AFTER INSERT ON snapshots FOR EACH ROW EXECUTE FUNCTION axiom_index_file_references();
INSERT INTO resource_references(source_id,version_id) SELECT n.id,v.id FROM notes n CROSS JOIN LATERAL axiom_file_references(n.body) f JOIN file_versions v ON v.id=f ON CONFLICT DO NOTHING;
INSERT INTO resource_references(source_id,version_id,snapshot_id) SELECT s.note_id,v.id,s.id FROM snapshots s CROSS JOIN LATERAL axiom_file_references(s.body) f JOIN file_versions v ON v.id=f ON CONFLICT DO NOTHING;
ALTER TABLE workspace_jobs ADD COLUMN lease_id uuid;
CREATE TABLE workspace_exports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,resource_ids uuid[] NOT NULL,status text NOT NULL DEFAULT 'queued',storage_key uuid,bytes bigint,sha256 text,error text,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX workspace_exports_user ON workspace_exports(user_id,created_at DESC);
`;
