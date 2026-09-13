export const revisionRetentionMigration = String.raw`
ALTER TABLE resource_references ADD COLUMN suggestion_id uuid REFERENCES revision_suggestions ON DELETE CASCADE;
DROP INDEX resource_reference_live;
CREATE UNIQUE INDEX resource_reference_live ON resource_references(source_id,version_id) WHERE snapshot_id IS NULL AND suggestion_id IS NULL;
CREATE UNIQUE INDEX resource_reference_suggestion ON resource_references(source_id,version_id,suggestion_id) WHERE suggestion_id IS NOT NULL;
CREATE OR REPLACE FUNCTION axiom_index_file_references() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE source uuid; snapshot uuid; BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtext('axiom:file-references'));
 IF TG_TABLE_NAME='notes' THEN source=NEW.id; snapshot=NULL; ELSE source=NEW.note_id; snapshot=NEW.id; END IF;
 IF NOT EXISTS(SELECT 1 FROM resources WHERE id=source) THEN RETURN NEW; END IF;
 IF snapshot IS NULL THEN DELETE FROM resource_references WHERE source_id=source AND snapshot_id IS NULL AND suggestion_id IS NULL; END IF;
 INSERT INTO resource_references(source_id,version_id,snapshot_id) SELECT source,v.id,snapshot FROM axiom_file_references(NEW.body) f JOIN file_versions v ON v.id=f ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE FUNCTION axiom_suggestion_references() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtext('axiom:file-references'));
 DELETE FROM resource_references WHERE suggestion_id=NEW.id;
 IF NEW.status='pending' THEN
 INSERT INTO resource_references(source_id,version_id,suggestion_id)
 SELECT NEW.note_id,v.id,NEW.id FROM jsonb_array_elements(NEW.hunks) h
 CROSS JOIN LATERAL axiom_file_references(coalesce(h->>'before','')||E'\n'||coalesce(h->>'insert','')) f
 JOIN file_versions v ON v.id=f ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_axiom_suggestion_references AFTER INSERT OR UPDATE OF hunks,status ON revision_suggestions FOR EACH ROW EXECUTE FUNCTION axiom_suggestion_references();
UPDATE revision_suggestions SET hunks=hunks WHERE status='pending';
CREATE FUNCTION axiom_deleted_draft_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO workspace_jobs(kind,dedupe_key,payload) VALUES('delete-blob','image-draft:'||OLD.id::text,jsonb_build_object('key',OLD.storage_key));
 RETURN OLD;
END $$;
CREATE TRIGGER image_draft_asset_cleanup AFTER DELETE ON image_draft_assets FOR EACH ROW EXECUTE FUNCTION axiom_deleted_draft_asset();
`;
