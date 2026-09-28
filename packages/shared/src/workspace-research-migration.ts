/** Libraries follow workspace content permissions, including restricted projects.
 * Originals stay in the main/personal space; existing usage gets independent copies. */
export const workspaceResearchMigration = String.raw`
ALTER TABLE bibliography ADD COLUMN space_id uuid REFERENCES spaces ON DELETE CASCADE;
ALTER TABLE reference_collections ADD COLUMN space_id uuid REFERENCES spaces ON DELETE CASCADE;
UPDATE bibliography b SET space_id=s.id FROM spaces s WHERE
 (b.group_id=s.group_id AND s.kind='team') OR (b.owner_user_id=s.owner_id AND s.kind='personal');
UPDATE reference_collections b SET space_id=s.id FROM spaces s WHERE
 (b.group_id=s.group_id AND s.kind='team') OR (b.owner_user_id=s.owner_id AND s.kind='personal');
ALTER TABLE bibliography ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE reference_collections ALTER COLUMN space_id SET NOT NULL;
ALTER TABLE bibliography DROP CONSTRAINT bibliography_group_id_cite_key_key;
DROP INDEX bibliography_personal_key;
CREATE UNIQUE INDEX bibliography_workspace_key ON bibliography(space_id,cite_key);
CREATE INDEX bibliography_workspace_updated ON bibliography(space_id,updated_at,id);
CREATE INDEX reference_collections_workspace ON reference_collections(space_id,parent_id);
DROP TRIGGER bibliography_scope ON bibliography;
DROP TRIGGER reference_collection_scope ON reference_collections;
DROP TRIGGER reference_collection_item_scope ON reference_collection_items;

-- Record stable identities so old workspace-qualified deep links remain useful.
CREATE TABLE research_workspace_reference_map (
 original_id uuid NOT NULL, space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,
 reference_id uuid NOT NULL REFERENCES bibliography ON DELETE CASCADE,
 PRIMARY KEY(original_id,space_id));
CREATE TABLE research_workspace_collection_map (
 original_id uuid NOT NULL, space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,
 collection_id uuid NOT NULL REFERENCES reference_collections ON DELETE CASCADE,
 PRIMARY KEY(original_id,space_id));
INSERT INTO research_workspace_reference_map SELECT id,space_id,id FROM bibliography;
INSERT INTO research_workspace_collection_map SELECT id,space_id,id FROM reference_collections;

-- Resolve with the OLD resolver before changing its ownership boundary. Include
-- restorable resources; snapshots remain authoritative and are never rewritten.
CREATE TEMP TABLE research_usage ON COMMIT DROP AS
 SELECT DISTINCT coalesce(b.merged_into,b.id) AS reference_id,r.space_id
 FROM reference_notes l JOIN bibliography b ON b.id=l.reference_id JOIN resources r ON r.note_id=l.note_id
 UNION SELECT DISTINCT coalesce(b.merged_into,b.id),r.space_id
 FROM reference_attachments l JOIN bibliography b ON b.id=l.reference_id JOIN file_versions v ON v.id=l.attachment_id JOIN resources r ON r.id=v.resource_id
 UNION SELECT DISTINCT b.reference_id,r.space_id FROM resources r JOIN notes n ON n.id=r.note_id
 CROSS JOIN LATERAL axiom_note_bibliography(n.id) b
 WHERE b.reference_id IS NOT NULL AND (EXISTS(SELECT 1 FROM note_citations nc WHERE nc.note_id=n.id AND nc.cite_key=b.cite_key)
 OR n.body LIKE '%@'||b.cite_key||'%');
CREATE TEMP TABLE research_copy_ids ON COMMIT DROP AS
 SELECT DISTINCT b.id AS original_id,u.space_id,gen_random_uuid() AS reference_id
 FROM (SELECT DISTINCT reference_id,space_id FROM research_usage) u
 JOIN bibliography b ON coalesce(b.merged_into,b.id)=u.reference_id WHERE b.space_id<>u.space_id;
INSERT INTO bibliography(id,space_id,group_id,owner_user_id,cite_key,title,authors,year,url,bibtex,created_at,doi,arxiv,venue,version,tags,updated_at,deleted_at,import_source)
 SELECT m.reference_id,m.space_id,s.group_id,s.owner_id,b.cite_key,b.title,b.authors,b.year,b.url,b.bibtex,b.created_at,b.doi,b.arxiv,b.venue,b.version,b.tags,b.updated_at,b.deleted_at,b.import_source
 FROM research_copy_ids m JOIN bibliography b ON b.id=m.original_id JOIN spaces s ON s.id=m.space_id;
INSERT INTO research_workspace_reference_map SELECT * FROM research_copy_ids;
UPDATE bibliography b SET merged_into=target.reference_id FROM research_copy_ids m
 JOIN bibliography original ON original.id=m.original_id
 JOIN research_workspace_reference_map target ON target.original_id=original.merged_into AND target.space_id=m.space_id
 WHERE b.id=m.reference_id;

CREATE TEMP TABLE research_collection_copies ON COMMIT DROP AS
 WITH RECURSIVE needed AS (
 SELECT ci.collection_id AS original_id,m.space_id FROM reference_collection_items ci JOIN research_copy_ids m ON m.original_id=ci.reference_id
 UNION SELECT c.parent_id,n.space_id FROM needed n JOIN reference_collections c ON c.id=n.original_id WHERE c.parent_id IS NOT NULL)
 SELECT original_id,space_id,gen_random_uuid() AS collection_id FROM needed;
INSERT INTO reference_collections(id,space_id,group_id,owner_user_id,name,version,created_at)
 SELECT m.collection_id,m.space_id,s.group_id,s.owner_id,c.name,c.version,c.created_at
 FROM research_collection_copies m JOIN reference_collections c ON c.id=m.original_id JOIN spaces s ON s.id=m.space_id;
INSERT INTO research_workspace_collection_map SELECT * FROM research_collection_copies;
UPDATE reference_collections c SET parent_id=p.collection_id FROM research_collection_copies m
 JOIN reference_collections original ON original.id=m.original_id
 JOIN research_workspace_collection_map p ON p.original_id=original.parent_id AND p.space_id=m.space_id
 WHERE c.id=m.collection_id;
INSERT INTO reference_collection_items SELECT cm.collection_id,rm.reference_id FROM reference_collection_items ci
 JOIN research_copy_ids rm ON rm.original_id=ci.reference_id
 JOIN research_workspace_collection_map cm ON cm.original_id=ci.collection_id AND cm.space_id=rm.space_id;
UPDATE reference_notes l SET reference_id=m.reference_id FROM resources r,research_workspace_reference_map m
 WHERE r.note_id=l.note_id AND m.original_id=l.reference_id AND m.space_id=r.space_id;
UPDATE reference_attachments l SET reference_id=m.reference_id FROM file_versions v,resources r,research_workspace_reference_map m
 WHERE v.id=l.attachment_id AND r.id=v.resource_id AND m.original_id=l.reference_id AND m.space_id=r.space_id;
INSERT INTO reading_items(id,user_id,group_id,kind,target_type,target_id,data,version,mutation_id,deleted,updated_at)
 SELECT gen_random_uuid(),ri.user_id,m.space_id,ri.kind,ri.target_type,m.reference_id,ri.data,ri.version,gen_random_uuid(),ri.deleted,ri.updated_at
 FROM reading_items ri JOIN research_copy_ids m ON m.original_id=ri.target_id
 WHERE ri.target_type='reference' AND axiom_space_role(ri.user_id,m.space_id) IS NOT NULL;
UPDATE reading_items ri SET group_id=b.space_id FROM bibliography b WHERE ri.target_type='reference' AND ri.target_id=b.id;
UPDATE reading_items ri SET group_id=s.id,target_id=s.id FROM spaces s
 WHERE ri.kind='filter' AND ri.target_type='group' AND s.kind='team' AND ri.target_id=s.group_id;

CREATE OR REPLACE VIEW reference_catalog AS
 SELECT a.id,a.cite_key,a.group_id,a.owner_user_id,c.id AS canonical_id,c.title,c.authors,c.year,c.url,c.doi,c.arxiv,c.venue,
 c.tags,c.version,c.created_at,c.updated_at,c.deleted_at,a.merged_into,c.import_source,
 regexp_replace(c.bibtex,'^(@[[:alnum:]_]+[[:space:]]*\{[[:space:]]*)[^,]+','\1'||a.cite_key) AS bibtex,a.space_id
 FROM bibliography a JOIN bibliography c ON c.id=coalesce(a.merged_into,a.id);
CREATE OR REPLACE FUNCTION axiom_note_bibliography(note uuid) RETURNS TABLE
 (reference_id uuid,cite_key text,title text,authors text,year text,url text,bibtex text,doi text,arxiv text,venue text)
 LANGUAGE sql STABLE AS $$
 SELECT NULL::uuid,p.cite_key,p.data->>'title',p.data->>'authors',p.data->>'year',p.data->>'url',p.data->>'bibtex',p.data->>'doi',p.data->>'arxiv',p.data->>'venue'
 FROM personal_citations p WHERE p.note_id=note
 UNION ALL
 SELECT b.canonical_id,b.cite_key,b.title,b.authors,b.year,b.url,b.bibtex,b.doi,b.arxiv,b.venue
 FROM resources r JOIN reference_catalog b ON b.space_id=r.space_id
 WHERE r.note_id=note AND NOT EXISTS(SELECT 1 FROM personal_citations p WHERE p.note_id=note AND p.cite_key=b.cite_key)
 $$;

CREATE OR REPLACE FUNCTION axiom_validate_reference_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target bibliography%ROWTYPE; parent reference_collections%ROWTYPE; owner spaces%ROWTYPE;
BEGIN
 -- Legacy group/account-only inserts are confined to their main library.
 IF NEW.space_id IS NULL THEN
  SELECT * INTO owner FROM spaces WHERE (kind='team' AND group_id=NEW.group_id) OR (kind='personal' AND owner_id=NEW.owner_user_id);
  NEW.space_id:=owner.id;
 ELSE SELECT * INTO owner FROM spaces WHERE id=NEW.space_id;
 END IF;
 IF owner.id IS NULL THEN RAISE EXCEPTION 'Library workspace unavailable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.space_id IS DISTINCT FROM NEW.space_id THEN RAISE EXCEPTION 'Copy references between workspaces instead of moving ownership' USING ERRCODE='23514'; END IF;
 NEW.group_id:=owner.group_id; NEW.owner_user_id:=owner.owner_id;
 IF TG_TABLE_NAME='bibliography' THEN
  IF NEW.merged_into IS NOT NULL THEN
   SELECT * INTO target FROM bibliography WHERE id=NEW.merged_into;
   IF target.id IS NULL OR target.merged_into IS NOT NULL OR target.space_id<>NEW.space_id THEN RAISE EXCEPTION 'Invalid reference merge scope'; END IF;
  END IF;
 ELSE
  IF NEW.parent_id IS NOT NULL THEN
   SELECT * INTO parent FROM reference_collections WHERE id=NEW.parent_id;
   IF parent.id IS NULL OR parent.space_id<>NEW.space_id OR EXISTS(WITH RECURSIVE ancestors AS (SELECT id,parent_id FROM reference_collections WHERE id=NEW.parent_id UNION SELECT c.id,c.parent_id FROM reference_collections c JOIN ancestors a ON c.id=a.parent_id) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'Invalid collection hierarchy'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bibliography_scope BEFORE INSERT OR UPDATE ON bibliography FOR EACH ROW EXECUTE FUNCTION axiom_validate_reference_scope();
CREATE TRIGGER reference_collection_scope BEFORE INSERT OR UPDATE ON reference_collections FOR EACH ROW EXECUTE FUNCTION axiom_validate_reference_scope();
CREATE OR REPLACE FUNCTION axiom_validate_collection_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM reference_collections c JOIN bibliography b ON b.id=NEW.reference_id WHERE c.id=NEW.collection_id AND c.space_id=b.space_id) THEN
  RAISE EXCEPTION 'Reference and collection must belong to the same workspace' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER reference_collection_item_scope BEFORE INSERT OR UPDATE ON reference_collection_items FOR EACH ROW EXECUTE FUNCTION axiom_validate_collection_item();

CREATE FUNCTION axiom_validate_reference_link_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destination uuid; library uuid;
BEGIN
 SELECT space_id INTO library FROM bibliography WHERE id=NEW.reference_id;
 IF TG_TABLE_NAME='reference_notes' THEN
  SELECT space_id INTO destination FROM resources WHERE note_id=NEW.note_id;
 ELSE
  SELECT r.space_id INTO destination FROM resources r JOIN file_versions v ON v.resource_id=r.id WHERE v.id=NEW.attachment_id;
 END IF;
 IF destination IS NULL OR library IS DISTINCT FROM destination THEN RAISE EXCEPTION 'Reference links must stay in their workspace' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reference_note_workspace BEFORE INSERT OR UPDATE ON reference_notes FOR EACH ROW EXECUTE FUNCTION axiom_validate_reference_link_workspace();
CREATE TRIGGER reference_attachment_workspace BEFORE INSERT OR UPDATE ON reference_attachments FOR EACH ROW EXECUTE FUNCTION axiom_validate_reference_link_workspace();

-- Moving files never grants another workspace access to their old library.
-- Cited Markdown keeps the existing transfer-time bibliography snapshots.
CREATE FUNCTION axiom_detach_moved_reference_links() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.space_id IS DISTINCT FROM NEW.space_id THEN
  UPDATE bibliography SET version=version+1,updated_at=now() WHERE space_id<>NEW.space_id AND id IN (
   SELECT reference_id FROM reference_notes WHERE note_id=NEW.note_id
   UNION SELECT l.reference_id FROM reference_attachments l JOIN file_versions v ON v.id=l.attachment_id WHERE v.resource_id=NEW.id);
  DELETE FROM reference_notes l USING bibliography b WHERE l.reference_id=b.id AND l.note_id=NEW.note_id AND b.space_id<>NEW.space_id;
  DELETE FROM reference_attachments l USING bibliography b,file_versions v WHERE l.reference_id=b.id AND v.id=l.attachment_id AND v.resource_id=NEW.id AND b.space_id<>NEW.space_id;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER resource_research_move AFTER UPDATE OF space_id ON resources FOR EACH ROW EXECUTE FUNCTION axiom_detach_moved_reference_links();

-- Personal research state is not allowed to outlive a permanently purged library.
CREATE FUNCTION axiom_remove_reference_reading() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM reading_items WHERE target_type='reference' AND target_id=OLD.id;
 RETURN OLD;
END $$;
CREATE TRIGGER reference_reading_cleanup AFTER DELETE ON bibliography FOR EACH ROW EXECUTE FUNCTION axiom_remove_reference_reading();
`;
