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

/** Extend the deployed constraint forward; never rewrite migration 51. */
export const localeExpansionMigration = `
ALTER TABLE user_locale_preferences DROP CONSTRAINT user_locale_preferences_locale_check;
ALTER TABLE user_locale_preferences ALTER COLUMN locale SET DEFAULT 'en';
UPDATE user_locale_preferences SET locale='auto',version=version+1,mutation_id=gen_random_uuid(),updated_at=now() WHERE locale='ar';
ALTER TABLE user_locale_preferences ADD CONSTRAINT user_locale_preferences_locale_check
  CHECK (locale IN ('auto','en','zh-Hans','es','fr','ja','ko','de','hi','pt-BR','ru','bn','id'));
`;
