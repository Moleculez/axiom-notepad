/** A reversible decision must retain bytes referenced by either direction. */
export const revisionUndoRetentionMigration = String.raw`
ALTER TABLE resource_references ADD COLUMN decision_id uuid REFERENCES revision_decisions ON DELETE CASCADE;
DROP INDEX resource_reference_live;
CREATE UNIQUE INDEX resource_reference_live ON resource_references(source_id,version_id) WHERE snapshot_id IS NULL AND suggestion_id IS NULL AND decision_id IS NULL;
CREATE UNIQUE INDEX resource_reference_decision ON resource_references(source_id,version_id,decision_id) WHERE decision_id IS NOT NULL;
CREATE OR REPLACE FUNCTION axiom_index_file_references() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE source uuid; snapshot uuid; BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtext('axiom:file-references'));
 IF TG_TABLE_NAME='notes' THEN source=NEW.id; snapshot=NULL; ELSE source=NEW.note_id; snapshot=NEW.id; END IF;
 IF NOT EXISTS(SELECT 1 FROM resources WHERE id=source) THEN RETURN NEW; END IF;
 IF snapshot IS NULL THEN DELETE FROM resource_references WHERE source_id=source AND snapshot_id IS NULL AND suggestion_id IS NULL AND decision_id IS NULL; END IF;
 INSERT INTO resource_references(source_id,version_id,snapshot_id) SELECT source,v.id,snapshot FROM axiom_file_references(NEW.body) f JOIN file_versions v ON v.id=f ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE FUNCTION axiom_decision_references() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock_shared(hashtext('axiom:file-references'));
 DELETE FROM resource_references WHERE decision_id=NEW.id;
 IF NOT NEW.undone THEN
 INSERT INTO resource_references(source_id,version_id,decision_id)
 SELECT NEW.note_id,v.id,NEW.id FROM axiom_file_references(NEW.suggestions::text||E'\n'||NEW.inverse_hunks::text) f
 JOIN file_versions v ON v.id=f ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_axiom_decision_references AFTER INSERT OR UPDATE OF undone,suggestions,inverse_hunks ON revision_decisions FOR EACH ROW EXECUTE FUNCTION axiom_decision_references();
UPDATE revision_decisions SET undone=undone WHERE NOT undone;
`;
