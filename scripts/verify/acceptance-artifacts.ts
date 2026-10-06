import { realpath } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

/** A child log cannot redirect receipt reads outside its run or through a symlink. */
export async function ownedRuntimeReceipt(root: string, output: string) {
  const reported =
    /Isolated (?:passed|failed) receipt: ([^\n]+\/receipt\.json)/.exec(
      output,
    )?.[1];
  if (!reported) throw new Error("Runtime did not produce an owned receipt.");
  const path = resolve(root, reported),
    directory = dirname(path);
  if (
    dirname(directory) !== resolve(root, "data") ||
    !/^reliability-[A-Za-z0-9_-]+$/.test(basename(directory)) ||
    (await realpath(path)) !== path
  )
    throw new Error("Runtime receipt escaped its owned reliability directory.");
  return path;
}

export async function ownedRuntimeArtifact(receipt: string, artifact: string) {
  const directory = dirname(receipt),
    path = resolve(directory, artifact);
  if (!path.startsWith(directory + "/") || (await realpath(path)) !== path)
    throw new Error(
      "Runtime artifact escaped its owned reliability directory.",
    );
  return path;
}
