"use client";
import { createContext, useContext, useEffect } from "react";

export type RetainedSettingsForm = { dirty: boolean; discard: () => void };
export const SettingsForms = createContext<Map<
  string,
  RetainedSettingsForm
> | null>(null);
/** One settings exit guard owns all retained forms, including extension drafts. */
export function useRetainedSettingsForm(
  id: string,
  dirty: boolean,
  discard: () => void,
) {
  const forms = useContext(SettingsForms);
  useEffect(() => {
    forms?.set(id, { dirty, discard });
    return () => {
      forms?.delete(id);
    };
  }, [forms, id, dirty, discard]);
}
