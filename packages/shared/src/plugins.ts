import { z } from "zod";

export const pluginApiVersion = 1;
export const pluginLimits = {
  compressedBytes: 5 * 1024 * 1024,
  expandedBytes: 10 * 1024 * 1024,
  entries: 32,
  messageBytes: 8 * 1024 * 1024,
  stateBytes: 256 * 1024,
  callsPerMinute: 100,
  concurrentCalls: 8,
  packagesPerAccount: 32,
  packageBytesPerAccount: 64 * 1024 * 1024,
} as const;
export const pluginCapabilities = [
  "resources:read",
  "documents:read",
  "planning:read",
  "references:read",
  "files:propose",
  "documents:propose",
  "tasks:propose",
  "storage:private",
] as const;
export type PluginCapability = (typeof pluginCapabilities)[number];
export const pluginCapabilityLabels: Record<PluginCapability, string> = {
  "resources:read": "Read file names and metadata in approved workspaces",
  "documents:read": "Read saved document text in approved workspaces",
  "planning:read": "Read tasks and milestones in approved workspaces",
  "references:read": "Read reference metadata in approved workspaces",
  "files:propose": "Prepare new Markdown files for your review",
  "documents:propose": "Prepare document changes for your review",
  "tasks:propose": "Prepare task changes for your review",
  "storage:private": "Save private plugin settings for your account",
};
const identifier = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
  .max(120);
const label = z.string().trim().min(1).max(200);
const text = z.string().max(16000);
export const pluginIcons = [
  "Puzzle",
  "NotebookPen",
  "CheckCheck",
  "ChartGantt",
  "FileText",
  "BookOpen",
  "Sigma",
  "ListChecks",
  "Settings2",
] as const;
export const pluginFieldSchema = z
  .object({
    id: identifier,
    label,
    type: z.enum(["text", "textarea", "number", "date", "select", "checkbox"]),
    hint: z.string().max(500).optional(),
    required: z.boolean().optional(),
    value: z.union([text, z.number().finite(), z.boolean()]).optional(),
    options: z
      .array(z.object({ value: z.string().max(200), label }).strict())
      .max(100)
      .optional(),
  })
  .strict()
  .refine(
    (v) => v.type !== "select" || !!v.options?.length,
    "Select fields need options.",
  )
  .refine(
    (v) =>
      !v.options ||
      new Set(v.options.map((o) => o.value)).size === v.options.length,
    "Option values must be unique.",
  )
  .refine(
    (v) =>
      v.value === undefined ||
      (v.type === "checkbox"
        ? typeof v.value === "boolean"
        : v.type === "number"
          ? typeof v.value === "number"
          : typeof v.value === "string" &&
            (v.type !== "select" ||
              v.options?.some((o) => o.value === v.value))),
    "Default values must match their field type and options.",
  );
export type PluginField = z.infer<typeof pluginFieldSchema>;
const sourceLink = z
  .object({
    resourceId: z.uuid(),
    line: z.number().int().min(1).max(1_000_000).optional(),
    expectedHash: z
      .string()
      .regex(/^[\da-f]{64}$/)
      .optional(),
  })
  .strict();
export const pluginPanelSchema = z
  .object({
    title: label,
    blocks: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("text"), text }).strict(),
          z
            .object({
              kind: z.literal("notice"),
              text,
              tone: z
                .enum(["info", "warning", "danger", "success"])
                .default("info"),
            })
            .strict(),
          z.object({ kind: z.literal("heading"), text: label }).strict(),
          z.object({ kind: z.literal("separator") }).strict(),
          z
            .object({ kind: z.literal("field"), field: pluginFieldSchema })
            .strict(),
          z
            .object({
              kind: z.literal("action"),
              label,
              command: identifier,
              primary: z.boolean().optional(),
            })
            .strict(),
          z
            .object({ kind: z.literal("link"), label, target: sourceLink })
            .strict(),
          z
            .object({ kind: z.literal("review"), label, setId: z.uuid() })
            .strict(),
          z
            .object({
              kind: z.literal("table"),
              columns: z.array(label).min(1).max(12),
              rows: z.array(z.array(z.string().max(3000)).max(12)).max(2000),
            })
            .strict(),
        ]),
      )
      .max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = new Set<string>();
    for (const [index, block] of v.blocks.entries()) {
      if (block.kind === "field") {
        if (
          ["__proto__", "constructor", "prototype"].includes(block.field.id) ||
          ids.has(block.field.id)
        )
          ctx.addIssue({
            code: "custom",
            path: ["blocks", index],
            message: "Field identifiers must be safe and unique.",
          });
        ids.add(block.field.id);
      }
      if (
        block.kind === "table" &&
        block.rows.some((row) => row.length !== block.columns.length)
      )
        ctx.addIssue({
          code: "custom",
          path: ["blocks", index],
          message: "Table rows must match their columns.",
        });
    }
  });
