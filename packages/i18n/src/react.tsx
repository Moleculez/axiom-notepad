"use client";
import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import { localeRuntime, label, t } from "./client";
import type { MessageId, MessageValues } from "./index";
/** Subscribe without replacing any editor, selection, history or provider. */
export function useI18n() {
  const snapshot = useSyncExternalStore(
    localeRuntime.subscribe,
    localeRuntime.snapshot,
    localeRuntime.serverSnapshot,
  );
  return { ...snapshot, t: snapshot.translate, label };
}
export function Message({
  id,
  values,
  slots,
}: {
  id: MessageId;
  values?: MessageValues;
  slots?: Record<string, ReactNode>;
}) {
  const { t: translate } = useI18n();
  if (!slots) return translate(id, values);
  const names = Object.keys(slots);
  const tokens = Object.fromEntries(
    names.map((name, i) => [name, `\u0001${i}\u0002`]),
  );
  const formatted = translate(id, { ...values, ...tokens });
  return formatted.split(/(\u0001\d+\u0002)/).map((part, index) => {
    const slot = /^\u0001(\d+)\u0002$/.exec(part);
    return (
      <Fragment key={index}>
        {slot ? slots[names[Number(slot[1])]] : part}
      </Fragment>
    );
  });
}
export { label, t };
export { Message as I18nText, useI18n as useInterfaceLocale, label as uiText };
