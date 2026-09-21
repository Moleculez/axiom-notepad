/** Additive metadata only: no existing task, document or CRDT rewrites. */
export const planningExpansionMigration = `
CREATE TABLE planning_baselines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE,
 name text NOT NULL, snapshot jsonb NOT NULL, created_by text REFERENCES "user" ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), archived boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1
);
CREATE INDEX planning_baselines_space ON planning_baselines(space_id,created_at DESC);
CREATE TABLE group_portfolios (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), group_id uuid NOT NULL REFERENCES groups ON DELETE CASCADE,
 name text NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE portfolio_spaces (
 portfolio_id uuid NOT NULL REFERENCES group_portfolios ON DELETE CASCADE,
 space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE, PRIMARY KEY(portfolio_id,space_id)
);
CREATE TABLE group_availability (
 group_id uuid NOT NULL REFERENCES groups ON DELETE CASCADE, user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
 settings jsonb NOT NULL, version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(group_id,user_id)
);
ALTER TABLE groups ADD COLUMN capacity_version integer NOT NULL DEFAULT 1;
ALTER TABLE schedule_previews ADD COLUMN capacity_version integer;
ALTER TABLE assistant_conversations ADD COLUMN space_ids uuid[];
UPDATE assistant_conversations SET space_ids=ARRAY[space_id];
ALTER TABLE assistant_conversations ALTER COLUMN space_ids SET NOT NULL;
ALTER TABLE tool_jobs DROP CONSTRAINT tool_jobs_kind_check;
ALTER TABLE tool_jobs ADD CONSTRAINT tool_jobs_kind_check CHECK(kind IN ('office-preview','ocr','generate','check','explain','assistant','assistant-evidence'));
`;
