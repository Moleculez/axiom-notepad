export const researchIndexInvalidationMigration = String.raw`
-- Files/new, imports, restores and reviewed assistant writes can bypass the
-- interactive editor save path. Queue their derived citations transactionally.
CREATE FUNCTION axiom_queue_note_citations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.source_format='markdown' THEN
   INSERT INTO research_index_queue(note_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
 ELSIF (NEW.source_format='markdown' OR OLD.source_format='markdown') AND
   (NEW.body IS DISTINCT FROM OLD.body OR NEW.source_format IS DISTINCT FROM OLD.source_format) THEN
  INSERT INTO research_index_queue(note_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER note_citation_invalidation AFTER INSERT OR UPDATE OF body,source_format ON notes
 FOR EACH ROW EXECUTE FUNCTION axiom_queue_note_citations();
INSERT INTO research_index_queue SELECT id FROM notes WHERE source_format='markdown' ON CONFLICT DO NOTHING;
`;
