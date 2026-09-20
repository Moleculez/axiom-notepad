import { workspaceMigration } from "./workspace-migration";
import { workspaceFilesMigration } from "./workspace-files-migration";
import { spaceLifecycleMigration } from "./space-lifecycle-migration";
import { productivityMigration } from "./productivity-migration";
import { desktopWorkflowsMigration } from "./desktop-workflows-migration";
import { auditMigration } from "./audit-migration";
import { managementHardeningMigration } from "./management-hardening-migration";
import { auditCascadeMigration } from "./audit-cascade-migration";
import { integrationMigration } from "./integration-migration";
import { readingMarksMigration } from "./reading-marks-migration";
import { visualAnnotationsMigration } from "./visual-annotations-migration";
import { revisionMigration } from "./revision-migration";
import { pdfWorkbenchMigration } from "./pdf-workbench-migration";
import { pdfOcrMigration } from "./pdf-ocr-migration";
import { assistantMigration } from "./assistant-migration";
export const migration = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, email_verified boolean NOT NULL DEFAULT false, image text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS session (id text PRIMARY KEY, expires_at timestamptz NOT NULL, token text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), ip_address text, user_agent text, user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS session_user_idx ON session(user_id);
CREATE TABLE IF NOT EXISTS account (id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE, access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz, scope text, password text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS verification_identifier ON verification(identifier);
CREATE TABLE IF NOT EXISTS groups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, description text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS members (group_id uuid NOT NULL REFERENCES groups ON DELETE CASCADE, user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE, role text NOT NULL CHECK(role IN ('owner','admin','member')), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(group_id,user_id));
CREATE TABLE IF NOT EXISTS invitations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES groups ON DELETE CASCADE, email text NOT NULL, role text NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')), token_hash text NOT NULL UNIQUE, invited_by text NOT NULL REFERENCES "user", expires_at timestamptz NOT NULL, accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES groups ON DELETE CASCADE, name text NOT NULL, description text NOT NULL DEFAULT '', color text NOT NULL DEFAULT 'blue', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES groups ON DELETE CASCADE, project_id uuid REFERENCES projects ON DELETE SET NULL, author_id text NOT NULL REFERENCES "user", parent_id uuid REFERENCES notes ON DELETE SET NULL, title text NOT NULL DEFAULT 'Untitled', visibility text NOT NULL DEFAULT 'shared' CHECK(visibility IN ('shared','private')), tags text[] NOT NULL DEFAULT '{}', body text NOT NULL DEFAULT '', plain_text text NOT NULL DEFAULT '', generation integer NOT NULL DEFAULT 1, version integer NOT NULL DEFAULT 1, dialect text NOT NULL DEFAULT 'stem-v1', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz);
CREATE INDEX IF NOT EXISTS note_scope ON notes(group_id,visibility,author_id);
CREATE INDEX IF NOT EXISTS note_search ON notes USING gin(to_tsvector('simple', title || ' ' || plain_text));
CREATE INDEX IF NOT EXISTS note_title_fuzzy ON notes USING gin(lower(title) gin_trgm_ops);
CREATE TABLE IF NOT EXISTS documents (room text PRIMARY KEY, note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE, state bytea NOT NULL, revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS document_updates (id bigserial PRIMARY KEY, room text NOT NULL, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS updates_room ON document_updates(room,id);
CREATE TABLE IF NOT EXISTS note_links (source_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE, target text NOT NULL, target_id uuid REFERENCES notes ON DELETE SET NULL, PRIMARY KEY(source_id,target));
CREATE TABLE IF NOT EXISTS favorites (user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE, note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE, PRIMARY KEY(user_id,note_id));
CREATE TABLE IF NOT EXISTS comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE, author_id text NOT NULL REFERENCES "user", parent_id uuid REFERENCES comments ON DELETE CASCADE, body text NOT NULL, anchor jsonb, resolved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE, note_id uuid REFERENCES notes ON DELETE CASCADE, message text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE, title text NOT NULL, body text NOT NULL, state bytea NOT NULL, generation integer NOT NULL, label text, author_id text REFERENCES "user" ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS snapshots_note ON snapshots(note_id,created_at DESC);
CREATE TABLE IF NOT EXISTS attachments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE, name text NOT NULL, mime text NOT NULL, bytes bigint NOT NULL, storage_key text NOT NULL UNIQUE, sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS bibliography (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES groups ON DELETE CASCADE, cite_key text NOT NULL, title text NOT NULL, authors text NOT NULL DEFAULT '', year text NOT NULL DEFAULT '', url text NOT NULL DEFAULT '', bibtex text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(group_id,cite_key));
CREATE OR REPLACE FUNCTION axiom_validate_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent notes%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.group_id::text));
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent FROM notes WHERE id=NEW.parent_id;
    IF NOT FOUND OR parent.group_id<>NEW.group_id OR parent.visibility<>NEW.visibility
       OR parent.project_id IS DISTINCT FROM NEW.project_id
       OR (NEW.visibility='private' AND parent.author_id<>NEW.author_id)
       OR EXISTS(WITH RECURSIVE ancestors AS (
          SELECT id,parent_id FROM notes WHERE id=NEW.parent_id
          UNION SELECT n.id,n.parent_id FROM notes n JOIN ancestors a ON n.id=a.parent_id
       ) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN
      RAISE EXCEPTION 'Invalid note hierarchy' USING ERRCODE='23514';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM notes WHERE parent_id=NEW.id AND deleted_at IS NULL
    AND (group_id<>NEW.group_id OR visibility<>NEW.visibility OR project_id IS DISTINCT FROM NEW.project_id)) THEN
    RAISE EXCEPTION 'Move child notes first' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER axiom_note_hierarchy BEFORE INSERT OR UPDATE OF parent_id,project_id,visibility,group_id ON notes FOR EACH ROW EXECUTE FUNCTION axiom_validate_hierarchy();
`;

// The initial idempotent baseline above is retained for existing installations.
// New releases append numbered migrations; never edit an applied migration.
export const forwardMigrations = [
  {
    version: 1,
    name: "appearance-and-reading",
    sql: `
CREATE TABLE user_preferences (user_id text PRIMARY KEY REFERENCES "user" ON DELETE CASCADE, preferences jsonb NOT NULL, version integer NOT NULL DEFAULT 1, mutation_id uuid, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE bibliography ADD COLUMN doi text NOT NULL DEFAULT '', ADD COLUMN arxiv text NOT NULL DEFAULT '', ADD COLUMN venue text NOT NULL DEFAULT '', ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE reference_attachments (reference_id uuid NOT NULL REFERENCES bibliography ON DELETE CASCADE, attachment_id uuid NOT NULL REFERENCES attachments ON DELETE CASCADE, PRIMARY KEY(reference_id,attachment_id));
CREATE TABLE reference_notes (reference_id uuid NOT NULL REFERENCES bibliography ON DELETE CASCADE, note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE, PRIMARY KEY(reference_id,note_id));
CREATE TABLE paper_annotations (id uuid PRIMARY KEY, attachment_id uuid NOT NULL REFERENCES attachments ON DELETE CASCADE, author_id text NOT NULL REFERENCES "user" ON DELETE CASCADE, data jsonb NOT NULL, shared boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1, mutation_id uuid NOT NULL, deleted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX paper_annotations_scope ON paper_annotations(attachment_id,author_id);
CREATE TABLE reading_items (id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE, group_id uuid NOT NULL REFERENCES groups ON DELETE CASCADE, kind text NOT NULL CHECK(kind IN ('bookmark','progress','reading','filter')), target_type text NOT NULL CHECK(target_type IN ('note','attachment','reference','group')), target_id uuid NOT NULL, data jsonb NOT NULL, version integer NOT NULL DEFAULT 1, mutation_id uuid NOT NULL, deleted boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX reading_items_scope ON reading_items(user_id,group_id);
CREATE UNIQUE INDEX reading_items_singleton ON reading_items(user_id,kind,target_type,target_id) WHERE kind IN ('progress','reading') AND NOT deleted;
CREATE TABLE metadata_requests (user_id text PRIMARY KEY REFERENCES "user" ON DELETE CASCADE, requested_at timestamptz NOT NULL DEFAULT now());
`,
  },
  {
    version: 2,
    name: "appearance-restore-point",
    sql: `ALTER TABLE user_preferences ADD COLUMN previous_preferences jsonb;`,
  },
  {
    version: 3,
    name: "editor-preferences",
    sql: `CREATE TABLE user_editor_preferences (user_id text PRIMARY KEY REFERENCES "user" ON DELETE CASCADE, preferences jsonb NOT NULL, version integer NOT NULL DEFAULT 1, mutation_id uuid, updated_at timestamptz NOT NULL DEFAULT now());`,
  },
  { version: 4, name: "unified-research-workspace", sql: workspaceMigration },
  {
    version: 5,
    name: "workspace-identity-and-compatibility",
    sql: `
ALTER TABLE "user" ADD COLUMN two_factor_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE two_factor(id text PRIMARY KEY,user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,secret text NOT NULL,backup_codes text NOT NULL,verified boolean NOT NULL DEFAULT true,failed_verification_count integer NOT NULL DEFAULT 0,locked_until timestamptz);
CREATE INDEX two_factor_user ON two_factor(user_id);
CREATE INDEX two_factor_secret ON two_factor(secret);
ALTER TABLE user_profiles ADD COLUMN avatar_key uuid,ADD COLUMN avatar_sha256 text;
ALTER TABLE attachments DROP CONSTRAINT attachments_storage_key_key;
CREATE INDEX attachments_storage_keys ON attachments(storage_key);
ALTER TABLE reading_items DROP CONSTRAINT reading_items_group_id_fkey;
COMMENT ON COLUMN reading_items.group_id IS 'Legacy field name: authorized reading context, either group ID or personal/project space ID. Target authorization is always checked.';
CREATE FUNCTION axiom_revoke_connections() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_notify('axiom_access','changed'); RETURN NULL; END $$;
CREATE TRIGGER axiom_members_access AFTER DELETE OR UPDATE ON members FOR EACH STATEMENT EXECUTE FUNCTION axiom_revoke_connections();
CREATE TRIGGER axiom_project_members_access AFTER INSERT OR DELETE OR UPDATE ON project_members FOR EACH STATEMENT EXECUTE FUNCTION axiom_revoke_connections();
CREATE TRIGGER axiom_projects_access AFTER UPDATE OF audience ON projects FOR EACH STATEMENT EXECUTE FUNCTION axiom_revoke_connections();
CREATE TRIGGER axiom_sessions_access AFTER DELETE ON session FOR EACH STATEMENT EXECUTE FUNCTION axiom_revoke_connections();
`,
  },
  {
    version: 6,
    name: "immutable-file-usage-and-exports",
    sql: workspaceFilesMigration,
  },
  {
    version: 7,
    name: "workspace-access-serialization",
    sql: `
CREATE OR REPLACE FUNCTION axiom_space_role(who text,scope uuid) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN s.kind='personal' THEN CASE WHEN s.owner_id=who THEN 'editor' END
  WHEN m.user_id IS NULL THEN NULL
  WHEN p.archived_at IS NOT NULL THEN CASE WHEN p.audience='group' OR pm.role IS NOT NULL THEN 'viewer' END
  WHEN s.kind='team' OR p.audience='group' THEN coalesce(pm.role,m.content_role)
  ELSE pm.role END
 FROM spaces s LEFT JOIN members m ON m.group_id=s.group_id AND m.user_id=who
 LEFT JOIN projects p ON p.id=s.project_id LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=who WHERE s.id=scope;
$$;
CREATE FUNCTION axiom_serialize_membership_access() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='members' THEN
  PERFORM id FROM spaces WHERE group_id=coalesce(NEW.group_id,OLD.group_id) ORDER BY id FOR UPDATE;
 ELSE
  PERFORM id FROM spaces WHERE project_id=coalesce(NEW.project_id,OLD.project_id) ORDER BY id FOR UPDATE;
 END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER axiom_members_serialize BEFORE INSERT OR DELETE OR UPDATE ON members FOR EACH ROW EXECUTE FUNCTION axiom_serialize_membership_access();
CREATE TRIGGER axiom_project_members_serialize BEFORE INSERT OR DELETE OR UPDATE ON project_members FOR EACH ROW EXECUTE FUNCTION axiom_serialize_membership_access();
CREATE TRIGGER axiom_project_archival_access AFTER UPDATE OF archived_at ON projects FOR EACH STATEMENT EXECUTE FUNCTION axiom_revoke_connections();
`,
  },
  {
    version: 8,
    name: "recoverable-workspace-lifecycle",
    sql: spaceLifecycleMigration,
  },
  {
    version: 9,
    name: "productivity-admin-and-trash",
    sql: productivityMigration,
  },
  {
    version: 10,
    name: "desktop-file-workflows",
    sql: desktopWorkflowsMigration,
  },
  {
    version: 11,
    name: "explicit-trash-restore-destination",
    sql: `ALTER TABLE trash_operations ADD COLUMN restore_policy text NOT NULL DEFAULT 'root' CHECK(restore_policy IN ('root','retain'));`,
  },
  {
    version: 12,
    name: "research-studios-and-private-previews",
    sql: researchToolsMigration,
  },
  {
    version: 13,
    name: "durable-audit-and-management-console",
    sql: auditMigration,
  },
  {
    version: 14,
    name: "preserved-trash-context-and-purged-workspace-names",
    sql: managementHardeningMigration,
  },
  {
    version: 15,
    name: "retained-audit-scopes-through-cascade-deletion",
    sql: auditCascadeMigration,
  },
  {
    version: 16,
    name: "canvas-and-productivity-documents",
    sql: productivityPlatformMigration,
  },
  { version: 17, name: "oauth-mcp-connections", sql: integrationMigration },
  {
    version: 18,
    name: "canvas-bundles-and-dataset-identity",
    sql: `
ALTER TABLE workspace_exports ADD COLUMN options jsonb NOT NULL DEFAULT '{}';
CREATE TABLE app_instance(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), dataset_id uuid NOT NULL DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), setup_completed_at timestamptz, setup_token_hash text, setup_email text);
INSERT INTO app_instance(singleton,setup_completed_at) SELECT true,CASE WHEN EXISTS(SELECT 1 FROM "user") THEN now() END;
`,
  },
  {
    version: 19,
    name: "reading-marks-and-private-note-annotations",
    sql: readingMarksMigration,
  },
  {
    version: 20,
    name: "placement-specific-visual-annotations",
    sql: visualAnnotationsMigration,
  },
  {
    version: 21,
    name: "resource-revisions-and-review",
    sql: revisionMigration,
  },
  {
    version: 22,
    name: "proposal-references-and-draft-retention",
    sql: revisionRetentionMigration,
  },
  {
    version: 23,
    name: "bounded-visits-and-image-metadata-cache",
    sql: revisionPerformanceMigration,
  },
  {
    version: 24,
    name: "reversible-decision-attachment-retention",
    sql: revisionUndoRetentionMigration,
  },
  {
    version: 25,
    name: "unified-workspaces-and-planning",
    sql: unifiedWorkspacesMigration,
  },
  {
    version: 26,
    name: "pdf-workbench-safety-and-threads",
    sql: pdfWorkbenchMigration,
  },
  { version: 27, name: "private-durable-pdf-ocr", sql: pdfOcrMigration },
  { version: 28, name: "private-workspace-assistant", sql: assistantMigration },
];
import { unifiedWorkspacesMigration } from "./unified-workspaces-migration";
import { revisionUndoRetentionMigration } from "./revision-undo-retention-migration";
import { revisionPerformanceMigration } from "./revision-performance-migration";
import { revisionRetentionMigration } from "./revision-retention-migration";
import { productivityPlatformMigration } from "./productivity-platform-migration";
import { researchToolsMigration } from "./research-tools-migration";
