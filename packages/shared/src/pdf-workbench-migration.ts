/** Additive safety and collaboration state; existing immutable PDFs are untouched. */
export const pdfWorkbenchMigration = `
ALTER TABLE upload_sessions ADD COLUMN expected_version_id uuid,
 ADD COLUMN expected_resource_version integer, ADD COLUMN provenance jsonb;
CREATE TABLE paper_annotation_replies (
 id uuid PRIMARY KEY, annotation_id uuid NOT NULL REFERENCES paper_annotations ON DELETE CASCADE,
 author_id text NOT NULL REFERENCES "user", body text NOT NULL CHECK(length(body) BETWEEN 1 AND 12000),
 version integer NOT NULL DEFAULT 1, mutation_id uuid NOT NULL, deleted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX paper_annotation_replies_thread ON paper_annotation_replies(annotation_id,created_at);
ALTER TABLE paper_annotations ADD COLUMN resolved boolean NOT NULL DEFAULT false;
CREATE TABLE paper_annotation_reads (
 annotation_id uuid NOT NULL REFERENCES paper_annotations ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES "user" ON DELETE CASCADE, read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(annotation_id,user_id));
CREATE TABLE file_provenance (version_id uuid PRIMARY KEY REFERENCES file_versions ON DELETE CASCADE,
 source_version_id uuid REFERENCES file_versions ON DELETE SET NULL, operation jsonb NOT NULL,
 created_by text NOT NULL REFERENCES "user", created_at timestamptz NOT NULL DEFAULT now());
`;
