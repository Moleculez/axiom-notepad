import { describe, expect, it } from "vitest";
import { environmentErrors } from "../scripts/ops/environment";

const valid = {
  NODE_ENV: "production" as const,
  APP_URL: "https://notes.example.org",
  BETTER_AUTH_URL: "https://notes.example.org",
  DATABASE_URL: "postgresql://axiom:strongpassword@db:5432/axiom",
  BETTER_AUTH_SECRET: "a".repeat(64),
  SYNC_SECRET: "b".repeat(64),
  STORAGE_PATH: "/app/data/attachments",
};
describe("deployment configuration", () => {
  it("accepts HTTPS same-origin defaults with optional integrations disabled", () => {
    expect(environmentErrors(valid)).toEqual([]);
  });
  it.each([
    { APP_URL: "http://localhost:8080" },
    { APP_URL: "https://notes.example.org/" },
    { APP_URL: "https://user:password@notes.example.org" },
    { BETTER_AUTH_URL: "https://different.example.org" },
    { NEXT_PUBLIC_SYNC_URL: "ws://localhost:1234" },
    { NEXT_PUBLIC_SYNC_URL: "wss://another.example.org/sync" },
    { DATABASE_URL: "http://db:5432/axiom" },
    { DATABASE_URL: "postgres://db/axiom" },
    { STORAGE_PATH: "./data/attachments" },
    { SYNC_SECRET: valid.BETTER_AUTH_SECRET },
    { BETTER_AUTH_SECRET: "build-only-not-a-production-credential" },
    { OIDC_LOCAL_TEST: "1" },
    { OIDC_CLIENT_ID: "incomplete" },
    { OFFICE_CONVERTER_URL: "http://office-converter:8090" },
    { TOOL_PROVIDER_KEY: "invalid" },
  ])("rejects unsafe or incomplete production configuration %j", (override) => {
    expect(environmentErrors({ ...valid, ...override }).length).toBeGreaterThan(
      0,
    );
  });
  it("never includes supplied credential values in diagnostics", () => {
    const secret = "example-private-password-do-not-print";
    expect(
      environmentErrors({ ...valid, SYNC_SECRET: secret }).join(),
    ).not.toContain(secret);
  });
});
