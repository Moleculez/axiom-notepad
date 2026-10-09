import { z } from "zod";
import { localeIds, type LocaleChoice } from "@axiom/i18n/locales";
export const localeChoiceSchema = z.enum(["auto", ...localeIds]);
export const localeRecordSchema = z
  .object({
    locale: localeChoiceSchema,
    version: z.number().int().nonnegative(),
    mutationId: z.uuid().nullable(),
  })
  .strict();
export type LocaleRecord = z.infer<typeof localeRecordSchema>;
export type LocaleMutation = {
  locale: LocaleChoice;
  version: number;
  mutationId: string;
};
export const defaultLocaleRecord: LocaleRecord = {
  locale: "auto",
  version: 0,
  mutationId: null,
};
export const localeMutationSchema = z
  .object({
    locale: localeChoiceSchema,
    version: z.number().int().nonnegative(),
    mutationId: z.uuid(),
  })
  .strict();
