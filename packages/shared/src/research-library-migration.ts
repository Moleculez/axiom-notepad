export const researchLibraryMigration = String.raw`
ALTER TABLE bibliography ALTER COLUMN group_id DROP NOT NULL;
ALTER TABLE bibliography ADD COLUMN owner_user_id text REFERENCES "user" ON DELETE CASCADE,
 ADD COLUMN tags text[] NOT NULL DEFAULT '{}', ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN deleted_at timestamptz, ADD COLUMN merged_into uuid REFERENCES bibliography ON DELETE RESTRICT,
 ADD COLUMN import_source jsonb NOT NULL DEFAULT '{}',
 ADD CONSTRAINT bibliography_owner CHECK ((group_id IS NULL) <> (owner_user_id IS NULL)),
 ADD CONSTRAINT bibliography_merge_self CHECK (merged_into IS DISTINCT FROM id);
CREATE UNIQUE INDEX bibliography_personal_key ON bibliography(owner_user_id,cite_key) WHERE owner_user_id IS NOT NULL;
CREATE INDEX bibliography_owner_updated ON bibliography(owner_user_id,updated_at,id);
CREATE INDEX bibliography_group_updated ON bibliography(group_id,updated_at,id);
CREATE INDEX bibliography_tags ON bibliography USING gin(tags);
CREATE TABLE reference_collections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid REFERENCES groups ON DELETE CASCADE,
 owner_user_id text REFERENCES "user" ON DELETE CASCADE, parent_id uuid REFERENCES reference_collections ON DELETE CASCADE,
 name text NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((group_id IS NULL) <> (owner_user_id IS NULL)), CHECK (id IS DISTINCT FROM parent_id));
CREATE TABLE reference_collection_items (
 collection_id uuid NOT NULL REFERENCES reference_collections ON DELETE CASCADE,
 reference_id uuid NOT NULL REFERENCES bibliography ON DELETE CASCADE, PRIMARY KEY(collection_id,reference_id));
CREATE TABLE note_citations (note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE,cite_key text NOT NULL,PRIMARY KEY(note_id,cite_key));
CREATE INDEX note_citation_key ON note_citations(cite_key);
CREATE TABLE research_index_queue (note_id uuid PRIMARY KEY REFERENCES notes ON DELETE CASCADE);
INSERT INTO research_index_queue SELECT id FROM notes WHERE source_format='markdown';
CREATE VIEW reference_catalog AS
 SELECT a.id,a.cite_key,a.group_id,a.owner_user_id,c.id AS canonical_id,c.title,c.authors,c.year,c.url,c.doi,c.arxiv,c.venue,
 c.tags,c.version,c.created_at,c.updated_at,c.deleted_at,a.merged_into,c.import_source,
 regexp_replace(c.bibtex,'^(@[[:alnum:]_]+[[:space:]]*\{[[:space:]]*)[^,]+','\1'||a.cite_key) AS bibtex
 FROM bibliography a JOIN bibliography c ON c.id=coalesce(a.merged_into,a.id);
-- A note's existing snapshots win; shared notes never resolve a viewer's private library.
CREATE FUNCTION axiom_note_bibliography(note uuid) RETURNS TABLE
 (reference_id uuid,cite_key text,title text,authors text,year text,url text,bibtex text,doi text,arxiv text,venue text)
 LANGUAGE sql STABLE AS $$
 SELECT NULL::uuid,p.cite_key,p.data->>'title',p.data->>'authors',p.data->>'year',p.data->>'url',p.data->>'bibtex',p.data->>'doi',p.data->>'arxiv',p.data->>'venue'
 FROM personal_citations p WHERE p.note_id=note
 UNION ALL
 SELECT b.canonical_id,b.cite_key,b.title,b.authors,b.year,b.url,b.bibtex,b.doi,b.arxiv,b.venue
 FROM resources r JOIN spaces s ON s.id=r.space_id JOIN reference_catalog b
 ON (s.kind='personal' AND b.owner_user_id=s.owner_id) OR (s.kind<>'personal' AND b.group_id=s.group_id)
 WHERE r.note_id=note AND NOT EXISTS(SELECT 1 FROM personal_citations p WHERE p.note_id=note AND p.cite_key=b.cite_key)
 $$;
CREATE FUNCTION axiom_validate_reference_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target bibliography%ROWTYPE; parent reference_collections%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='bibliography' THEN
  IF NEW.merged_into IS NOT NULL THEN
   SELECT * INTO target FROM bibliography WHERE id=NEW.merged_into;
   IF target.id IS NULL OR target.merged_into IS NOT NULL OR target.group_id IS DISTINCT FROM NEW.group_id OR target.owner_user_id IS DISTINCT FROM NEW.owner_user_id THEN RAISE EXCEPTION 'Invalid reference merge scope'; END IF;
  END IF;
 ELSE
  IF NEW.parent_id IS NOT NULL THEN
   SELECT * INTO parent FROM reference_collections WHERE id=NEW.parent_id;
   IF parent.id IS NULL OR parent.group_id IS DISTINCT FROM NEW.group_id OR parent.owner_user_id IS DISTINCT FROM NEW.owner_user_id OR EXISTS(WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM reference_collections WHERE id=NEW.parent_id UNION SELECT c.id,c.parent_id FROM reference_collections c JOIN ancestors a ON c.id=a.parent_id) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'Invalid collection hierarchy'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bibliography_scope BEFORE INSERT OR UPDATE ON bibliography FOR EACH ROW EXECUTE FUNCTION axiom_validate_reference_scope();
CREATE TRIGGER reference_collection_scope BEFORE INSERT OR UPDATE ON reference_collections FOR EACH ROW EXECUTE FUNCTION axiom_validate_reference_scope();
`;
