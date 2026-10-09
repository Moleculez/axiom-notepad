"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@axiom/i18n/react";
import type { LocaleChoice } from "@axiom/i18n";
import { useLocalePreferences } from "../../lib/locale-preferences";
import { useRetainedSettingsForm } from "../../lib/settings-forms";
import { useWorkspace } from "./ui";
import LanguageField from "../LanguageField";
import { ActionRow, Button, HelpText, Notice } from "../ui/controls";
export default function LanguageSettings() {
  const { session } = useWorkspace();
  const saved = useLocalePreferences(session.user.id),
    { store } = saved;
  const { t, loading, error } = useI18n();
  const [choice, setChoice] = useState<LocaleChoice>(saved.locale);
  const hasPreview = useRef(false);
  const dirty = hasPreview.current && choice !== saved.locale;
  useEffect(() => {
    if (!hasPreview.current) setChoice(saved.locale);
  }, [saved.locale]);
  const discard = useCallback(() => {
    hasPreview.current = false;
    setChoice(store.snapshot().locale);
    store.cancelPreview();
  }, [store]);
  useRetainedSettingsForm("language", dirty, discard);
  useEffect(() => () => store.cancelPreview(), [store]);
  return (
    <section
      className="settings-card language-settings"
      aria-label={t("Language")}
    >
      <header>
        <h2>{t("Language")}</h2>
        <HelpText>
          {t(
            "Preview your language, then save to use it on your other devices.",
          )}
        </HelpText>
      </header>
      <LanguageField
        value={choice}
        onChange={(value) => {
          hasPreview.current = value !== saved.locale;
          setChoice(value);
          if (hasPreview.current) void store.previewChoice(value);
          else store.cancelPreview();
        }}
        disabled={!saved.ready || saved.saving}
      />
      {(error || saved.error) && (
        <Notice tone="danger" role="alert">
          {t((error || saved.error) as Parameters<typeof t>[0])}
        </Notice>
      )}
      {saved.conflict && (
        <Notice tone="warning">
          <span>
            {t(
              "Language changed on another device. Choose which version to keep.",
            )}
          </span>
          <ActionRow>
            <Button onClick={() => store.resolve(true)}>
              {t("Use my choice")}
            </Button>
            <Button onClick={() => store.resolve(false)}>
              {t("Use other device")}
            </Button>
          </ActionRow>
        </Notice>
      )}
      <footer className="ws-actions">
        <span role="status">
          {dirty
            ? t("Language preview")
            : saved.pending
              ? t("Saved on this device; waiting to sync.")
              : t("Language saved")}
        </span>
        <ActionRow>
          <Button
            className="button secondary"
            disabled={!dirty || saved.saving}
            onClick={discard}
          >
            {t("Cancel")}
          </Button>
          <Button
            className="button primary"
            disabled={!dirty || loading || !!error || saved.saving}
            onClick={() => {
              if (store.save(choice)) hasPreview.current = false;
            }}
          >
            {t(saved.saving ? "Saving…" : "Save changes")}
          </Button>
        </ActionRow>
      </footer>
    </section>
  );
}
