"use client";
import { useEffect, useSyncExternalStore } from "react";
import {
  deviceSchema,
  preferencesSchema,
  type DevicePreferences,
  APPEARANCE_SCHEMA,
  APPEARANCE_SCHEMA_HEADER,
} from "@axiom/shared/appearance";
import { validateEditorPreferences } from "@axiom/shared/editor";
import {
  bundleValues,
  emptyBundle,
  mergeBundle,
  normalizeBundle,
  type PreferenceValues,
  type PreferencesBundle,
} from "@axiom/shared/preferences-bundle";
import { api, ApiError, SIGN_OUT_PENDING } from "./client";

type Cache = {
  base: PreferencesBundle;
  values: PreferenceValues;
  device: DevicePreferences;
  mutationId?: string;
  savePrevious?: boolean;
  conflicts: string[];
};
type Snapshot = Cache & {
  ready: boolean;
  status: string;
  preview: Partial<PreferenceValues> & { device?: DevicePreferences };
};
const fresh = (): Snapshot => ({
  base: emptyBundle(),
  values: bundleValues(emptyBundle()),
  device: {},
  conflicts: [],
  ready: false,
  status: "Loading your preferences…",
  preview: {},
});
const stores = new Map<string, PreferenceStore>();
const serverSnapshot = fresh();
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

