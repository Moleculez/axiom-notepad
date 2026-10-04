// Keep one exact configuration snapshot alongside the one-package rollback slot.
// Package updates never rewrite documents or silently expand workspace grants.
export const pluginConfigurationMigration = `
ALTER TABLE plugin_installations
  ADD COLUMN previous_settings jsonb,
  ADD COLUMN previous_bindings jsonb;
`;
