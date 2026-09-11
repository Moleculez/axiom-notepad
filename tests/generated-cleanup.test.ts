import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  utimes,
  writeFile,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkedPath,
  inventoryGenerated,
  removeGenerated,
} from "../scripts/ops/generated-files";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "axiom-cleanup-test-"));
  roots.push(root);
  return root;
}
async function build(root: string, name: string) {
  const path = `apps/web/.next/${name}`,
    full = join(root, path);
  await mkdir(join(full, "server"), { recursive: true });
  await mkdir(join(full, "static"));
  await writeFile(join(full, "BUILD_ID"), name);
  return path;
}
const future = Date.now() + 3 * 86400000;
describe("generated cleanup safety", () => {
  it("preserves configured, newest, explicit, and locked builds and all user data", async () => {
    const root = await fixture();
    await build(root, "obsolete");
    await build(root, "configured");
    await build(root, "retained");
    await build(root, "locked");
    await writeFile(join(root, "apps/web/.next/locked/lock"), "");
    const newest = await build(root, "newest");
    await utimes(
      join(root, newest, "BUILD_ID"),
      new Date(future),
      new Date(future),
    );
    await writeFile(join(root, ".env"), "AXIOM_DIST_DIR=.next/configured\n");
    await mkdir(join(root, "data/attachments"), { recursive: true });
    await writeFile(join(root, "data/attachments/paper.pdf"), "private");
    const result = await inventoryGenerated({
      root,
      now: future,
      keep: ["apps/web/.next/retained"],
    });
    expect(result.files.map((f) => f.path)).toEqual([
      "apps/web/.next/obsolete",
    ]);
    await removeGenerated(root, result.files[0]);
    await expect(
      access(join(root, "data/attachments/paper.pdf")),
    ).resolves.toBeUndefined();
    await expect(access(join(root, newest))).resolves.toBeUndefined();
  });
  it("does not delete anything during inventory and protects recent builds", async () => {
    const root = await fixture();
    const old = await build(root, "old"),
      recent = await build(root, "recent");
    const result = await inventoryGenerated({ root });
    expect(result.files).toEqual([]);
    await expect(access(join(root, old))).resolves.toBeUndefined();
    await expect(access(join(root, recent))).resolves.toBeUndefined();
  });
  it("refuses root traversal, symlink targets, redirected parents and arbitrary data", async () => {
    const root = await fixture(),
      outside = await fixture();
    await mkdir(join(root, "data"));
    await symlink(outside, join(root, "data/npm-cache"));
    await expect(checkedPath(root, "..")).rejects.toThrow("unbounded");
    await expect(checkedPath(root, ".")).rejects.toThrow("unbounded");
    await expect(checkedPath(root, "data/npm-cache")).rejects.toThrow(
      "redirected",
    );
    await writeFile(join(outside, "child"), "x");
    await expect(checkedPath(root, "data/npm-cache/child")).rejects.toThrow(
      "redirected",
    );
    await expect(
      removeGenerated(root, {
        path: "data",
        bytes: 0,
        modified: 0,
        reason: "",
        regenerate: "",
      }),
    ).rejects.toThrow("allowlisted");
  });
  it("refuses a changed target after dry-run inventory", async () => {
    const root = await fixture();
    await mkdir(join(root, "data/npm-cache"), { recursive: true });
    await writeFile(join(root, "data/npm-cache/item"), "before");
    const result = await inventoryGenerated({ root, now: future });
    await writeFile(join(root, "data/npm-cache/item"), "changed afterwards");
    await expect(removeGenerated(root, result.files[0])).rejects.toThrow(
      "changed after inventory",
    );
  });
  it("unlinks generated dependency links without touching their destinations", async () => {
    const root = await fixture(),
      outside = await fixture();
    const old = await build(root, "old");
    const newest = await build(root, "newest");
    await utimes(
      join(root, newest, "BUILD_ID"),
      new Date(future),
      new Date(future),
    );
    await writeFile(join(outside, "keep"), "dependency");
    await symlink(outside, join(root, old, "dependency-link"));
    const result = await inventoryGenerated({ root, now: future });
    await removeGenerated(root, result.files[0]);
    await expect(access(join(outside, "keep"))).resolves.toBeUndefined();
  });
});
