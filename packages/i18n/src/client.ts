import {
  createTranslator,
  englishTranslator,
  messageId,
  type Catalog,
  type MessageId,
  type MessageValues,
  type Translator,
} from "./index";
import {
  resolveLocale,
  localeDirection,
  localeTag,
  type Locale,
  type LocaleChoice,
} from "./locales";

export type LocaleSnapshot = Readonly<{
  locale: Locale;
  choice: LocaleChoice;
  ready: boolean;
  loading: boolean;
  error: string;
  translate: Translator;
}>;
const initial: LocaleSnapshot = Object.freeze({
  locale: "en",
  choice: "en",
  ready: false,
  loading: false,
  error: "",
  translate: englishTranslator,
});
/** Only one active catalog plus English; races cannot install a stale preview. */
export class LocaleRuntime {
  private value = initial;
  private listeners = new Set<() => void>();
  private sequence = 0;
  constructor(private load: (locale: Locale) => Promise<Partial<Catalog>>) {}
  snapshot = () => this.value;
  serverSnapshot = () => initial;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(value: LocaleSnapshot) {
    this.value = Object.freeze(value);
    this.listeners.forEach((listener) => listener());
  }
  async choose(
    choice: LocaleChoice,
    languages: readonly string[] = [],
  ): Promise<boolean> {
    const sequence = ++this.sequence;
    const locale = resolveLocale(choice, languages);
    if (this.value.ready && locale === this.value.locale) {
      this.emit({ ...this.value, choice, loading: false, error: "" });
      return true;
    }
    this.emit({ ...this.value, loading: true, error: "" });
    try {
      const catalog = locale === "en" ? {} : await this.load(locale);
      if (sequence !== this.sequence) return false;
      this.emit({
        locale,
        choice,
        ready: true,
        loading: false,
        error: "",
        translate: createTranslator(locale, catalog),
      });
      return true;
    } catch {
      if (sequence !== this.sequence) return false;
      this.emit({
        ...this.value,
        ready: true,
        loading: false,
        error:
          "Unable to load this language. Your current language is unchanged.",
      });
      return false;
    }
  }
}

let assetBase = "/";
export function configureLocaleAssets(base: string) {
  if (!/^\/(?:[\w-]+\/)*$/.test(base))
    throw new Error("Invalid locale asset base");
  assetBase = base;
}
export const localeRuntime = new LocaleRuntime(async (locale) => {
  const version = process.env.NEXT_PUBLIC_AXIOM_LOCALE_REVISION ?? "dev";
  const response = await fetch(
    `${assetBase}locales/${locale}.json?v=${version}`,
    { credentials: "omit" },
  );
  if (!response.ok) throw new Error("Locale catalog unavailable");
  const catalog: unknown = await response.json();
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog))
    throw new Error("Invalid locale catalog");
  return catalog as Catalog;
});
/** Imperative views call this at the presentation edge, not in state machines. */
export function t(id: MessageId, values?: MessageValues) {
  return (
    typeof document === "undefined"
      ? englishTranslator
      : localeRuntime.snapshot().translate
  )(id, values);
}
/** Registry labels remain stable English aliases; only their display changes. */
export function label(value: string, values?: MessageValues) {
  const id = messageId(value);
  return id ? t(id, values) : value;
}
export const currentLocale = () =>
  typeof document === "undefined"
    ? ("en" as const)
    : localeRuntime.snapshot().locale;
export const browserLanguages = () =>
  typeof navigator === "undefined"
    ? []
    : (navigator.languages ?? [navigator.language]);
export function applyDocumentLocale(locale: Locale) {
  document.documentElement.lang = localeTag(locale);
  document.documentElement.dir = localeDirection(locale);
  document.documentElement.dataset.locale = locale;
}
