import "dotenv/config";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

const database = new URL(process.env.DATABASE_URL!);
assert(
  ["127.0.0.1", "localhost"].includes(database.hostname) &&
    /test|verify|rehearsal/.test(database.pathname),
  "Use a clearly named, disposable local test database.",
);
const issuer = "http://127.0.0.1:1241",
  origin = "http://localhost:1240";
Object.assign(process.env, {
  APP_URL: origin,
  BETTER_AUTH_URL: origin,
  OIDC_DISCOVERY_URL: issuer + "/.well-known/openid-configuration",
  OIDC_CLIENT_ID: "axiom-test",
  OIDC_CLIENT_SECRET: "test-only-client-secret",
  OIDC_LOCAL_TEST: "1",
  NODE_ENV: "test",
});
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  use: "sig",
  alg: "RS256",
  kid: "test-key",
};
type Code = {
  nonce: string;
  challenge: string;
  redirect: string;
  email: string;
  verified: boolean;
  badNonce: boolean;
};
const codes = new Map<string, Code>();
const email = `oidc-${randomUUID()}@axiom.test`;
let identity = { email, verified: true, badNonce: false };
const mock = createServer(async (request, response) => {
  const url = new URL(request.url!, issuer);
  const json = (data: unknown, status = 200) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(data));
  };
  if (url.pathname === "/.well-known/openid-configuration")
    return json({
      issuer,
      authorization_endpoint: issuer + "/authorize",
      token_endpoint: issuer + "/token",
      jwks_uri: issuer + "/jwks",
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["openid", "profile", "email"],
    });
  if (url.pathname === "/jwks") return json({ keys: [jwk] });
  if (url.pathname === "/authorize") {
    const redirect = url.searchParams.get("redirect_uri");
    if (
      redirect !== origin + "/api/auth/callback/institution" ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      !url.searchParams.get("nonce")
    )
      return json({ error: "invalid_request" }, 400);
    const code = randomUUID();
    codes.set(code, {
      ...identity,
      redirect,
      nonce: url.searchParams.get("nonce")!,
      challenge: url.searchParams.get("code_challenge")!,
    });
    const target = new URL(redirect);
    target.searchParams.set("code", code);
    target.searchParams.set("state", url.searchParams.get("state")!);
    response.writeHead(302, { location: target.href });
    response.end();
    return;
  }
  if (url.pathname === "/token") {
    const chunks: Buffer[] = [];
    for await (const part of request) chunks.push(Buffer.from(part));
    const body = new URLSearchParams(Buffer.concat(chunks).toString()),
      code = codes.get(body.get("code") ?? "");
    codes.delete(body.get("code") ?? "");
    const authorization = request.headers.authorization,
      credentials = authorization?.startsWith("Basic ")
        ? Buffer.from(authorization.slice(6), "base64").toString().split(":")
        : [body.get("client_id"), body.get("client_secret")];
    if (
      !code ||
      credentials[0] !== "axiom-test" ||
      credentials[1] !== "test-only-client-secret" ||
      body.get("redirect_uri") !== code.redirect ||
      createHash("sha256")
        .update(body.get("code_verifier") ?? "")
        .digest("base64url") !== code.challenge
    )
      return json({ error: "invalid_grant" }, 400);
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: issuer,
        aud: "axiom-test",
        sub: code.email,
        email: code.email,
        email_verified: code.verified,
        name: "OIDC test researcher",
        nonce: code.badNonce ? "wrong-nonce" : code.nonce,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 120,
      }),
    ).toString("base64url");
    return json({
      token_type: "Bearer",
      access_token: "test-access-token",
      expires_in: 120,
      id_token:
        header +
        "." +
        payload +
        "." +
        sign(
          "RSA-SHA256",
          Buffer.from(header + "." + payload),
          privateKey,
        ).toString("base64url"),
    });
  }
  json({ error: "not_found" }, 404);
});
await new Promise<void>((resolve, reject) => {
  mock.once("error", reject);
  mock.listen(1241, "127.0.0.1", resolve);
});
const { auth } = await import("../../packages/shared/src/auth");
const { pool, query } = await import("../../packages/shared/src/db");
const jar = new Map<string, string>();
async function call(
  path: string,
  body?: unknown,
  attempt = 0,
): Promise<Response> {
  const response = await auth.handler(
    new Request(origin + "/api/auth/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  if (response.status === 429 && attempt < 3) {
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(
          60000,
          Math.max(1, Number(response.headers.get("retry-after")) || 10) * 1000,
        ),
      ),
    );
    return call(path, body, attempt + 1);
  }
  for (const cookie of response.headers.getSetCookie()) {
    const raw = cookie.split(";")[0],
      index = raw.indexOf("=");
    jar.set(raw.slice(0, index), raw.slice(index + 1));
  }
  return response;
}
async function session() {
  return (await call("get-session")).json();
}
async function flow(link: boolean, tamper = false) {
  const start = await call(link ? "link-social" : "sign-in/social", {
    provider: "institution",
    callbackURL: origin + "/workbench/settings/security",
    disableRedirect: true,
  });
  assert(
    start.ok,
    `Could not start the ${link ? "link" : "sign-in"} flow (${start.status}).`,
  );
  const data = await start.json(),
    authorization = await fetch(data.url, { redirect: "manual" });
  assert.equal(
    authorization.status,
    302,
    "PKCE and nonce must be included in the authorization request.",
  );
  const target = new URL(authorization.headers.get("location")!);
  if (tamper) target.searchParams.set("state", "tampered-state");
  return call(target.pathname.replace("/api/auth/", "") + target.search);
}
let userId: string | undefined;
try {
  const registered = await auth.api.signUpEmail({
    body: {
      email,
      name: "OIDC test researcher",
      password: "AxiomTestOIDC2026!",
    },
    headers: new Headers({ "x-axiom-internal": process.env.SYNC_SECRET! }),
  });
  userId = registered.user.id;
  // A matching email must not silently link an institutional identity.
  await flow(false);
  assert.equal((await session())?.user?.id, undefined);
  assert.equal(
    (
      await query(
        "SELECT id FROM account WHERE user_id=$1 AND provider_id='institution'",
        [userId],
      )
    ).length,
    0,
  );
  assert(
    (await call("sign-in/email", { email, password: "AxiomTestOIDC2026!" })).ok,
  );
  await flow(true);
  assert.equal(
    (
      await query(
        "SELECT id FROM account WHERE user_id=$1 AND provider_id='institution'",
        [userId],
      )
    ).length,
    1,
    "Explicit same-email linking should succeed.",
  );
  jar.clear();
  await flow(false);
  assert.equal(
    (await session()).user.id,
    userId,
    "The linked identity must return the same local account.",
  );
  jar.clear();
  await flow(false, true);
  assert.equal(
    (await session())?.user?.id,
    undefined,
    "Tampered OAuth state must fail closed.",
  );
  identity = { email, verified: true, badNonce: true };
  jar.clear();
  await flow(false);
  assert.equal(
    (await session())?.user?.id,
    undefined,
    "A mismatched ID-token nonce must be rejected.",
  );
  identity = { email, verified: false, badNonce: false };
  jar.clear();
  await flow(false);
  assert.equal(
    (await session())?.user?.id,
    undefined,
    "An unverified institutional email must be rejected.",
  );
  const unknown = `unknown-${randomUUID()}@axiom.test`;
  identity = { email: unknown, verified: true, badNonce: false };
  jar.clear();
  await flow(false);
  assert.equal((await session())?.user?.id, undefined);
  assert.equal(
    (await query('SELECT id FROM "user" WHERE email=$1', [unknown])).length,
    0,
    "Institutional sign-in must not create an uninvited account.",
  );
  console.log(
    "OIDC mock verification passed: explicit linking, same-account sign-in, PKCE, state, nonce, verified email and invite-only admission.",
  );
} finally {
  if (userId)
    await query('DELETE FROM "user" WHERE id=$1 AND email=$2', [userId, email]);
  await pool.end();
  await new Promise<void>((resolve) => mock.close(() => resolve()));
}
