/** Stable keyset browsing; existing request identities, content and history stay intact. */
export const planningIntakeMigration = `
CREATE INDEX planning_intake_created_page ON planning_intake(space_id,created_at DESC,id DESC);
CREATE INDEX planning_intake_status_page ON planning_intake(space_id,status,created_at DESC,id DESC);
CREATE INDEX planning_intake_author_page ON planning_intake(space_id,created_by,created_at DESC,id DESC);
`;
