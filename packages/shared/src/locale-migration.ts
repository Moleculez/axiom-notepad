/** Independent of appearance/editor schema versions and old client bundles. */
export const localeMigration = `
CREATE TABLE user_locale_preferences (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  locale text NOT NULL DEFAULT 'auto' CHECK (locale IN ('auto','en','zh-Hans','es','fr','ar','hi','pt-BR','ru','bn','id')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  mutation_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;
