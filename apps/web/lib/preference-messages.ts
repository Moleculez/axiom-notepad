import type { MessageId } from "@axiom/i18n";

/** Canonical state-machine copy, translated only by the consuming UI. Keep
 * status text closed: raw validation/protocol errors are not interface labels. */
export const preferenceMessages = {
  loading: "Loading your preferences…",
  storageUnavailable:
    "Device storage is unavailable. Changes have not been applied. Export your draft or free storage and retry.",
  deviceSaved: "Saved on this device",
  invalidCache:
    "An invalid local cache was ignored. Loading account preferences…",
  offline: "Offline · preferences will sync when connected",
  synced: "Preferences synced to your account",
  conflict: "Preferences changed elsewhere. Review the conflicting fields.",
  syncing: "Syncing preferences…",
  awaitingSync: "Saved on this device · awaiting sync",
  upgrade:
    "Reload Axiom before syncing preferences. Your local changes are retained.",
  retrying: "Another device saved first. Retrying with a field-by-field merge…",
  syncUnavailable: "Saved on this device · sync unavailable",
  saved: "Preferences saved",
  invalid: "Check your preferences.",
} as const satisfies Record<string, MessageId>;

export type PreferenceMessage =
  (typeof preferenceMessages)[keyof typeof preferenceMessages];
