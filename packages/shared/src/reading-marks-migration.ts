export const readingMarksMigration = `
ALTER TABLE comments
 ADD COLUMN kind text NOT NULL DEFAULT 'discussion' CHECK(kind IN ('discussion','annotation')),
 ADD COLUMN visibility text NOT NULL DEFAULT 'shared' CHECK(visibility IN ('private','shared')),
 ADD COLUMN title text NOT NULL DEFAULT '',
 ADD COLUMN category text NOT NULL DEFAULT 'note' CHECK(category IN ('note','question','idea','follow-up')),
 ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
 ADD COLUMN body_format text NOT NULL DEFAULT 'plain' CHECK(body_format IN ('plain','markdown')),
 ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD COLUMN mutation_id uuid,
 ADD COLUMN mutation_hash text,
 ADD COLUMN deleted boolean NOT NULL DEFAULT false,
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX comments_threads ON comments(note_id,parent_id,created_at);
`;
