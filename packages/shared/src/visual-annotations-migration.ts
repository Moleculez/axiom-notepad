export const visualAnnotationsMigration = `
CREATE TABLE visual_annotations (
 id uuid PRIMARY KEY,
 resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,
 author_id text NOT NULL REFERENCES "user" ON DELETE CASCADE,
 parent_id uuid REFERENCES visual_annotations ON DELETE CASCADE,
 data jsonb NOT NULL,
 visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
 version integer NOT NULL DEFAULT 1,
 mutation_id uuid NOT NULL,
 mutation_hash text NOT NULL,
 deleted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX visual_annotations_resource ON visual_annotations(resource_id,created_at,id);
CREATE INDEX visual_annotations_parent ON visual_annotations(parent_id);
`;
