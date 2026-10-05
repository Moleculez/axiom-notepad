import { UPLOAD_CHUNK_BYTES } from "@axiom/shared/workspace";

// Pure browser/worker primitives. Do not import the API client or page lifecycle.
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
export const sha256Hex = async (bytes: ArrayBuffer) =>
  hex(await crypto.subtle.digest("SHA-256", bytes));
export async function filePart(file: Blob, part: number) {
  const chunk = await file
    .slice((part - 1) * UPLOAD_CHUNK_BYTES, part * UPLOAD_CHUNK_BYTES)
    .arrayBuffer();
  return { chunk, checksum: await sha256Hex(chunk) };
}
export async function importFileDigest(
  file: Blob,
  progress?: (bytes: number) => void,
) {
  const hashes: string[] = [];
  for (
    let part = 1;
    part <= Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
    part++
  ) {
    hashes.push((await filePart(file, part)).checksum);
    progress?.(Math.min(file.size, part * UPLOAD_CHUNK_BYTES));
  }
  return sha256Hex(new TextEncoder().encode(hashes.join("")).buffer);
}
