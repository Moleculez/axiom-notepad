/** Bounded visit recovery and verified image metadata avoid repeated blob reads. */
export const revisionPerformanceMigration = `
ALTER TABLE revision_read_cursors ADD COLUMN visit_id uuid, ADD COLUMN previous jsonb;
CREATE INDEX revision_cursors_expiry ON revision_read_cursors(seen_at);
ALTER TABLE image_draft_assets ADD COLUMN width integer, ADD COLUMN height integer;
ALTER TABLE image_draft_assets ADD CONSTRAINT image_asset_dimensions CHECK (
 (width IS NULL AND height IS NULL) OR (width > 0 AND height > 0 AND width::bigint * height <= 16000000)
);
`;
