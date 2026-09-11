import { lstat, readdir, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "dotenv";

export type GeneratedFile = {
  path: string;
  bytes: number;
  modified: number;
  reason: string;
  regenerate: string;
};
export type CleanupOptions = {
  root: string;
  keep?: string[];
  origins?: string[];
  minimumAgeHours?: number;
  now?: number;
};
const cachePaths = [
  "data/npm-cache",
  "data/npm-editor-vnext-cache",
  "data/editor-lab-vite-cache",
];
const exists = async (path: string) => !!(await lstat(path).catch(() => null));
const contains = (parent: string, child: string) =>
  child === parent || child.startsWith(parent + "/");

/** Reject redirected parents as well as symlink targets. Never follow a link. */
export async function checkedPath(root: string, path: string) {
  const base = await realpath(root);
  const target = resolve(base, path);
  const local = relative(base, target).split(sep).join("/");
  if (!local || local === ".." || local.startsWith("../") || isAbsolute(local))
    throw new Error(`Refusing an unbounded cleanup target: ${path}`);
  if ((await realpath(target)) !== target)
    throw new Error(`Refusing a redirected cleanup target: ${path}`);
  return { target, local };
}

async function measure(
  path: string,
): Promise<{ bytes: number; modified: number }> {
  const info = await lstat(path);
  // Next.js builds contain dependency links. Count the link itself, never its
  // destination; fs.rm unlinks it without touching the external dependency.
  let bytes = info.isFile() || info.isSymbolicLink() ? info.size : 0;
  let modified = info.mtimeMs;
  if (info.isDirectory()) {
    for (const child of await readdir(path)) {
      const entry = await measure(join(path, child));
      bytes += entry.bytes;
      modified = Math.max(modified, entry.modified);
    }
  }
  return { bytes, modified };
}

async function buildId(path: string) {
  if (
    !(await exists(join(path, "server"))) ||
    !(await exists(join(path, "static")))
  )
    return null;
  return readFile(join(path, "BUILD_ID"), "utf8")
    .then((s) => s.trim())
    .catch(() => null);
}

export async function inventoryGenerated(options: CleanupOptions) {
  const root = await realpath(options.root);
  const keep = new Set(["apps/web/.next/dev-8080", ...(options.keep ?? [])]);
  const origins = new Set(options.origins ?? []);
  // Read only build paths; configuration values and credentials never enter reports.
  for (const name of await readdir(root)) {
    if (!/^\.env(?:\..+)?$/.test(name) || name.endsWith(".example")) continue;
    const env = parse(await readFile(join(root, name)));
    for (const key of ["AXIOM_DIST_DIR", "AXIOM_DEV_DIST_DIR"])
      if (env[key])
        keep.add(
          relative(root, resolve(root, "apps/web", env[key]))
            .split(sep)
            .join("/"),
        );
  }
  for (const key of ["AXIOM_DIST_DIR", "AXIOM_DEV_DIST_DIR"])
    if (process.env[key])
      keep.add(
        relative(root, resolve(root, "apps/web", process.env[key]!))
          .split(sep)
          .join("/"),
      );

  const nextRoot = join(root, "apps/web/.next");
  const builds: { path: string; id: string; modified: number }[] = [];
  for (const name of await readdir(nextRoot).catch(() => [])) {
    const path = `apps/web/.next/${name}`;
    const full = join(root, path);
    if (!(await lstat(full)).isDirectory()) continue;
    const id = await buildId(full);
    if (id)
      builds.push({
        path,
        id,
        modified: (await lstat(join(full, "BUILD_ID"))).mtimeMs,
      });
    if (
      (await exists(join(full, "lock"))) ||
      (await exists(join(full, "dev/lock")))
    )
      keep.add(path);
  }
  // Keep the most recently completed build, even if it has not been launched yet.
  const newest = [...builds].sort((a, b) => b.modified - a.modified)[0];
  if (newest) keep.add(newest.path);
  for (const origin of origins) {
    const url = new URL("/workspace-offline-assets.js", origin);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new Error("Build protection probes must target a local service.");
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok)
      throw new Error(`Cannot identify the running build at ${url.origin}.`);
    const source = await response.text();
    const matching = builds.filter((build) => source.includes(build.id));
    if (!matching.length)
      throw new Error(
        `No retained build matches ${url.origin}; pass an explicit --keep path after checking it.`,
      );
    for (const build of matching) keep.add(build.path);
  }

  const suggestions = builds.map((build) => ({
    path: build.path,
    reason: "obsolete completed Next.js build",
    regenerate: "npm run build (with a new AXIOM_DIST_DIR)",
  }));
  for (const path of cachePaths)
    if (await exists(join(root, path)))
      suggestions.push({
        path,
        reason: "disposable tool cache",
        regenerate: "npm install / npm run editor:lab",
      });
  for (const name of await readdir(join(root, "data")).catch(() => [])) {
    if (
      /^previous-web-build-[a-zA-Z0-9-]+$/.test(name) &&
      (await buildId(join(root, "data", name)))
    )
      suggestions.push({
        path: `data/${name}`,
        reason: "retired generated build copy",
        regenerate: "npm run build",
      });
  }
  const files: GeneratedFile[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const cutoff =
    (options.now ?? Date.now()) - (options.minimumAgeHours ?? 24) * 3600000;
  for (const item of suggestions) {
    if (
      [...keep].some(
        (path) => contains(path, item.path) || contains(item.path, path),
      )
    ) {
      skipped.push({
        path: item.path,
        reason:
          "configured, running, locked, newest or explicitly retained build",
      });
      continue;
    }
    try {
      const { target } = await checkedPath(root, item.path);
      const info = await measure(target);
      if (info.modified > cutoff)
        skipped.push({
          path: item.path,
          reason: "recently modified; age guard",
        });
      else files.push({ ...item, ...info });
    } catch {
      skipped.push({
        path: item.path,
        reason: "unreadable or redirected target; manual review required",
      });
    }
  }
  return {
    root,
    files,
    skipped,
    retained: [...keep],
    bytes: files.reduce((n, f) => n + f.bytes, 0),
  };
}

export async function removeGenerated(root: string, file: GeneratedFile) {
  const { target, local } = await checkedPath(root, file.path);
  const allowed =
    /^apps\/web\/\.next\/[^/]+$/.test(local) ||
    /^data\/previous-web-build-[a-zA-Z0-9-]+$/.test(local) ||
    cachePaths.includes(local);
  if (!allowed) throw new Error(`Not an allowlisted generated path: ${local}`);
  if (!cachePaths.includes(local) && !(await buildId(target)))
    throw new Error(`Generated build markers are missing: ${local}`);
  if (
    (await exists(join(target, "lock"))) ||
    (await exists(join(target, "dev/lock")))
  )
    throw new Error(`Build became locked: ${local}`);
  const current = await measure(target);
  if (current.modified !== file.modified || current.bytes !== file.bytes)
    throw new Error(
      `Target changed after inventory; refusing deletion: ${local}`,
    );
  await rm(target, { recursive: true });
  return current.bytes;
}
