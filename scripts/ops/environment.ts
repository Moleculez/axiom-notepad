export function environmentErrors(env: NodeJS.ProcessEnv) {
  const errors: string[] = [];
  const production = env.NODE_ENV === "production";
  if (env.AXIOM_BUILD)
    errors.push(
      "AXIOM_BUILD is a build-only flag and must not be set at runtime.",
    );
  for (const name of ["BETTER_AUTH_SECRET", "SYNC_SECRET"])
    if (
      !env[name] ||
      env[name]!.length < 32 ||
      /replace|example|build-only/i.test(env[name]!)
    )
      errors.push(
        `${name} needs a strong, unique secret of at least 32 characters.`,
      );
  if (env.BETTER_AUTH_SECRET === env.SYNC_SECRET)
    errors.push("Authentication and synchronization secrets must differ.");
  let origin: URL | undefined;
  try {
    origin = new URL(env.APP_URL ?? "");
    if (
      !["https:", "http:"].includes(origin.protocol) ||
      origin.origin !== env.APP_URL
    )
      errors.push(
        "APP_URL must be an HTTP(S) origin without credentials, path or trailing slash.",
      );
    if (production && origin.protocol !== "https:")
      errors.push("Production APP_URL must use HTTPS.");
  } catch {
    errors.push("APP_URL must be a valid origin.");
  }
  if (env.BETTER_AUTH_URL && env.BETTER_AUTH_URL !== env.APP_URL)
    errors.push("BETTER_AUTH_URL must match APP_URL.");
  try {
    const database = new URL(env.DATABASE_URL ?? "");
    if (
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      !database.hostname ||
      database.pathname.length < 2
    )
      errors.push("DATABASE_URL must identify a PostgreSQL host and database.");
    if (production && (!database.username || !database.password))
      errors.push("Production DATABASE_URL requires database credentials.");
  } catch {
    errors.push("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (production && env.NEXT_PUBLIC_SYNC_URL) {
    try {
      const sync = new URL(env.NEXT_PUBLIC_SYNC_URL);
      if (
        sync.protocol !== "wss:" ||
        sync.host !== origin?.host ||
        sync.pathname !== "/sync" ||
        sync.search ||
        sync.hash ||
        sync.username ||
        sync.password
      )
        errors.push(
          "Production synchronization must use the same-origin wss://.../sync endpoint; normally leave NEXT_PUBLIC_SYNC_URL unset.",
        );
    } catch {
      errors.push("NEXT_PUBLIC_SYNC_URL is invalid.");
    }
  }
  if (env.STORAGE_DRIVER && !["local", "s3"].includes(env.STORAGE_DRIVER))
    errors.push("STORAGE_DRIVER must be local or s3.");
  if (env.STORAGE_DRIVER === "s3" && (!env.S3_BUCKET || !env.AWS_REGION))
    errors.push("S3 storage needs S3_BUCKET and AWS_REGION.");
  if (
    production &&
    env.STORAGE_DRIVER !== "s3" &&
    !env.STORAGE_PATH?.startsWith("/")
  )
    errors.push("Production local storage requires an absolute STORAGE_PATH.");
  const identity = [
    "OIDC_DISCOVERY_URL",
    "OIDC_CLIENT_ID",
    "OIDC_CLIENT_SECRET",
  ];
  if (identity.some((key) => env[key]) && !identity.every((key) => env[key]))
    errors.push(
      "Institutional sign-in needs all three OIDC configuration values.",
    );
  if (env.OIDC_DISCOVERY_URL) {
    try {
      if (new URL(env.OIDC_DISCOVERY_URL).protocol !== "https:")
        errors.push("OIDC discovery must use HTTPS.");
    } catch {
      errors.push("OIDC_DISCOVERY_URL must be a valid HTTPS URL.");
    }
  }
  if (production && env.OIDC_LOCAL_TEST)
    errors.push("OIDC_LOCAL_TEST must not be enabled in production.");
  if (!!env.OFFICE_CONVERTER_URL !== !!env.OFFICE_CONVERTER_TOKEN)
    errors.push(
      "Office conversion requires both a private service URL and a secret token.",
    );
  if (
    env.TOOL_PROVIDER_KEY &&
    !/^[A-Za-z0-9+/]{43}=$/.test(env.TOOL_PROVIDER_KEY)
  )
    errors.push("TOOL_PROVIDER_KEY must be 32 random bytes encoded as base64.");
  return errors;
}
