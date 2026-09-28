/** Additive follow-up: migration 35 has already shipped to development databases. */
export const researchLibraryIntegrityMigration = String.raw`
CREATE FUNCTION axiom_reference_keys(doi text,arxiv text,title text,authors text,year text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 WITH normalized AS (SELECT
  lower(regexp_replace(trim(doi),'^https?://(dx\.)?doi\.org/','','i')) AS d,
  lower(regexp_replace(regexp_replace(trim(arxiv),'^https?://arxiv\.org/abs/','','i'),'v[0-9]+$','')) AS a,
  lower(trim(title)) AS t, lower(trim(authors)) AS u, lower(trim(year)) AS y)
 SELECT array_remove(ARRAY[CASE WHEN d<>'' THEN 'doi:'||d END,CASE WHEN a<>'' THEN 'arxiv:'||a END,
  CASE WHEN length(t)>12 AND u<>'' AND y<>'' THEN 'title:'||t||':'||u||':'||y END],NULL) FROM normalized
$$;
ALTER TABLE bibliography ADD COLUMN identity_keys text[] GENERATED ALWAYS AS (axiom_reference_keys(doi,arxiv,title,authors,year)) STORED;
CREATE INDEX bibliography_identity_keys ON bibliography USING gin(identity_keys) WHERE merged_into IS NULL AND deleted_at IS NULL;
CREATE INDEX reference_items_reference ON reference_collection_items(reference_id);
CREATE INDEX reference_notes_note ON reference_notes(note_id);
CREATE INDEX reference_attachments_attachment ON reference_attachments(attachment_id);
CREATE FUNCTION axiom_validate_collection_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM reference_collections c JOIN bibliography b ON b.id=NEW.reference_id
  WHERE c.id=NEW.collection_id AND c.group_id IS NOT DISTINCT FROM b.group_id
  AND c.owner_user_id IS NOT DISTINCT FROM b.owner_user_id) THEN
  RAISE EXCEPTION 'Reference and collection must belong to the same library' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reference_collection_item_scope BEFORE INSERT OR UPDATE ON reference_collection_items
 FOR EACH ROW EXECUTE FUNCTION axiom_validate_collection_item();
`;
