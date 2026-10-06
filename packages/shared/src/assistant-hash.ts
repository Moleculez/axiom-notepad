import { createHash } from "node:crypto";
/** Shared canonical fingerprint, preserving the historical receipt encoding. */
export function assistantHash(value: unknown): string {
  const stable = (v: unknown): string =>
    v === null || typeof v !== "object"
      ? JSON.stringify(v)
      : Array.isArray(v)
        ? `[${v.map(stable).join(",")}]`
        : `{${Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => JSON.stringify(k) + ":" + stable(x))
            .join(",")}}`;
  return createHash("sha256").update(stable(value)).digest("hex");
}
