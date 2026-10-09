import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { useI18n } from "@axiom/i18n/react";
import {
  applyDocumentLocale,
  browserLanguages,
  configureLocaleAssets,
  localeRuntime,
} from "@axiom/i18n/client";
import { savedLocaleChoice, type LocaleChoice } from "@axiom/i18n";
import { runtimeAsset } from "../../web/lib/runtime-assets";
import BrandMark from "../../web/components/BrandMark";
export const showcaseLocaleKey = "axiom:locale:showcase:v1";
export function saveShowcaseLocale(choice: LocaleChoice) {
  return localeRuntime.choose(choice, browserLanguages()).then((success) => {
    if (success)
      try {
        localStorage.setItem(showcaseLocaleKey, choice);
      } catch {
        /* A session-only preview is still usable. */
      }
    return success;
  });
}
export default function LocaleBoundary({ children }: { children: ReactNode }) {
  const locale = useI18n();
  useEffect(() => {
    configureLocaleAssets(runtimeAsset(""));
    let choice: LocaleChoice = "en";
    try {
      const stored = localStorage.getItem(showcaseLocaleKey);
      choice = savedLocaleChoice(stored);
    } catch {
      /* Storage disabled. */
    }
    void localeRuntime.choose(choice, browserLanguages());
    const matchBrowser = () => {
      if (localeRuntime.snapshot().choice === "auto")
        void localeRuntime.choose("auto", browserLanguages());
    };
    window.addEventListener("languagechange", matchBrowser);
    return () => window.removeEventListener("languagechange", matchBrowser);
  }, []);
  useLayoutEffect(() => {
    if (locale.ready) applyDocumentLocale(locale.locale);
  }, [locale.locale, locale.ready]);
  return locale.ready ? (
    children
  ) : (
    <div className="ws-boot" aria-busy="true">
      <BrandMark />
    </div>
  );
}
