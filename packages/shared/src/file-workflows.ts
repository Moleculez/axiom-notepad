import { z } from "zod";
import { resourceNameSchema, type Resource } from "./workspace";
export const folderColors = [
  "slate",
  "blue",
  "indigo",
  "violet",
  "rose",
  "orange",
  "amber",
  "green",
  "teal",
] as const;
export const fileOperationSchema = z
  .object({
    id: z.uuid(),
    command: z.enum(["move", "copy", "rename", "trash", "restore"]),
    items: z
      .array(
        z.object({
          id: z.uuid(),
          version: z.number().int().positive(),
          name: resourceNameSchema.optional(),
        }),
      )
      .min(1)
      .max(200),
    destination: z
      .object({ spaceId: z.uuid(), parentId: z.uuid().nullable() })
      .optional(),
    confirmAudience: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    if (["move", "copy"].includes(input.command) && !input.destination)
      ctx.addIssue({
        code: "custom",
        path: ["destination"],
        message: "Choose a destination folder.",
      });
    if (input.command === "rename" && input.items.some((item) => !item.name))
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "Provide a new name for every selected item.",
      });
  });
export type FileOperationInput = z.infer<typeof fileOperationSchema>;
export type FileOperationItem = FileOperationInput["items"][number] & {
  mutationId: string;
  original: Pick<
    Resource,
    "id" | "name" | "version" | "space_id" | "parent_id" | "kind"
  >;
};
export type FileOperationResult = {
  id: string;
  ok: boolean;
  error?: string;
  resource?: Pick<
    Resource,
    "id" | "name" | "version" | "space_id" | "parent_id" | "kind"
  >;
};
export type FileOperation = {
  id: string;
  command: FileOperationInput["command"];
  status: "queued" | "running" | "completed" | "cancelled";
  input: Omit<FileOperationInput, "items"> & { items: FileOperationItem[] };
  results: FileOperationResult[];
  updated_at: string;
};
export function renameFiles(
  items: Pick<Resource, "id" | "name" | "version" | "kind">[],
  input: {
    mode: "replace" | "prefix" | "suffix" | "number";
    text: string;
    find: string;
    start: number;
  },
) {
  return items.map((item, index) => {
    const dot = item.kind === "file" ? item.name.lastIndexOf(".") : -1;
    const stem = dot > 0 ? item.name.slice(0, dot) : item.name,
      extension = dot > 0 ? item.name.slice(dot) : "";
    const name =
      input.mode === "replace"
        ? input.find
          ? stem.split(input.find).join(input.text)
          : stem
        : input.mode === "prefix"
          ? input.text + stem
          : input.mode === "suffix"
            ? stem + input.text
            : `${input.text || stem} ${String(input.start + index).padStart(2, "0")}`;
    return {
      id: item.id,
      version: item.version,
      name: resourceNameSchema.parse(name + extension),
    };
  });
}
export function selectFileRange(
  ids: string[],
  previous: string[],
  anchor: string | null,
  target: string,
  extend: boolean,
  toggle: boolean,
) {
  if (extend && anchor && ids.includes(anchor)) {
    const a = ids.indexOf(anchor),
      b = ids.indexOf(target);
    return [
      ...new Set([
        ...(toggle ? previous : []),
        ...ids.slice(Math.min(a, b), Math.max(a, b) + 1),
      ]),
    ];
  }
  return toggle
    ? previous.includes(target)
      ? previous.filter((id) => id !== target)
      : [...previous, target]
    : [target];
}
export function uploadRelativePath(file: {
  name: string;
  webkitRelativePath?: string;
}) {
  const parts = (file.webkitRelativePath || file.name).split("/");
  if (
    parts.length > 33 ||
    parts.some((part) => !resourceNameSchema.safeParse(part).success)
  )
    throw new Error(
      "Folder paths must use valid names and be no deeper than 32 folders.",
    );
  return parts.slice(0, -1);
}
