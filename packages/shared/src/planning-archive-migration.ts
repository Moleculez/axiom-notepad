/** Additive read indexes only; existing identities, bodies and versions survive. */
export const planningArchiveMigration = `
CREATE INDEX planning_goals_created_page ON planning_goals(space_id,created_at DESC,id DESC);
CREATE INDEX planning_history_created_page ON planning_history(space_id,entity_id,created_at DESC,id DESC);
`;
