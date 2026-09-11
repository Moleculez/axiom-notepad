export const desktopWorkflowsMigration = `
CREATE TABLE file_operations (
 id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
 command text NOT NULL CHECK(command IN ('move','copy','rename','trash','restore')),
 input jsonb NOT NULL, fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','cancelled')),
 results jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_operations_user ON file_operations(user_id,created_at DESC);
CREATE TABLE resource_personalization (
 user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
 resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,
 color text CHECK(color IN ('slate','blue','indigo','violet','rose','orange','amber','green','teal')),
 PRIMARY KEY(user_id,resource_id)
);
ALTER TABLE resources DROP CONSTRAINT resources_kind_check;
ALTER TABLE resources ADD CONSTRAINT resources_kind_check CHECK(kind IN ('folder','note','file','shortcut'));
ALTER TABLE resources ADD COLUMN shortcut_target_id uuid REFERENCES resources ON DELETE SET NULL;
ALTER TABLE resources ADD CONSTRAINT resources_shortcut_target_check CHECK(kind='shortcut' OR shortcut_target_id IS NULL);
CREATE INDEX resources_shortcut_target ON resources(shortcut_target_id) WHERE shortcut_target_id IS NOT NULL;
CREATE FUNCTION axiom_shortcut_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.shortcut_target_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.shortcut_target_id IS DISTINCT FROM OLD.shortcut_target_id) THEN
   IF NEW.shortcut_target_id=NEW.id OR NOT EXISTS(SELECT 1 FROM resources t WHERE t.id=NEW.shortcut_target_id AND t.space_id=NEW.space_id AND t.kind<>'shortcut' AND t.deleted_at IS NULL) THEN
     RAISE EXCEPTION 'Shortcuts must point to an available item in the same workspace, never another shortcut' USING ERRCODE='23514';
   END IF;
 END IF;
 IF NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM resources WHERE id=NEW.parent_id AND kind='shortcut') THEN
   RAISE EXCEPTION 'A shortcut cannot contain items' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER axiom_shortcut_guard BEFORE INSERT OR UPDATE OF shortcut_target_id,parent_id ON resources FOR EACH ROW EXECUTE FUNCTION axiom_shortcut_guard();
`;
