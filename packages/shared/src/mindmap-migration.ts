/** Add a presentation profile; canonical source remains Markdown. */
export const mindmapMigration = `
ALTER TABLE tool_projects DROP CONSTRAINT tool_projects_kind_check;
ALTER TABLE tool_projects ADD CONSTRAINT tool_projects_kind_check CHECK(kind IN ('math','image','canvas','text','mindmap'));
`;
