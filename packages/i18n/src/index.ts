import { IntlMessageFormat } from "intl-messageformat";
import type { MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import english from "./messages/en.json" with { type: "json" };
import type { Locale } from "./locales";
export * from "./locales";
export type MessageId = keyof typeof english;
export type MessageValues = Record<string, string | number | boolean | Date>;
export type Catalog = Record<MessageId, string | MessageFormatElement[]>;
export type Translator = (id: MessageId, values?: MessageValues) => string;
/** Pure instance: safe in workers, SSR and tests; no ambient account state. */
export function createTranslator(
  locale: Locale,
  catalog: Partial<Catalog> = {},
): Translator {
  const formats = new Map<MessageId, IntlMessageFormat>();
  return (id, values) => {
    const message = catalog[id] ?? english[id];
    if (!message) return id;
    let format = formats.get(id);
    if (!format) {
      format = new IntlMessageFormat(message, locale, undefined, {
        ignoreTag: true,
      });
      formats.set(id, format);
    }
    return String(format.format(values));
  };
}
export function messageId(value: string): MessageId | undefined {
  return Object.hasOwn(english, value) ? (value as MessageId) : undefined;
}
export const englishMessages = english;
export const englishTranslator = createTranslator("en");

/** Visible values only. Never use these for persisted dates, IDs or ordering. */
export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat(locale, options).format(value);
}
export function formatDate(
  locale: Locale,
  value: string | number | Date,
  options?: Intl.DateTimeFormatOptions,
) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, options).format(date);
}
export function formatRelativeTime(
  locale: Locale,
  value: string | number | Date,
  now = Date.now(),
) {
  const seconds = (new Date(value).getTime() - now) / 1000;
  if (!Number.isFinite(seconds)) return "—";
  const [unit, divisor]: [Intl.RelativeTimeFormatUnit, number] =
    Math.abs(seconds) < 60
      ? ["second", 1]
      : Math.abs(seconds) < 3600
        ? ["minute", 60]
        : Math.abs(seconds) < 86400
          ? ["hour", 3600]
          : Math.abs(seconds) < 604800
            ? ["day", 86400]
            : Math.abs(seconds) < 2629800
              ? ["week", 604800]
              : Math.abs(seconds) < 31557600
                ? ["month", 2629800]
                : ["year", 31557600];
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    Math.round(seconds / divisor),
    unit,
  );
}
