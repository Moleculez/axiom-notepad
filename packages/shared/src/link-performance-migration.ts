/** Reverse-edge lookup only. The existing primary key already covers authored
 * links; unresolved targets do not need entries in the backlink index. */
export const linkPerformanceMigration = `
CREATE INDEX IF NOT EXISTS note_links_target_source
ON note_links(target_id,source_id) WHERE target_id IS NOT NULL;
`;
