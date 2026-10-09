"use client";
import { useEffect, useSyncExternalStore } from "react";
import { browserLanguages, localeRuntime } from "@axiom/i18n/client";
import { isLocaleChoice, type LocaleChoice } from "@axiom/i18n";
import {
  defaultLocaleRecord,
  localeRecordSchema,
  localeMutationSchema,
  type LocaleMutation,
  type LocaleRecord,
} from "@axiom/shared/locale-preferences";
import { ApiError, api } from "./client";

type State = Readonly<{
  ready: boolean;
  locale: LocaleChoice;
  pending: boolean;
  saving: boolean;
  error: string;
  conflict: LocaleRecord | null;
}>;
const empty: State = Object.freeze({
  ready: false,
  locale: "auto",
  pending: false,
  saving: false,
  error: "",
  conflict: null,
});
const activeKey = "axiom:locale:active-account";
export const guestLocaleKey = "axiom:locale:guest:v1";
export function readGuestLocale(): LocaleChoice {
  try {
    const value = localStorage.getItem(guestLocaleKey);
    return isLocaleChoice(value) ? value : "auto";
  } catch {
    return "auto";
  }
}
export function cachedInitialLocale(): LocaleChoice {
  try {
    const account = localStorage.getItem(activeKey);
    if (account) {
      const cached = readCache(account);
      if (cached) return cached.outbox?.locale ?? cached.base.locale;
    }
  } catch {
    /* Browser storage may be disabled. */
  }
  return readGuestLocale();
}
type Cache = { schema: 1; base: LocaleRecord; outbox: LocaleMutation | null };
const cacheKey = (account: string) => `axiom:locale:account:v1:${account}`;
function readCache(account: string): Cache | null {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey(account)) ?? "null");
    const base = localeRecordSchema.safeParse(raw?.base);
    const outbox = raw?.outbox
      ? localeMutationSchema.safeParse(raw.outbox)
      : null;
    return raw?.schema === 1 && base.success && (!outbox || outbox.success)
      ? { schema: 1, base: base.data, outbox: outbox?.data ?? null }
      : null;
  } catch {
    return null;
  }
}

