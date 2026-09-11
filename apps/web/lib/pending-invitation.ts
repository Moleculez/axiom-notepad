let pending = "";
/** Transient across authentication renders; never included in tabs or local cache. */
export function pendingInvitation(value?: string) {
  if (value !== undefined) pending = value;
  return pending;
}
