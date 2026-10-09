"use client";
import { Field, NativeSelect } from "./ui/controls";
import { useI18n } from "@axiom/i18n/react";
import {
  locales,
  localeTag,
  resolveLocale,
  type LocaleChoice,
} from "@axiom/i18n";
import { browserLanguages } from "@axiom/i18n/client";
export default function LanguageField({
  value,
  onChange,
  disabled,
}: {
  value: LocaleChoice;
  onChange: (value: LocaleChoice) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const automatic = locales.find(
    (locale) => locale.id === resolveLocale("auto", browserLanguages()),
  )!;
  return (
    <Field
      label={t("Interface language")}
      hint={t(
        "Choose the language of menus, controls and messages. Your documents are not translated.",
      )}
    >
      <NativeSelect
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as LocaleChoice)}
      >
        <option value="auto">
          {t("Automatic — {language}", { language: automatic.name })}
        </option>
        {locales.map((locale) => (
          <option
            key={locale.id}
            value={locale.id}
            lang={localeTag(locale.id)}
            dir={locale.direction}
          >
            {locale.name}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
