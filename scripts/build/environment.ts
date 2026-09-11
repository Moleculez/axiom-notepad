/** Build workers must never receive credentials for a working dataset/provider. */
export function buildEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...input };
  for (const key of Object.keys(env))
    if (
      /^(?:DATABASE_URL|RESTORE_DATABASE_URL|PG[A-Z_]*|POSTGRES_[A-Z_]*|SMTP_URL|OIDC_[A-Z_]*|TOOL_PROVIDER_[A-Z_]*|OFFICE_CONVERTER_[A-Z_]*|AWS_[A-Z_]*|S3_[A-Z_]*|AXIOM_ADMIN_PASSWORD|AXIOM_DATABASE_PASSWORD)$/.test(
        key,
      )
    )
      delete env[key];
  return {
    ...env,
    AXIOM_BUILD: "1",
    NODE_ENV: "production",
    BETTER_AUTH_SECRET: "build-only-auth-placeholder-0123456789",
    SYNC_SECRET: "build-only-sync-placeholder-0123456789",
  };
}
