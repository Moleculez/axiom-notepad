/** Private assistant state. Accepted documents and existing provider grants are unchanged. */
export const assistantMigration = `
CREATE TABLE assistant_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
 space_id uuid NOT NULL REFERENCES spaces ON DELETE CASCADE, title text NOT NULL DEFAULT 'Research conversation',
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX assistant_conversations_owner ON assistant_conversations(owner_id,space_id,updated_at DESC);
CREATE TABLE assistant_contexts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES assistant_conversations ON DELETE CASCADE,
 provider_id uuid REFERENCES tool_providers ON DELETE SET NULL, provider_version integer NOT NULL,
 prompt text NOT NULL, evidence jsonb NOT NULL, bases jsonb NOT NULL DEFAULT '{}', messages jsonb NOT NULL, history_ids uuid[] NOT NULL DEFAULT '{}',
 allow_task_create boolean NOT NULL DEFAULT false, fingerprint text NOT NULL, conversation_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes', submitted_at timestamptz, cleared_at timestamptz
);
CREATE INDEX assistant_contexts_conversation ON assistant_contexts(conversation_id,created_at);
ALTER TABLE tool_jobs DROP CONSTRAINT tool_jobs_kind_check;
ALTER TABLE tool_jobs ADD CONSTRAINT tool_jobs_kind_check CHECK(kind IN ('office-preview','ocr','generate','check','explain','assistant'));
ALTER TABLE tool_jobs ADD COLUMN assistant_context_id uuid REFERENCES assistant_contexts ON DELETE SET NULL;
CREATE UNIQUE INDEX assistant_job_context ON tool_jobs(assistant_context_id) WHERE assistant_context_id IS NOT NULL;
CREATE TABLE assistant_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES tool_jobs ON DELETE CASCADE,
 data jsonb NOT NULL, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','applied','undone','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE assistant_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposal_id uuid NOT NULL REFERENCES assistant_proposals ON DELETE CASCADE,
 data jsonb NOT NULL, before_data jsonb, fingerprint text NOT NULL, result jsonb, inverse jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 applied_at timestamptz, undone_at timestamptz
);
CREATE UNIQUE INDEX assistant_receipt_applied ON assistant_receipts(proposal_id) WHERE applied_at IS NOT NULL;
`;
