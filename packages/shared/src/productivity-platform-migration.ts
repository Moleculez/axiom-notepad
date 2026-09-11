/** Forward only. Existing rooms, document bodies and snapshots stay untouched. */
export const productivityPlatformMigration = `
ALTER TABLE notes DROP CONSTRAINT notes_source_format_check;
ALTER TABLE notes ADD CONSTRAINT notes_source_format_check CHECK(source_format IN ('markdown','latex','text','canvas'));
ALTER TABLE tool_projects DROP CONSTRAINT tool_projects_kind_check;
ALTER TABLE tool_projects ADD CONSTRAINT tool_projects_kind_check CHECK(kind IN ('math','image','canvas','text'));
ALTER TABLE snapshots ADD COLUMN source_format text NOT NULL DEFAULT 'markdown';
UPDATE snapshots s SET source_format=n.source_format FROM notes n WHERE n.id=s.note_id;
CREATE FUNCTION axiom_snapshot_format() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN SELECT source_format INTO NEW.source_format FROM notes WHERE id=NEW.note_id; RETURN NEW; END $$;
CREATE TRIGGER axiom_snapshot_format BEFORE INSERT ON snapshots FOR EACH ROW EXECUTE FUNCTION axiom_snapshot_format();
CREATE OR REPLACE FUNCTION axiom_file_references(source text) RETURNS SETOF uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT DISTINCT match[1]::uuid FROM regexp_matches(source,'/api/v1/attachments/([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})','g') AS match
 UNION SELECT DISTINCT match[1]::uuid FROM regexp_matches(source,'"versionId"[[:space:]]*:[[:space:]]*"([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})"','g') AS match;
$$;
CREATE TABLE document_command_receipts(id uuid PRIMARY KEY,actor_id text NOT NULL REFERENCES "user",note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE,request_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
`;
