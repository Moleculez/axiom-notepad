import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { twoFactor, jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import nodemailer from "nodemailer";
import { db, query } from "./db";
import * as schema from "./schema";
import * as oauthSchema from "./oauth-schema";
export const appUrl =
  process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
export const institutionalIdentity = {
  enabled: !!(
    process.env.OIDC_DISCOVERY_URL &&
    process.env.OIDC_CLIENT_ID &&
    process.env.OIDC_CLIENT_SECRET
  ),
  name: process.env.OIDC_DISPLAY_NAME ?? "Institutional account",
};
if (institutionalIdentity.enabled) {
  if (process.env.NODE_ENV === "production" && process.env.OIDC_LOCAL_TEST)
    throw new Error(
      "Local identity testing must not be enabled in production.",
    );
  const issuer = new URL(process.env.OIDC_DISCOVERY_URL!);
  if (
    issuer.protocol !== "https:" &&
    !(
      process.env.OIDC_LOCAL_TEST === "1" &&
      ["localhost", "127.0.0.1"].includes(issuer.hostname)
    )
  )
    throw new Error("Institutional OIDC discovery requires HTTPS.");
}
export async function sendMail(to: string, subject: string, text: string) {
  if (!process.env.SMTP_URL) return false;
  await nodemailer.createTransport(process.env.SMTP_URL).sendMail({
    from: process.env.MAIL_FROM ?? "Axiom <notebook@localhost>",
    to,
    subject,
    text,
  });
  return true;
}
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { ...schema, ...oauthSchema },
  }),
  baseURL: appUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [appUrl],
  plugins: [
    jwt(),
    // Auth construction eagerly seeds OAuth resources. Compilation is database-
    // free; runtime retains the full MCP/CIMD plugins and permission contracts.
    ...(process.env.AXIOM_BUILD === "1"
      ? ([] as const)
      : ([
          mcp({
            resource: `${appUrl}/mcp`,
            loginPage: "/connect",
            consentPage: "/connect",
            scopes: [
              "openid",
              "offline_access",
              "workspace:read",
              "workspace:write",
              "workspace:manage",
            ],
            grantTypes: ["authorization_code", "refresh_token"],
            accessTokenExpiresIn: 900,
            allowDynamicClientRegistration: true,
            allowUnauthenticatedClientRegistration: true,
            clientPrivileges: async () => false,
            resourcePrivileges: async () => false,
            customAccessTokenClaims: async ({ user }) => ({
              // Bind issued JWTs to an exact consent revision. Revoking and then
              // reconnecting the same client must never revive an old access token.
              axiom_grants: user
                ? Object.fromEntries(
                    (
                      await query<{ id: string; revision: string }>(
                        "SELECT id,updated_at::text AS revision FROM integration_connections WHERE user_id=$1 AND revoked_at IS NULL",
                        [user.id],
                      )
                    ).map((row) => [row.id, row.revision]),
                  )
                : {},
            }),
          }),
          cimd({
            metadataProfile: "mcp-2026-07-28",
            fetchClientMetadataResource,
            metadataFetchPolicy: {
              maximumConcurrentFetches: 4,
              maximumFetchesPerMinute: 30,
            },
          }),
        ] as const)),
    twoFactor({ issuer: "Axiom" }),
    ...(institutionalIdentity.enabled
      ? [
          genericOAuth({
            config: [
              {
                providerId: "institution",
                name: institutionalIdentity.name,
                discoveryUrl: process.env.OIDC_DISCOVERY_URL!,
                clientId: process.env.OIDC_CLIENT_ID!,
                clientSecret: process.env.OIDC_CLIENT_SECRET!,
                scopes: ["openid", "profile", "email"],
                requireIdTokenVerification: true,
                pkce: true,
                disableSignUp: true,
                disableImplicitSignUp: true,
                disableProviderLogout: true,
              },
            ],
          }),
        ]
      : []),
  ],
  account: {
    accountLinking: {
      enabled: true,
      disableImplicitLinking: true,
      allowDifferentEmails: false,
    },
  },
  user: {
    async validateUserInfo({ user, source }) {
      if (
        source.method !== "oauth" ||
        source.oauth?.providerId !== "institution"
      )
        return;
      // Gate the freshly verified ID-token claim, not just an old local
      // email_verified bit. A linked identity cannot rebind the local email.
      if (source.oauth?.profile?.email_verified !== true)
        return {
          error: "institution_email_unverified",
          errorDescription:
            "Your institution must verify your email address before sign-in.",
        };
      const [local] = await query<{ email: string }>(
        'SELECT email FROM "user" WHERE id=$1',
        [user.id],
      );
      if (!local || local.email.toLowerCase() !== user.email?.toLowerCase())
        return {
          error: "institution_identity_mismatch",
          errorDescription:
            "Use an invited account with the same verified institutional email address.",
        };
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, url }) {
      await sendMail(
        user.email,
        "Reset your Axiom password",
        `Reset your password using this one-time link:\n\n${url}\n\nIf you did not request a reset, ignore this message.`,
      );
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
  rateLimit: { enabled: true, window: 60, max: 60 },
  advanced: { useSecureCookies: appUrl.startsWith("https:") },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (
        ctx.path === "/sign-up/email" &&
        (!process.env.SYNC_SECRET ||
          ctx.headers?.get("x-axiom-internal") !== process.env.SYNC_SECRET)
      )
        throw new APIError("FORBIDDEN", {
          message: "A valid group invitation is required.",
        });
    }),
  },
});
