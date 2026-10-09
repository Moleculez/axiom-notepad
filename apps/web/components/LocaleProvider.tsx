"use client";
import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { useI18n } from "@axiom/i18n/react";
import {
  applyDocumentLocale,
  browserLanguages,
  localeRuntime,
} from "@axiom/i18n/client";
import {
  cachedInitialLocale,
  resetLocaleAccount,
} from "../lib/locale-preferences";
import { DATASET_RESET } from "../lib/dataset";
import BrandMark from "./BrandMark";

/** Cached SSR contains only a neutral mark; no personalized HTML or cookies. */
export default function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useI18n();
  useEffect(() => {
    void localeRuntime.choose(cachedInitialLocale(), browserLanguages());
    const matchBrowser = () => {
      if (localeRuntime.snapshot().choice === "auto")
        void localeRuntime.choose("auto", browserLanguages());
    };
    window.addEventListener("languagechange", matchBrowser);
    window.addEventListener(DATASET_RESET, resetLocaleAccount);
    return () => {
      window.removeEventListener(DATASET_RESET, resetLocaleAccount);
      window.removeEventListener("languagechange", matchBrowser);
    };
  }, []);
  useLayoutEffect(() => {
    if (locale.ready) applyDocumentLocale(locale.locale);
  }, [locale.locale, locale.ready]);
  if (!locale.ready)
    return (
      <div className="ws-boot" aria-busy="true">
        <BrandMark />
      </div>
    );
  return children;
}
