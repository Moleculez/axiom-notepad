import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { auth, appUrl } from "../../packages/shared/src/auth";
import { query, pool } from "../../packages/shared/src/db";
const args = process.argv.slice(2),
  get = (key: string) => args[args.indexOf(key) + 1];
const rl = createInterface({ input: process.stdin, output: process.stdout });
const email = args.includes("--email")
  ? get("--email")
  : await rl.question("Administrator email: ");
if (args.includes("--recover")) {
  const [user] = await query('SELECT id FROM "user" WHERE email=$1', [
    email.toLowerCase(),
  ]);
  if (!user) throw new Error("Account not found.");
  const token = randomBytes(32).toString("hex");
  await query(
    "INSERT INTO verification(id,identifier,value,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [randomBytes(16).toString("hex"), `reset-password:${token}`, user.id],
  );
  console.log(
    `One-time recovery link (expires in one hour): ${appUrl}/?reset=${token}`,
  );
} else {
  const name = args.includes("--name")
    ? get("--name")
    : await rl.question("Name: ");
  const password =
    process.env.AXIOM_ADMIN_PASSWORD ?? randomBytes(20).toString("base64url");
  const user = await auth.api.signUpEmail({
    body: { email, name, password },
    headers: new Headers({ "x-axiom-internal": process.env.SYNC_SECRET! }),
  });
  const [group] = await query(
    "INSERT INTO groups(name,description) VALUES($1,$2) RETURNING id",
    ["Research group", "A shared home for research."],
  );
  await query(
    "INSERT INTO members(group_id,user_id,role) VALUES($1,$2,'owner')",
    [group.id, user.user.id],
  );
  console.log(`Created ${email}.`);
  if (!process.env.AXIOM_ADMIN_PASSWORD)
    console.log(
      `Initial password: ${password}\nChange this password after signing in.`,
    );
}
rl.close();
await pool.end();
