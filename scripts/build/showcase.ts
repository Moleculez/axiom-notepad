import { build } from "vite";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { showcaseAssets } from "./showcase-assets";
import { buildCatalogs } from "../i18n/build";

// Build public source only. This command never loads .env or the database.
await buildCatalogs();
await build({
  configFile: resolve("apps/showcase/vite.config.ts"),
  logLevel: "warn",
});
const target = resolve("apps/showcase/dist");
await showcaseAssets(target);
await writeFile(resolve(target, ".nojekyll"), "");
console.log(
  "Static showcase built in apps/showcase/dist; no account services required.",
);
