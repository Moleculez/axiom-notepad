export const assistantGroundingMigration = `
ALTER TABLE tool_jobs DROP CONSTRAINT tool_jobs_status_check;
ALTER TABLE tool_jobs ADD CONSTRAINT tool_jobs_status_check CHECK(status IN ('queued','running','awaiting-review','complete','failed','cancelled','uncertain'));
CREATE TABLE assistant_run_reviews (
 id uuid PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES assistant_runs ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 8),
 fingerprint text NOT NULL CHECK(length(fingerprint)=64),
 envelope jsonb NOT NULL,
 prefix_messages jsonb NOT NULL DEFAULT '[]',
 read_results jsonb NOT NULL DEFAULT '[]',
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','superseded')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 approved_at timestamptz,
 approval_mutation_id uuid UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_run_reviews_run ON assistant_run_reviews(run_id,ordinal,created_at);
ALTER TABLE assistant_runs ADD COLUMN review_id uuid REFERENCES assistant_run_reviews ON DELETE SET NULL;
ALTER TABLE assistant_run_steps ADD COLUMN review_id uuid REFERENCES assistant_run_reviews ON DELETE SET NULL;
ALTER TABLE assistant_run_steps ADD COLUMN usage jsonb;
ALTER TABLE assistant_run_steps ADD COLUMN response jsonb;
ALTER TABLE assistant_run_steps ADD COLUMN outcome text NOT NULL DEFAULT 'dispatched' CHECK(outcome IN ('dispatched','complete','uncertain'));
ALTER TABLE assistant_run_steps ADD COLUMN request_characters integer;
ALTER TABLE assistant_run_steps ADD COLUMN finalized_at timestamptz;
UPDATE assistant_run_steps SET outcome='complete' WHERE completed_at IS NOT NULL;
-- Never grandfather broad discovery consent into approval for another dispatch.
UPDATE tool_jobs j SET status='awaiting-review',lease_until=NULL,error='Review the exact next context before continuing.'
 FROM assistant_runs r WHERE r.id=j.id AND j.status='queued';
ALTER TABLE workspace_change_sets ADD COLUMN recovery_of uuid REFERENCES workspace_change_sets ON DELETE SET NULL;
`;
