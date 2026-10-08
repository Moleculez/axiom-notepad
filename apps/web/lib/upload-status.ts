import { api } from "./client";

export type VerificationProgress = {
  status: string;
  verification_state?: "queued" | "running" | "retrying" | "unavailable" | null;
  updated_at?: string;
};

/** Ask for the transfers actually on screen, not the newest 100 account items.
 * Each read is bounded; a lost response must never latch inFlight forever. */
export async function readUploadStatuses<T>(
  ids: string[],
  signal: AbortSignal,
) {
  const result: T[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    signal.throwIfAborted();
    const group = ids.slice(start, start + 100);
    result.push(
      ...(await api<T[]>(`uploads?ids=${group.join(",")}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      })),
    );
  }
  return result;
}

export function uploadStatusLabel(item: VerificationProgress) {
  if (item.status !== "verifying") return item.status;
  switch (item.verification_state) {
    case "queued":
      return "Uploaded · waiting for verification";
    case "retrying":
      return "Verification interrupted · retry scheduled";
    case "unavailable":
      return "Uploaded · verification needs a recheck";
    default:
      return "Verifying file on server…";
  }
}

export function verificationWaitMessage(
  item: VerificationProgress,
  now = Date.now(),
) {
  if (item.status !== "verifying") return "";
  if (item.verification_state === "unavailable")
    return "Your file was received. Recheck to recover its verification; no re-upload is needed.";
  if (
    item.verification_state === "queued" &&
    item.updated_at &&
    now - Date.parse(item.updated_at) >= 30_000
  )
    return "Your file was received, but the verification worker has not started it. Recheck; if it stays waiting, ask an administrator to restart the workspace worker.";
  return "";
}
