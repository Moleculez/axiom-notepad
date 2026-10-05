/** Import preparation is account-owned; only an atomic publisher creates shared resources. */
export const workspaceImportMigration = `
CREATE TABLE workspace_imports (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES "user", space_id uuid NOT NULL REFERENCES spaces,
 manifest jsonb NOT NULL, manifest_hash text NOT NULL, preview_hash text NOT NULL, plan jsonb NOT NULL,
 status text NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','publishing','blocked','complete','cancelled')),
 error text, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days'
);
CREATE INDEX workspace_imports_owner ON workspace_imports(owner_id,created_at DESC);
CREATE INDEX workspace_imports_expiry ON workspace_imports(expires_at) WHERE status NOT IN ('complete','cancelled');
CREATE TABLE workspace_import_entries (
 id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES workspace_imports ON DELETE CASCADE,
 path text NOT NULL, kind text NOT NULL CHECK(kind IN ('folder','note','file')),
 digest text, mime text, sha256 text, UNIQUE(batch_id,path)
);
ALTER TABLE upload_sessions ADD COLUMN import_entry_id uuid UNIQUE REFERENCES workspace_import_entries;
ALTER TABLE upload_sessions DROP CONSTRAINT upload_sessions_status_check;
ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_status_check CHECK(status IN ('uploading','verifying','staged','complete','cancelled','failed'));
ALTER TABLE upload_sessions DROP CONSTRAINT upload_sessions_bytes_check;
ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_bytes_check CHECK(bytes<=1000000000 AND (bytes>0 OR (bytes=0 AND import_entry_id IS NOT NULL)));
CREATE INDEX upload_sessions_imports ON upload_sessions(import_entry_id) WHERE import_entry_id IS NOT NULL;
`;
