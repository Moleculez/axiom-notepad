import type {
  PluginContext,
  PluginManifest,
  PluginPanel,
  PluginMethod,
} from "../../shared/src/plugins";
export type {
  PluginContext,
  PluginManifest,
  PluginPanel,
  PluginField,
  PluginCapability,
} from "../../shared/src/plugins";
export interface PluginApi {
  /** Browser-safe random UUID inside an opaque worker, without origin privileges. */
  createId(): string;
  request<T = unknown>(
    method: PluginMethod,
    args?: Record<string, unknown>,
  ): Promise<T>;
  render(panel: PluginPanel): Promise<void>;
}
export type PluginDefinition = {
  activate?: (api: PluginApi, context: PluginContext) => void | Promise<void>;
  run: (api: PluginApi, context: PluginContext) => void | Promise<void>;
};
/** Export default definePlugin(...), then bundle as a self-contained browser ES module. */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition;
}
export function defineManifest(manifest: PluginManifest): PluginManifest {
  return manifest;
}
