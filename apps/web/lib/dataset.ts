export const DATASET_KEY = "axiom:dataset";
export const DATASET_RESET = "axiom:dataset-reset";
const RESET_PENDING = "axiom:dataset-reset-pending";
export type DatasetIdentity = { datasetId: string; setupRequired: boolean };
let verified: string | null = null,
  checking: Promise<DatasetIdentity> | null = null;
let clearing: Promise<void> | null = null;
export function currentDataset() {
  return verified;
}
export function datasetRequestHeaders(): Record<string, string> {
  return verified ? { "X-Axiom-Dataset": verified } : {};
}
export async function verifyDataset(): Promise<DatasetIdentity> {
  if (checking) return checking;
  checking = (async () => {
    const response = await fetch("/api/v1/instance", {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new Error(
        "Cannot verify this application's dataset. Check the development service and database migrations.",
      );
    const identity = (await response.json()) as DatasetIdentity;
    if (!/^[\da-f-]{36}$/i.test(identity.datasetId))
      throw new Error("The application returned an invalid dataset identity.");
    const previous = localStorage.getItem(DATASET_KEY);
    const legacy = !previous && !!localStorage.getItem("axiom:session");
    if (
      (previous && previous !== identity.datasetId) ||
      (verified && verified !== identity.datasetId) ||
      legacy ||
      localStorage.getItem(RESET_PENDING)
    ) {
      verified = null;
      window.dispatchEvent(
        new CustomEvent(DATASET_RESET, { detail: identity }),
      );
      throw new Error(
        "This development dataset changed. Its old local caches must be cleared before continuing.",
      );
    }
    localStorage.setItem(DATASET_KEY, identity.datasetId);
    verified = identity.datasetId;
    return identity;
  })();
  try {
    return await checking;
  } finally {
    checking = null;
  }
}
export function allowVerifiedOfflineDataset(): boolean {
  if (!localStorage.getItem(DATASET_KEY) || localStorage.getItem(RESET_PENDING))
    return false;
  verified = localStorage.getItem(DATASET_KEY);
  return true;
}
/** Called only after the boundary unmounts all account views and stops replay. */
export function clearReplacedDataset(identity: DatasetIdentity): Promise<void> {
  if (clearing) return clearing;
  clearing = clearDatasetStorage(identity).finally(() => {
    clearing = null;
  });
  return clearing;
}
async function clearDatasetStorage(identity: DatasetIdentity) {
  verified = null;
  localStorage.setItem(RESET_PENDING, identity.datasetId);
  const offline = await import("./offline-files");
  offline.setOfflineAccount(null);
  for (const key of Object.keys(localStorage))
    if (key.startsWith("axiom:") && key !== RESET_PENDING)
      localStorage.removeItem(key);
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith("axiom:")) sessionStorage.removeItem(key);
  if (!indexedDB.databases)
    throw new Error(
      "This browser cannot enumerate old local data safely. Clear this site's storage, then reopen Axiom.",
    );
  for (const database of await indexedDB.databases()) {
    if (!database.name?.startsWith("axiom:")) continue;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(database.name!);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(
          new Error(
            "Close other Axiom tabs, then retry clearing the replaced development data.",
          ),
        );
    });
  }
  if ("caches" in window)
    for (const key of await caches.keys())
      if (key.startsWith("axiom-")) await caches.delete(key);
  await fetch("/api/auth/sign-out", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => {});
  localStorage.setItem(DATASET_KEY, identity.datasetId);
  localStorage.removeItem(RESET_PENDING);
  verified = identity.datasetId;
}
