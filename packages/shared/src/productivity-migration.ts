export const productivityMigration = `
ALTER TABLE members ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE FUNCTION axiom_membership_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 NEW.version := OLD.version + 1; RETURN NEW;
END $$;
CREATE TRIGGER axiom_membership_revision BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION axiom_membership_revision();
ALTER TABLE invitations ADD COLUMN content_role text NOT NULL DEFAULT 'editor' CHECK(content_role IN ('viewer','commenter','editor')),
 ADD COLUMN revoked_at timestamptz, ADD COLUMN revoked_by text REFERENCES "user" ON DELETE SET NULL,
 ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE INDEX invitations_group_page ON invitations(group_id,created_at DESC,id);
CREATE TABLE trash_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
 action text NOT NULL CHECK(action IN ('purge','restore')), status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','queued','running','completed','cancelled')),
 scope_ids uuid[] NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 confirmed_at timestamptz, attempt integer NOT NULL DEFAULT 0
);
CREATE INDEX trash_operations_user ON trash_operations(user_id,created_at DESC);
CREATE TABLE trash_operation_items (
 operation_id uuid NOT NULL REFERENCES trash_operations ON DELETE CASCADE, resource_id uuid NOT NULL,
 space_id uuid NOT NULL, component_id uuid NOT NULL, version integer NOT NULL, deleted_at timestamptz NOT NULL,
 parent_id uuid, kind text NOT NULL, note_id uuid, name text NOT NULL, original_path text NOT NULL DEFAULT '', bytes bigint NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','blocked','skipped','cancelled')), reason text,
 PRIMARY KEY(operation_id,resource_id)
);
CREATE INDEX trash_items_progress ON trash_operation_items(operation_id,status,component_id);
`;