export type PluginPanel = z.infer<typeof pluginPanelSchema>;
export const pluginManifestSchema = z
  .object({
    format: z.literal("axiom-plugin"),
    apiVersion: z.literal(1),
    id: identifier,
    name: label,
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/)
      .max(60),
    description: z.string().min(1).max(1000),
    author: label,
    license: label,
    entry: z.literal("main.js"),
    capabilities: z
      .array(z.enum(pluginCapabilities))
      .max(pluginCapabilities.length),
    commands: z
      .array(
        z
          .object({
            id: identifier,
            title: label,
            description: z.string().max(500),
            icon: z.enum(pluginIcons).default("Puzzle"),
            context: z
              .enum(["workspace", "document", "planning"])
              .default("workspace"),
            slash: z.boolean().default(false),
            menu: z.boolean().default(false),
            panelOnly: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    settings: z.array(pluginFieldSchema).max(30).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      new Set(v.capabilities).size !== v.capabilities.length ||
      new Set(v.commands.map((c) => c.id)).size !== v.commands.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Capabilities and command identifiers must be unique.",
      });
    if (v.commands.some((c) => !c.id.startsWith(v.id + ".")))
      ctx.addIssue({
        code: "custom",
        path: ["commands"],
        message: "Commands must use the plugin's identifier namespace.",
      });
    if (
      new Set(v.settings.map((f) => f.id)).size !== v.settings.length ||
      v.settings.some((f) =>
        ["__proto__", "constructor", "prototype"].includes(f.id),
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["settings"],
        message: "Setting identifiers must be safe and unique.",
      });
  });
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
/** Project only compatible values; newly required fields still require review. */
export function compatiblePluginSettings(
  manifest: PluginManifest,
  values: Record<string, unknown>,
) {
  const result: Record<string, unknown> = {};
  for (const field of manifest.settings) {
    const value = values[field.id];
    const valid =
      field.type === "checkbox"
        ? typeof value === "boolean"
        : field.type === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : typeof value === "string" &&
            value.length <= 16000 &&
            (field.type !== "select" ||
              field.options?.some((o) => o.value === value));
    if (valid) result[field.id] = value;
    else if (field.value !== undefined) result[field.id] = field.value;
  }
  return result;
}
export type PluginInstallation = {
  id: string;
  plugin_id: string;
  package_hash: string;
  manifest: PluginManifest;
  enabled: boolean;
  revision: number;
  settings: Record<string, unknown>;
  bindings: Record<string, string>;
  previous_hash: string | null;
  updated_at: string;
};
export type PluginRegistry = {
  enabled: boolean;
  importsEnabled: boolean;
  catalog: { hash: string; manifest: PluginManifest }[];
  installations: PluginInstallation[];
  grants: PluginGrant[];
  approvals: {
    group_id: string;
    group_name: string;
    plugin_id: string;
    package_hash: string;
    space_ids: string[];
    revision: number;
    enabled: boolean;
  }[];
  activity: {
    id: string;
    installation_id: string | null;
    space_id: string | null;
    package_hash: string;
    method: string;
    outcome: string;
    change_set_id: string | null;
    change_set_status: string | null;
    created_at: string;
  }[];
};
export type PluginGrant = {
  id: string;
  installation_id: string;
  space_id: string;
  package_hash: string;
  revision: number;
  approval_revision: number | null;
  authorized?: boolean;
  capabilities: PluginCapability[];
  revoked_at: string | null;
};
export type PluginContext = {
  spaceId: string;
  spaceName: string;
  resourceId?: string;
  command: string;
  inputs: Record<string, string | number | boolean>;
  settings: Record<string, unknown>;
};
export const pluginMethods = [
  "resources.list",
  "documents.read",
  "planning.read",
  "references.list",
  "changes.prepare",
  "storage.get",
  "storage.set",
] as const;
export type PluginMethod = (typeof pluginMethods)[number];
export const pluginRpcSchema = z
  .object({
    grantId: z.uuid(),
    grantRevision: z.number().int().positive(),
    packageHash: z.string().regex(/^[\da-f]{64}$/),
    method: z.enum(pluginMethods),
    args: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export const pluginMethodCapabilities: Partial<
  Record<PluginMethod, PluginCapability>
> = {
  "resources.list": "resources:read",
  "documents.read": "documents:read",
  "planning.read": "planning:read",
  "references.list": "references:read",
  "storage.get": "storage:private",
  "storage.set": "storage:private",
};
export function validatePluginPanel(
  raw: unknown,
  manifest: PluginManifest,
): PluginPanel {
  const panel = pluginPanelSchema.parse(raw);
  if (
    panel.blocks.some(
      (b) =>
        b.kind === "action" &&
        !manifest.commands.some((c) => c.id === b.command),
    )
  )
    throw new Error("Panel actions must reference declared commands.");
  return panel;
}
export function pluginCommandId(pluginId: string, command: string) {
  return `plugin:${pluginId}:${command}`;
}
export const pluginInputValuesSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9.-]{0,119}$/),
  z.union([text, z.boolean(), z.number().finite()]),
);