/** One small preference, with durable exact-retry outbox and account fencing. */
export class AccountLocaleStore {
  private state: State = empty;
  private base = defaultLocaleRecord;
  private outbox: LocaleMutation | null = null;
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private generation = 0;
  private preview: LocaleChoice | null = null;
  constructor(readonly account: string) {}
  snapshot = () => this.state;
  serverSnapshot = () => empty;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(patch: Partial<State>) {
    this.state = Object.freeze({ ...this.state, ...patch });
    this.listeners.forEach((listener) => listener());
  }
  private persist() {
    localStorage.setItem(
      cacheKey(this.account),
      JSON.stringify({
        schema: 1,
        base: this.base,
        outbox: this.outbox,
      } satisfies Cache),
    );
  }
  private show() {
    if (this.active && this.preview === null)
      void localeRuntime.choose(this.state.locale, browserLanguages());
  }
  start() {
    if (this.active) return;
    this.active = true;
    ++this.generation;
    const cached = readCache(this.account);
    this.base = cached?.base ?? defaultLocaleRecord;
    this.outbox = cached?.outbox ?? null;
    try {
      localStorage.setItem(activeKey, this.account);
    } catch {
      /* Nonpersistent browser. */
    }
    this.emit({
      ready: true,
      locale: this.outbox?.locale ?? this.base.locale,
      pending: !!this.outbox,
      saving: false,
      error: "",
      conflict: null,
    });
    this.show();
    window.addEventListener("online", this.refresh);
    window.addEventListener("focus", this.refresh);
    window.addEventListener("storage", this.storage);
    this.timer = setInterval(this.refresh, 30000);
    void this.refresh();
  }
  stop() {
    this.active = false;
    ++this.generation;
    this.preview = null;
    this.controller?.abort();
    this.controller = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("online", this.refresh);
    window.removeEventListener("focus", this.refresh);
    window.removeEventListener("storage", this.storage);
    this.emit({ saving: false });
  }
  private storage = (event: StorageEvent) => {
    if (event.key !== cacheKey(this.account) || !this.active) return;
    const cached = readCache(this.account);
    if (!cached) return;
    // Same-browser tabs share the exact mutation, rather than competing writes.
    this.controller?.abort();
    this.controller = null;
    ++this.generation;
    this.base = cached.base;
    this.outbox = cached.outbox;
    this.emit({
      locale: this.outbox?.locale ?? this.base.locale,
      pending: !!this.outbox,
      saving: false,
      conflict: null,
    });
    this.show();
    void this.refresh();
  };
  previewChoice = async (choice: LocaleChoice) => {
    this.preview = choice;
    return localeRuntime.choose(choice, browserLanguages());
  };
  cancelPreview = () => {
    this.preview = null;
    this.show();
  };
  save = (choice: LocaleChoice): boolean => {
    if (!this.active || this.state.saving) return false;
    const previous = this.outbox;
    this.outbox = {
      locale: choice,
      version: this.base.version,
      mutationId: crypto.randomUUID(),
    };
    try {
      this.persist();
    } catch {
      this.outbox = previous;
      this.emit({
        error: "The operation could not be completed. Please try again.",
      });
      return false;
    }
    this.preview = null;
    this.emit({ locale: choice, pending: true, error: "", conflict: null });
    this.show();
    void this.refresh();
    return true;
  };
  resolve = (keepLocal: boolean) => {
    const remote = this.state.conflict;
    if (!remote) return;
    const choice = this.state.locale;
    this.base = remote;
    this.outbox = null;
    this.emit({ locale: remote.locale, pending: false, conflict: null });
    if (keepLocal) this.save(choice);
    else {
      try {
        this.persist();
      } catch {
        /* Remote choice remains applied. */
      }
      this.show();
    }
  };
  refresh = async () => {
    if (
      !this.active ||
      !navigator.onLine ||
      this.controller ||
      this.state.conflict
    )
      return;
    const controller = new AbortController(),
      generation = this.generation;
    this.controller = controller;
    const sent = this.outbox;
    this.emit({ saving: !!sent });
    try {
      const raw = await api<LocaleRecord>("me/locale", {
        method: sent ? "PATCH" : "GET",
        signal: controller.signal,
        ...(sent ? { body: JSON.stringify(sent) } : {}),
      });
      if (
        !this.active ||
        generation !== this.generation ||
        controller.signal.aborted
      )
        return;
      const record = localeRecordSchema.parse(raw);
      this.base = record;
      // A subsequent save must not be acknowledged by an earlier request.
      if (sent && this.outbox?.mutationId === sent.mutationId)
        this.outbox = null;
      if (this.outbox && !sent) {
        if (record.version !== this.outbox.version) {
          this.emit({ conflict: record });
          return;
        }
      }
      this.emit({
        locale: this.outbox?.locale ?? record.locale,
        pending: !!this.outbox,
        error: "",
      });
      try {
        this.persist();
      } catch {
        this.emit({ error: "Saved on this device; waiting to sync." });
      }
      this.show();
    } catch (error) {
      if (
        !this.active ||
        generation !== this.generation ||
        controller.signal.aborted
      )
        return;
      if (error instanceof ApiError && error.status === 409) {
        const current = localeRecordSchema.safeParse(error.data?.current);
        if (current.success) this.emit({ conflict: current.data });
      } else if (!(error instanceof TypeError) && navigator.onLine) {
        this.emit({
          error: "The operation could not be completed. Please try again.",
        });
      }
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this.emit({ saving: false });
        // A save made while the initial GET was in flight must drain now, not
        // wait for the next poll. An unchanged failed mutation is not retried
        // in a loop; it keeps its exact durable outbox for the next online event.
        if (
          this.active &&
          generation === this.generation &&
          !controller.signal.aborted &&
          this.outbox &&
          this.outbox.mutationId !== sent?.mutationId &&
          !this.state.conflict
        )
          void this.refresh();
      }
    }
  };
}
const stores = new Map<string, AccountLocaleStore>();
export function accountLocaleStore(account: string) {
  let store = stores.get(account);
  if (!store) {
    store = new AccountLocaleStore(account);
    stores.set(account, store);
  }
  return store;
}
let activeStore: AccountLocaleStore | null = null;
export function useAccountLocale(account?: string, ready = true) {
  useEffect(() => {
    if (!ready) return;
    if (!account) {
      activeStore?.stop();
      activeStore = null;
      try {
        localStorage.removeItem(activeKey);
      } catch {
        /* Storage disabled. */
      }
      void localeRuntime.choose(readGuestLocale(), browserLanguages());
      return;
    }
    const store = accountLocaleStore(account);
    activeStore?.stop();
    activeStore = store;
    store.start();
    return () => {
      if (activeStore === store) {
        store.stop();
        activeStore = null;
      }
    };
  }, [account, ready]);
}
export function useLocalePreferences(account: string) {
  const store = accountLocaleStore(account);
  const state = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.serverSnapshot,
  );
  return { ...state, store };
}
export function resetLocaleAccount() {
  activeStore?.stop();
  activeStore = null;
  stores.clear();
  try {
    localStorage.removeItem(activeKey);
  } catch {
    /* Storage disabled. */
  }
  void localeRuntime.choose(readGuestLocale(), browserLanguages());
}
