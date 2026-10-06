/** Forward-only: existing extension consent gets a full upgrade grace period. */
export const stagePortabilityMigration = `
ALTER TABLE plugin_grants ADD COLUMN expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '720 hours';
ALTER TABLE plugin_group_approvals ADD COLUMN expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '720 hours';
CREATE INDEX plugin_grants_expiry ON plugin_grants(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX plugin_approvals_expiry ON plugin_group_approvals(expires_at) WHERE enabled;
`;
