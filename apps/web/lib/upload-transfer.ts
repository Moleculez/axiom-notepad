import { UPLOAD_CHUNK_BYTES } from "@axiom/shared/workspace";
import { api } from "./client";
import { filePart } from "./file-checksum";
type UploadState = {
  status: string;
  resourceId?: string;
  versionId?: string;
  chunks: { part: number; bytes: number; sha256: string }[];
};
/** One bounded transfer primitive for ordinary uploads and import-owned sessions. */
export async function transferUpload(
  file: File,
  base: string,
  options: {
    signal: AbortSignal;
    progress: (bytes: number) => void;
    valid?: () => void;
  },
) {
  const valid = () => {
    options.signal.throwIfAborted();
    options.valid?.();
  };
  const remote = await api<UploadState>(base, { signal: options.signal });
  valid();
  if (["complete", "verifying", "staged"].includes(remote.status)) {
    options.progress(file.size);
    return remote;
  }
  const present = new Map(
    remote.chunks.map((chunk) => [Number(chunk.part), chunk.sha256]),
  );
  for (const [part, checksum] of present) {
    if ((await filePart(file, part)).checksum !== checksum)
      throw new Error(
        "Reselect the original file. Its saved parts have different checksums; no existing file was changed.",
      );
    valid();
  }
  let received = remote.chunks.reduce(
    (sum, chunk) => sum + Number(chunk.bytes),
    0,
  );
  options.progress(received);
  for (
    let part = 1;
    part <= Math.ceil(file.size / UPLOAD_CHUNK_BYTES);
    part++
  ) {
    valid();
    if (present.has(part)) continue;
    const { chunk, checksum } = await filePart(file, part);
    valid();
    await api(`${base}/chunks/${part}`, {
      method: "PUT",
      signal: options.signal,
      headers: {
        "content-type": "application/octet-stream",
        "x-content-sha256": checksum,
      },
      body: chunk,
    });
    received += chunk.byteLength;
    valid();
    options.progress(received);
  }
  const accepted = await api<Omit<UploadState, "chunks">>(`${base}/complete`, {
    method: "POST",
    signal: options.signal,
    body: "{}",
  });
  valid();
  // Completion may have already committed (including after a lost response).
  // Preserve its terminal state and immutable IDs instead of inventing verifying.
  return { ...remote, ...accepted };
}
