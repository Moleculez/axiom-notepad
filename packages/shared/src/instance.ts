import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { auth, appUrl } from "./auth";
import { pool, query } from "./db";
import { HttpError } from "./access";

export const datasetHeader = "X-Axiom-Dataset";
const local = (url: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
export const developmentSetupEnabled = () =>
  process.env.NODE_ENV !== "production" &&
  process.env.AXIOM_DEV_SETUP !== "0" &&
  local(appUrl);
export async function instanceIdentity() {
  const [row] = await query(
    "SELECT dataset_id,setup_completed_at,setup_token_hash FROM app_instance WHERE singleton",
  );
  if (!row)
    throw new HttpError(
      503,
      "The application database has not been initialized.",
    );
  return {
    datasetId: row.dataset_id as string,
    setupRequired:
      !!row.setup_token_hash &&
      !row.setup_completed_at &&
      developmentSetupEnabled(),
  };
}
export async function assertDataset(request: Request) {
  const expected = request.headers.get(datasetHeader);
  if (!expected) return;
  const current = await instanceIdentity();
  if (expected !== current.datasetId)
    throw new HttpError(
      409,
      "This development dataset was replaced. Reload Axiom before making changes.",
    );
}
export async function instanceApi(request: Request, path: string[]) {
  if (path[0] === "instance" && request.method === "GET")
    return Response.json(await instanceIdentity(), {
      headers: { "cache-control": "no-store" },
    });
  if (path[0] !== "development-setup" || request.method !== "POST") return null;
  if (!developmentSetupEnabled() || !local(request.url))
    throw new HttpError(404, "Setup is unavailable.");
  const input = z
    .object({
      token: z.string().min(32).max(200),
      name: z.string().trim().min(1).max(100),
      email: z.email().toLowerCase(),
      password: z.string().min(12).max(128),
      groupName: z.string().trim().min(1).max(160),
    })
    .strict()
    .parse(await request.json());
  const client = await pool.connect();
  try {
    // A session lock spans Better Auth's own transactions. The recorded email
    // intent makes a crash after account creation safely resumable with the same
    // one-time token AND the account password, without creating another owner.
    await client.query(
      "SELECT pg_advisory_lock(hashtext('axiom:development-setup'))",
    );
    const {
      rows: [row],
    } = await client.query("SELECT * FROM app_instance WHERE singleton");
    if (!row?.setup_token_hash || row.setup_completed_at)
      throw new HttpError(
        409,
        "First-run setup has already finished or is unavailable.",
      );
    const actual = createHash("sha256").update(input.token).digest(),
      expected = Buffer.from(row.setup_token_hash, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(actual, expected))
      throw new HttpError(403, "The one-time local setup token is incorrect.");
    const { rows: users } = await client.query('SELECT id,email FROM "user"');
    if (
      users.length &&
      (users.length !== 1 ||
        !row.setup_email ||
        users[0].email.toLowerCase() !== row.setup_email)
    )
      throw new HttpError(
        409,
        "Accounts already exist. First-run setup cannot take ownership of an existing installation.",
      );
    if (row.setup_email && row.setup_email !== input.email)
      throw new HttpError(
        409,
        "An interrupted setup must resume with its original email address.",
      );
    await client.query(
      "UPDATE app_instance SET setup_email=$1 WHERE singleton",
      [input.email],
    );
    let userId: string;
    if (users.length) {
      const signed = await auth.api.signInEmail({
        body: { email: input.email, password: input.password },
        headers: new Headers({ origin: appUrl }),
      });
      userId = signed.user.id;
      // Setup does not issue a browser session; the normal sign-in screen follows.
      await client.query("DELETE FROM session WHERE token=$1", [signed.token]);
    } else {
      const created = await auth.api.signUpEmail({
        body: {
          email: input.email,
          name: input.name,
          password: input.password,
        },
        headers: new Headers({
          "x-axiom-internal": process.env.SYNC_SECRET!,
          origin: appUrl,
        }),
      });
      userId = created.user.id;
      if (created.token)
        await client.query("DELETE FROM session WHERE token=$1", [
          created.token,
        ]);
    }
    await client.query("BEGIN");
    try {
      const {
        rows: [group],
      } = await client.query(
        "INSERT INTO groups(name,description) VALUES($1,'') RETURNING id",
        [input.groupName],
      );
      await client.query(
        "INSERT INTO members(group_id,user_id,role) VALUES($1,$2,'owner')",
        [group.id, userId],
      );
      await client.query(
        "UPDATE app_instance SET setup_completed_at=now(),setup_token_hash=NULL,setup_email=NULL WHERE singleton",
      );
      await client.query("COMMIT");
      return Response.json(
        { ok: true, groupId: group.id },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('axiom:development-setup'))")
      .catch(() => {});
    client.release();
  }
}
