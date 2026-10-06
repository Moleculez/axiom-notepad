/** Shared by import inventories and portable manifests; paths are data only. */
export const IMPORT_LIMITS = {
  entries: 2000,
  depth: 32,
  noteChars: 1_000_000,
  markdownBytes: 25_000_000,
  zipBytes: 50_000_000,
  zipExpandedBytes: 100_000_000,
  zipEntries: 1000,
} as const;
export function importPath(value: string): string {
  const path = value.normalize("NFC"),
    parts = path.split("/");
  if (
    !path ||
    path.length > 4096 ||
    /^[\\/]|^[a-z]:/i.test(path) ||
    /[\\\u0000-\u001f\u007f]/.test(path) ||
    parts.length > IMPORT_LIMITS.depth + 1 ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.trim() !== part ||
        part.length > 200,
    )
  )
    throw new Error(
      "Use safe relative paths with names up to 200 characters and 32 folder levels.",
    );
  return path;
}
export const importPathKey = (path: string) =>
  path.normalize("NFC").toLowerCase();
export function importExclusion(path: string): string | null {
  const parts = path.split("/");
  if (
    parts.some(
      (p) =>
        /^(?:\.git|\.svn|\.hg|node_modules|__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\.next|\.uploads)$/i.test(
          p,
        ) || p.startsWith("._"),
    )
  )
    return "System or development file";
  if (
    parts.some((p) =>
      /^(?:\.env(?:\..*)?|\.ssh|\.aws|credentials|id_rsa|id_ed25519)$/i.test(p),
    ) ||
    /\.(?:pem|key|p12|pfx)$/i.test(path)
  )
    return "Likely credentials or private key";
  return null;
}
