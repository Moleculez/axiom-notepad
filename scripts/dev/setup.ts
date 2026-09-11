import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) console.log(".env already exists; preserving it.");
else {
  let config = await readFile(".env.example", "utf8");
  config = config
    .replace(
      "replace-with-at-least-32-random-characters",
      randomBytes(32).toString("hex"),
    )
    .replace(
      "replace-with-a-different-32-character-secret",
      randomBytes(32).toString("hex"),
    );
  await writeFile(".env", config, { mode: 0o600, flag: "wx" });
  console.log(
    "Created private local configuration. Start npm run db:local, then npm run db:migrate.",
  );
}
