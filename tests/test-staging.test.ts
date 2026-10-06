import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  stagingEnvironment,
  reliabilityStagingProfile as profile,
} from "../packages/shared/src/test-staging";
const control = {
  NODE_ENV: "development" as const,
  DATABASE_URL: "postgresql://user:secret@127.0.0.1:54339/postgres",
  STORAGE_PATH: resolve("data/attachments"),
  SMTP_URL: "smtp://real",
  OIDC_CLIENT_SECRET: "real",
  TOOL_PROVIDER_KEY: "real",
  TOOL_PROVIDER_ALLOWED_ORIGINS: "https://real.example",
};
describe("staging preflight", () => {
  it("provides an exact target and strips inherited outbound credentials", () => {
    const env = stagingEnvironment(profile, control);
    expect(new URL(env.DATABASE_URL).pathname).toBe("/axiom_plugins_test");
    expect(env.STORAGE_PATH).toBe(resolve("data/reliability-test-attachments"));
    expect(env.SMTP_URL).toBe("");
    expect(env.OIDC_CLIENT_SECRET).toBe("");
    expect(env.TOOL_PROVIDER_KEY).toBe(
      Buffer.alloc(32, 0x31).toString("base64"),
    );
    expect(env.TOOL_PROVIDER_ALLOWED_ORIGINS).toBe("http://127.0.0.1:8096");
    expect(env.SYNC_HOST).toBe("127.0.0.1");
  });
  it.each([
    { database: "axiom" },
    { database: "axiom_custom_test" },
    { storage: "data/attachments" },
    { storage: "data" },
    { webPort: 8080 },
    { syncPort: 1234 },
    { webPort: 3002 },
    { webPort: NaN },
    { syncPort: -1 },
    { dist: ".next" },
    { dist: ".next/dev-8080" },
    { dist: ".next/reliability-test/../../dev-8080" },
    { devDist: ".next/dev-8080" },
  ])("rejects unsafe profile before side effects: %j", (change) => {
    expect(() =>
      stagingEnvironment({ ...profile, ...change }, control),
    ).toThrow();
  });
  it.each([
    { NODE_ENV: "production" as const },
    { DATABASE_URL: "postgresql://host.example/postgres" },
    { DATABASE_URL: "postgresql://localhost/postgres?host=remote" },
    { DATABASE_URL: "postgresql://localhost/postgres#override" },
    { DATABASE_URL: "http://localhost/postgres" },
    { DATABASE_URL: "postgresql://localhost/axiom_plugins_test" },
    { STORAGE_PATH: resolve(profile.storage) },
  ])("rejects unsafe inherited environment: %j", (change) => {
    expect(() =>
      stagingEnvironment(profile, { ...control, ...change }),
    ).toThrow();
  });
});
