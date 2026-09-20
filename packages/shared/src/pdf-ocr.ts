import { z } from "zod";
export const pdfOcrSettingsSchema = z
  .object({
    pages: z
      .array(z.number().int().min(1).max(2000))
      .min(1)
      .max(2000)
      .refine(
        (p) => new Set(p).size === p.length,
        "Choose each page only once.",
      ),
    language: z.enum(["eng", "chi_sim", "eng+chi_sim", "deu", "fra", "spa"]),
    research: z.boolean().default(false),
    searchable: z.boolean().default(true),
  })
  .strict()
  .refine(
    (s) =>
      !s.research || ["eng", "chi_sim", "eng+chi_sim"].includes(s.language),
    "Equation-aware OCR supports English and Simplified Chinese.",
  );
export type PdfOcrSettings = z.infer<typeof pdfOcrSettingsSchema>;
export type PdfOcrPage = {
  page: number;
  text: string;
  reviewed_text: string | null;
  reviewed: boolean;
  native: boolean;
  version: number;
};
export type PdfOcrJob = {
  id: string;
  owner_id: string;
  version_id: string;
  settings: PdfOcrSettings;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  error: string | null;
  output_key?: string | null;
  output_bytes: number;
  output_sha256: string | null;
  text_bytes: number;
  created_at: string;
  expires_at: string;
  completed_pages: number;
  pages?: PdfOcrPage[];
};
export function pdfOcrMarkdown(pages: PdfOcrPage[], versionId: string) {
  return pages
    .filter((p) => p.reviewed)
    .map(
      (p) =>
        `## Page ${p.page}\n\n${p.reviewed_text ?? p.text}\n\n[Source PDF, page ${p.page}](/api/v1/attachments/${versionId}#page=${p.page})`,
    )
    .join("\n\n");
}
