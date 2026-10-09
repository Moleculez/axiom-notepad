import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function catalogsRevision() {
  const directory = fileURLToPath(
    new URL("../../packages/i18n/src/messages/", import.meta.url),
  );
  const hash = createHash("sha256");
  for (const file of readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .sort())
    hash.update(file).update(readFileSync(resolve(directory, file)));
  return hash.digest("hex").slice(0, 16);
}
