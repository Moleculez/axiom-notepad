import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { themePacks } from "../../packages/shared/src/theme-packs";
import {
  themePackContrast,
  themePackManifestSchema,
  validateThemePackCss,
} from "../../packages/shared/src/theme-pack-validation";

let failed = false;
for (const pack of themePacks) {
  const errors: string[] = [],
    result = themePackManifestSchema.safeParse(pack);
  if (!result.success) errors.push(result.error.message);
  try {
    errors.push(
      ...validateThemePackCss(
        await readFile(resolve(pack.css), "utf8"),
        pack.id,
      ),
    );
    for (const asset of [...pack.assets, ...pack.fixtures])
      if (!(await stat(resolve(asset))).isFile())
        errors.push(`Missing file: ${asset}`);
    for (const check of themePackContrast(pack))
      if (check.ratio < check.minimum)
        errors.push(
          `${check.mode} ${check.label}: ${check.ratio.toFixed(2)}:1, needs ${check.minimum}:1`,
        );
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (errors.length) {
    failed = true;
    process.stderr.write(
      `${pack.name}\n${errors.map((error) => `  ${error}`).join("\n")}\n`,
    );
  } else
    process.stdout.write(
      `${pack.name}: manifest, scope, assets and contrast passed\n`,
    );
}
if (failed) process.exitCode = 1;
