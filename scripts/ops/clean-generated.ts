import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inventoryGenerated, removeGenerated } from "./generated-files";

const args = process.argv.slice(2);
const keep: string[] = [],
  origins: string[] = [];
let apply = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--apply") apply = true;
  else if (
    (args[i] === "--keep" || args[i] === "--origin") &&
    args[i + 1] &&
    !args[i + 1].startsWith("--")
  ) {
    (args[i] === "--keep" ? keep : origins).push(args[++i]);
  } else
    throw new Error(
      "Usage: npm run clean:generated -- [--apply] [--keep repo/relative/build] [--origin http://localhost:port]",
    );
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const inventory = await inventoryGenerated({ root, keep, origins });
console.table(
  inventory.files.map((file) => ({
    path: file.path,
    MiB: (file.bytes / 1048576).toFixed(1),
    reason: file.reason,
  })),
);
console.log(
  `${apply ? "Applying" : "DRY RUN"}: ${inventory.files.length} targets, ${(inventory.bytes / 1073741824).toFixed(2)} GiB of logical file bytes. ${inventory.skipped.length} protected/skipped.`,
);
console.log(
  "Never selects databases, attachments, backups, configuration, dependencies, test evidence or source. Preserve any additional service builds with --keep or --origin. Stop build writers before applying.",
);
if (!apply) process.exit(0);
const removed: { path: string; bytes: number }[] = [];
const failed: { path: string; error: string }[] = [];
for (const file of inventory.files) {
  try {
    removed.push({ path: file.path, bytes: await removeGenerated(root, file) });
  } catch (error) {
    failed.push({ path: file.path, error: String(error) });
  }
}
const receipt = join(
  root,
  "data/maintenance",
  `cleanup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
await mkdir(dirname(receipt), { recursive: true, mode: 0o700 });
const bytes = removed.reduce((n, file) => n + file.bytes, 0);
await writeFile(
  receipt,
  JSON.stringify(
    {
      completedAt: new Date().toISOString(),
      bytes,
      removed,
      failed,
      skipped: inventory.skipped,
      retained: inventory.retained,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log(
  `Removed ${removed.length} generated targets (${(bytes / 1073741824).toFixed(2)} GiB logical bytes). Receipt: ${receipt}. Regenerate builds with npm run build; tool caches repopulate automatically. Filesystem space reclaimed can differ because of compression, snapshots or shared blocks.`,
);
if (failed.length) {
  console.error(failed);
  process.exitCode = 1;
}
