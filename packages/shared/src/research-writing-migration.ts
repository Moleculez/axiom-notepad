/** Forward-only writing workflow metadata. No document source is rewritten. */
export const researchWritingMigration = String.raw`
CREATE TABLE reference_provenance (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference_id uuid NOT NULL REFERENCES bibliography ON DELETE CASCADE,
 space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE, version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('baseline','create','import','copy','lookup','edit','merge')),
 actor_id text REFERENCES "user" ON DELETE SET NULL, operation_id uuid,
 before_data jsonb, after_data jsonb NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX reference_provenance_history ON reference_provenance(reference_id,created_at DESC,id DESC);
INSERT INTO reference_provenance(reference_id,space_id,version,kind,after_data)
 SELECT id,space_id,version,'baseline',jsonb_build_object('cite_key',cite_key,'title',title,'authors',authors,'year',year,'url',url,'doi',doi,'arxiv',arxiv,'venue',venue,'bibtex',bibtex,'tags',tags,'merged_into',merged_into)
 FROM bibliography;
CREATE FUNCTION axiom_reference_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_value jsonb; after_value jsonb; category text; actor text; operation uuid;
BEGIN
 after_value:=jsonb_build_object('cite_key',NEW.cite_key,'title',NEW.title,'authors',NEW.authors,'year',NEW.year,'url',NEW.url,'doi',NEW.doi,'arxiv',NEW.arxiv,'venue',NEW.venue,'bibtex',NEW.bibtex,'tags',NEW.tags,'merged_into',NEW.merged_into);
 IF TG_OP='UPDATE' THEN
  before_value:=jsonb_build_object('cite_key',OLD.cite_key,'title',OLD.title,'authors',OLD.authors,'year',OLD.year,'url',OLD.url,'doi',OLD.doi,'arxiv',OLD.arxiv,'venue',OLD.venue,'bibtex',OLD.bibtex,'tags',OLD.tags,'merged_into',OLD.merged_into);
  IF before_value=after_value THEN RETURN NEW; END IF;
 END IF;
 category:=nullif(current_setting('axiom.reference_operation',true),'');
 IF category IS NULL OR category NOT IN ('create','import','copy','lookup','edit','merge') THEN
  category:=CASE WHEN TG_OP='INSERT' THEN CASE WHEN NEW.import_source <> '{}'::jsonb THEN 'import' ELSE 'create' END WHEN NEW.merged_into IS DISTINCT FROM OLD.merged_into THEN 'merge' ELSE 'edit' END;
 END IF;
 actor:=nullif(current_setting('axiom.actor_id',true),'');
 IF actor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "user" WHERE id=actor) THEN actor:=NULL; END IF;
 operation:=nullif(current_setting('axiom.operation_id',true),'')::uuid;
 INSERT INTO reference_provenance(reference_id,space_id,version,kind,actor_id,operation_id,before_data,after_data,details)
 VALUES(NEW.id,NEW.space_id,NEW.version,category,actor,operation,before_value,after_value,coalesce(nullif(current_setting('axiom.reference_details',true),'')::jsonb,'{}'::jsonb));
 RETURN NEW;
END $$;
CREATE TRIGGER bibliography_provenance AFTER INSERT OR UPDATE ON bibliography FOR EACH ROW EXECUTE FUNCTION axiom_reference_provenance();
ALTER TABLE review_requests ADD COLUMN paper_context jsonb;
CREATE TABLE task_research_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES tasks ON DELETE CASCADE,
 source_kind text NOT NULL CHECK(source_kind IN ('manuscript','reference')),
 note_id uuid REFERENCES notes ON DELETE SET NULL, snapshot_id uuid REFERENCES snapshots ON DELETE SET NULL,
 reference_id uuid REFERENCES bibliography ON DELETE SET NULL, reference_event_id uuid REFERENCES reference_provenance ON DELETE SET NULL,
 author_id text REFERENCES "user" ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX task_research_snapshot ON task_research_links(task_id,snapshot_id) WHERE snapshot_id IS NOT NULL;
CREATE UNIQUE INDEX task_research_reference ON task_research_links(task_id,reference_event_id) WHERE reference_event_id IS NOT NULL;
CREATE INDEX task_research_task ON task_research_links(task_id,created_at);
`;
