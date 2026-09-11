import { expect, it } from "vitest";
import { buildEnvironment } from "../scripts/build/environment";

it("strips dataset/provider credentials, replaces secrets and preserves explicit build selection", () => {
  const input = {
    NODE_ENV: "development" as const,
    PATH: "/usr/bin",
    DATABASE_URL: "private-db",
    PGPASSWORD: "private-pg",
    POSTGRES_PASSWORD: "private-postgres",
    AXIOM_DATABASE_PASSWORD: "private-compose-db",
    OIDC_CLIENT_SECRET: "private-oidc",
    SMTP_URL: "private-mail",
    AWS_SECRET_ACCESS_KEY: "private-s3",
    TOOL_PROVIDER_KEY: "private-key",
    OFFICE_CONVERTER_TOKEN: "private-office",
    BETTER_AUTH_SECRET: "private-auth",
    SYNC_SECRET: "private-sync",
    AXIOM_DIST_DIR: ".next/candidate",
    NEXT_PUBLIC_AXIOM_EDITOR_ENGINE: "milkdown",
  };
  const env = buildEnvironment(input);
  expect(JSON.stringify(env)).not.toContain("private-");
  expect(env).toMatchObject({
    PATH: "/usr/bin",
    AXIOM_BUILD: "1",
    NODE_ENV: "production",
    AXIOM_DIST_DIR: ".next/candidate",
    NEXT_PUBLIC_AXIOM_EDITOR_ENGINE: "milkdown",
  });
  expect(input.DATABASE_URL).toBe("private-db");
});
