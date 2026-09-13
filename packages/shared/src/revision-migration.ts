/** Forward-only: immutable bodies/bytes remain in their existing stores. */
export const revisionMigration =
  [
    "ALTER TABLE snapshots ADD COLUMN settings jsonb, ADD COLUMN metadata_version integer NOT NULL DEFAULT 1",
    "ALTER TABLE file_versions ADD COLUMN label text, ADD COLUMN metadata_version integer NOT NULL DEFAULT 1",
    "ALTER TABLE tool_history ADD COLUMN metadata_version integer NOT NULL DEFAULT 1",
    "CREATE TABLE revision_suggestions (id uuid PRIMARY KEY, note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE, generation integer NOT NULL, author_id text NOT NULL REFERENCES \"user\", version integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','withdrawn')), hunks jsonb NOT NULL, message text NOT NULL DEFAULT '', decided_by text REFERENCES \"user\", decision_id uuid, decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())",
    "CREATE INDEX revision_suggestions_note ON revision_suggestions(note_id,status,created_at,id)",
    'CREATE TABLE revision_suggestion_replies (id uuid PRIMARY KEY, suggestion_id uuid NOT NULL REFERENCES revision_suggestions ON DELETE CASCADE, author_id text NOT NULL REFERENCES "user", body text NOT NULL CHECK(length(body) BETWEEN 1 AND 10000), created_at timestamptz NOT NULL DEFAULT now())',
    "CREATE TABLE revision_decisions (id uuid PRIMARY KEY, note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE, generation integer NOT NULL, actor_id text NOT NULL REFERENCES \"user\", action text NOT NULL, suggestions jsonb NOT NULL, inverse_hunks jsonb NOT NULL DEFAULT '[]', undone boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())",
    'CREATE TABLE revision_read_cursors (user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE, resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE, body text, settings jsonb, generation integer, version_id uuid REFERENCES file_versions ON DELETE SET NULL, seen_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,resource_id))',
    "ALTER TABLE review_requests ALTER COLUMN project_id DROP NOT NULL, ALTER COLUMN note_id DROP NOT NULL, ALTER COLUMN snapshot_id DROP NOT NULL, ADD COLUMN resource_id uuid REFERENCES resources ON DELETE CASCADE, ADD COLUMN file_version_id uuid REFERENCES file_versions ON DELETE RESTRICT",
    "UPDATE review_requests SET resource_id=note_id",
    "ALTER TABLE review_requests ADD CONSTRAINT review_revision_target CHECK ((snapshot_id IS NOT NULL AND note_id IS NOT NULL AND file_version_id IS NULL) OR (snapshot_id IS NULL AND file_version_id IS NOT NULL AND resource_id IS NOT NULL))",
    "CREATE INDEX review_resource ON review_requests(resource_id,created_at)",
    "CREATE TABLE image_draft_assets (id uuid PRIMARY KEY, resource_id uuid NOT NULL REFERENCES tool_projects ON DELETE CASCADE, sha256 text NOT NULL, bytes bigint NOT NULL, storage_key uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(resource_id,sha256))",
    'CREATE TABLE image_cloud_drafts (resource_id uuid PRIMARY KEY REFERENCES tool_projects ON DELETE CASCADE, revision bigint NOT NULL DEFAULT 0, owner_id text NOT NULL REFERENCES "user", base_version uuid REFERENCES file_versions ON DELETE RESTRICT, manifest jsonb NOT NULL, previous_manifest jsonb, previous_base_version uuid REFERENCES file_versions ON DELETE RESTRICT, updated_at timestamptz NOT NULL DEFAULT now())',
  ].join(";\n") + ";\n";