// One store and one outbox per signed-in account, shared by appearance/writing
// hooks. A single localStorage write stages the entire bundle before syncing.
class PreferenceStore {
  state = fresh();
  listeners = new Set<() => void>();
  users = 0;
  generation = 0;
  inFlight = false;
  timer?: ReturnType<typeof setInterval>;
  controller?: AbortController;
  constructor(readonly userId: string) {}
  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  key = () => `axiom:preferences-bundle:${this.userId}`;
  emit = (state: Snapshot) => {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  };
  valid = () => {
    if (!this.userId || this.users <= 0) return false;
    try {
      return !localStorage.getItem(SIGN_OUT_PENDING);
    } catch {
      return true;
    }
  };
  keep = (next: Snapshot) => {
    if (!this.valid()) return false;
    try {
      const { base, values, device, mutationId, savePrevious, conflicts } =
        next;
      localStorage.setItem(
        this.key(),
        JSON.stringify({
          base,
          values,
          device,
          mutationId,
          savePrevious,
          conflicts,
        }),
      );
      this.emit(next);
      return true;
    } catch {
      this.emit({
        ...(next.mutationId ? this.state : next),
        ready: true,
        status:
          "Device storage is unavailable. Changes have not been applied. Export your draft or free storage and retry.",
      });
      return false;
    }
  };
  parse = (raw: string): Cache => {
    const data = JSON.parse(raw);
    return {
      base: normalizeBundle(data.base),
      values: {
        appearance: preferencesSchema.parse(data.values.appearance),
        editor: validateEditorPreferences(data.values.editor),
      },
      device: deviceSchema.parse(data.device),
      mutationId:
        typeof data.mutationId === "string" ? data.mutationId : undefined,
      savePrevious: data.savePrevious === true,
      conflicts: Array.isArray(data.conflicts)
        ? data.conflicts.filter((value: unknown) => typeof value === "string")
        : [],
    };
  };
  start = () => {
    if (++this.users !== 1) return;
    this.generation++;
    this.inFlight = false;
    let initial = fresh();
    if (this.userId)
      try {
        const raw = localStorage.getItem(this.key());
        if (raw)
          initial = {
            ...initial,
            ...this.parse(raw),
            ready: true,
            status: "Saved on this device",
          };
        else {
          const a = JSON.parse(
            localStorage.getItem(`axiom:preferences:${this.userId}`) ?? "null",
          );
          const e = JSON.parse(
            localStorage.getItem(`axiom:editor-preferences:${this.userId}`) ??
              "null",
          );
          if (a || e) {
            const base = normalizeBundle({
              appearance: a?.base ?? initial.base.appearance,
              editor: e?.base ?? initial.base.editor,
            });
            initial = {
              ...initial,
              base,
              values: {
                appearance: preferencesSchema.parse(
                  a?.preferences ?? base.appearance.preferences,
                ),
                editor: validateEditorPreferences(
                  e?.preferences ?? base.editor.preferences,
                ),
              },
              device: deviceSchema.parse(a?.device ?? {}),
              mutationId:
                a?.mutationId || e?.mutationId
                  ? crypto.randomUUID()
                  : undefined,
              savePrevious: a?.savePrevious === true,
              ready: true,
              status: "Saved on this device",
            };
          }
        }
      } catch {
        initial.status =
          "An invalid local cache was ignored. Loading account preferences…";
      }
    this.emit(initial);
    if (!navigator.onLine)
      this.emit({
        ...this.state,
        ready: true,
        status: "Offline · preferences will sync when connected",
      });
    void this.sync();
    this.timer = setInterval(this.refresh, 10000);
    window.addEventListener("online", this.refresh);
    window.addEventListener("focus", this.refresh);
    window.addEventListener("axiom:connection-restored", this.refresh);
    window.addEventListener("storage", this.storage);
  };
  stop = () => {
    if (--this.users > 0) return;
    this.generation++;
    this.controller?.abort();
    clearInterval(this.timer);
    window.removeEventListener("online", this.refresh);
    window.removeEventListener("focus", this.refresh);
    window.removeEventListener("axiom:connection-restored", this.refresh);
    window.removeEventListener("storage", this.storage);
    this.emit(fresh());
  };
  refresh = () => {
    if (document.visibilityState === "visible") void this.sync();
  };
  storage = (event: StorageEvent) => {
    if (event.key === SIGN_OUT_PENDING && event.newValue) {
      this.generation++;
      this.controller?.abort();
      this.emit(fresh());
      return;
    }
    if (event.key !== this.key() || !event.newValue || !this.valid()) return;
    try {
      const incoming = this.parse(event.newValue);
      const local = this.state;
      if (
        !local.mutationId ||
        local.mutationId === incoming.mutationId ||
        equal(local.values, incoming.values)
      )
        this.emit({ ...local, ...incoming, ready: true });
      else {
        const merged = mergeBundle(
          bundleValues(local.base),
          local.values,
          incoming.values,
        );
        this.keep({
          ...local,
          ...incoming,
          values: merged.values,
          mutationId: crypto.randomUUID(),
          conflicts: [
            ...new Set([
              ...local.conflicts,
              ...incoming.conflicts,
              ...merged.conflicts,
            ]),
          ],
        });
      }
      void this.sync();
    } catch {
      /* Ignore invalid cross-tab data. */
    }
  };
  sync = async () => {
    if (
      !this.valid() ||
      this.inFlight ||
      !navigator.onLine ||
      this.state.conflicts.length
    )
      return;
    this.inFlight = true;
    const generation = this.generation,
      controller = new AbortController();
    this.controller = controller;
    const valid = () => this.valid() && generation === this.generation;
    try {
      const remote = normalizeBundle(
        await api<PreferencesBundle>("me/preferences-bundle", {
          signal: controller.signal,
          headers: { [APPEARANCE_SCHEMA_HEADER]: String(APPEARANCE_SCHEMA) },
        }),
      );
      if (!valid()) return;
      const local = this.state;
      if (!local.mutationId) {
        this.keep({
          ...local,
          base: remote,
          values: bundleValues(remote),
          ready: true,
          status: "Preferences synced to your account",
        });
        return;
      }
      const merge = mergeBundle(
        bundleValues(local.base),
        local.values,
        bundleValues(remote),
      );
      if (
        !this.keep({
          ...local,
          base: remote,
          values: merge.values,
          conflicts: merge.conflicts,
          ready: true,
          status: merge.conflicts.length
            ? "Preferences changed elsewhere. Review the conflicting fields."
            : "Syncing preferences…",
        }) ||
        merge.conflicts.length
      )
        return;
      const saved = normalizeBundle(
        await api<PreferencesBundle>("me/preferences-bundle", {
          method: "PATCH",
          signal: controller.signal,
          headers: { [APPEARANCE_SCHEMA_HEADER]: String(APPEARANCE_SCHEMA) },
          body: JSON.stringify({
            appearance: {
              preferences: merge.values.appearance,
              version: remote.appearance.version,
            },
            editor: {
              preferences: merge.values.editor,
              version: remote.editor.version,
            },
            mutationId: local.mutationId,
            savePrevious: local.savePrevious,
          }),
        }),
      );
      if (!valid()) return;
      const latest = this.state;
      this.keep(
        latest.mutationId === local.mutationId
          ? {
              ...latest,
              base: saved,
              values: bundleValues(saved),
              mutationId: undefined,
              savePrevious: false,
              status: "Preferences synced to your account",
            }
          : {
              ...latest,
              base: saved,
              status: "Saved on this device · awaiting sync",
            },
      );
    } catch (error) {
      if (valid() && !controller.signal.aborted)
        this.emit({
          ...this.state,
          ready: true,
          status:
            error instanceof ApiError && error.status === 426
              ? "Reload Axiom before syncing preferences. Your local changes are retained."
              : error instanceof ApiError && error.status === 409
                ? "Another device saved first. Retrying with a field-by-field merge…"
                : "Saved on this device · sync unavailable",
        });
    } finally {
      if (generation === this.generation) this.inFlight = false;
    }
  };
  preview = (
    preview: Partial<PreferenceValues> & { device?: DevicePreferences },
  ) =>
    this.emit({
      ...this.state,
      preview: { ...this.state.preview, ...preview },
    });
  clearPreview = (key: "appearance" | "editor") => {
    const preview = { ...this.state.preview };
    delete preview[key];
    if (key === "appearance") delete preview.device;
    this.emit({ ...this.state, preview });
  };
  apply = (
    values: PreferenceValues,
    device: DevicePreferences,
    savePrevious = false,
  ) => {
    try {
      const normalized = {
        appearance: preferencesSchema.parse(values.appearance),
        editor: validateEditorPreferences(values.editor),
      };
      const remoteChanged =
        !equal(normalized, this.state.values) || savePrevious;
      const next = {
        ...this.state,
        values: normalized,
        device: deviceSchema.parse(device),
        mutationId: remoteChanged ? crypto.randomUUID() : this.state.mutationId,
        savePrevious: savePrevious || this.state.savePrevious,
        preview: {},
        ready: true,
        status: remoteChanged
          ? "Saved on this device · awaiting sync"
          : "Preferences saved",
      };
      if (!this.keep(next)) return false;
      void this.sync();
      return true;
    } catch (error) {
      this.emit({
        ...this.state,
        status:
          error instanceof Error ? error.message : "Check your preferences.",
      });
      return false;
    }
  };
  resolve = (mine: boolean) => {
    const values = structuredClone(this.state.values);
    if (!mine)
      for (const path of this.state.conflicts) {
        const keys = path.split(".");
        let target = values as unknown as Record<string, unknown>;
        let source = bundleValues(this.state.base) as unknown as Record<
          string,
          unknown
        >;
        for (const key of keys.slice(0, -1)) {
          target = target[key] as Record<string, unknown>;
          source = source[key] as Record<string, unknown>;
        }
        const key = keys.at(-1)!;
        if (source[key] === undefined) delete target[key];
        else target[key] = source[key];
      }
    if (
      !this.keep({
        ...this.state,
        values,
        conflicts: [],
        mutationId: crypto.randomUUID(),
        status: "Saved on this device · awaiting sync",
      })
    )
      return;
    void this.sync();
    return values;
  };
}
export function usePreferencesBundle(userId?: string) {
  const key = userId ?? "";
  if (!stores.has(key)) stores.set(key, new PreferenceStore(key));
  const store = stores.get(key)!;
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.get,
    () => serverSnapshot,
  );
  useEffect(() => {
    store.start();
    return store.stop;
  }, [store]);
  return { snapshot, store, userId };
}
