/** Versioned anchors never copy private annotation contents into task records. */
export const paperTaskMigration = `
CREATE TABLE task_paper_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES tasks ON DELETE CASCADE,
 annotation_id uuid NOT NULL REFERENCES paper_annotations ON DELETE CASCADE,
 version_id uuid REFERENCES file_versions ON DELETE SET NULL,
 page integer NOT NULL CHECK(page>0),
 author_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(task_id,annotation_id)
);
CREATE INDEX task_paper_links_annotation ON task_paper_links(annotation_id);
`;
