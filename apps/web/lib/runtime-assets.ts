declare const __AXIOM_ASSET_BASE__: string;
/** Static hosts supply a repository prefix; the workbench keeps root URLs. */
export function runtimeAsset(path: string) {
  const base =
    typeof __AXIOM_ASSET_BASE__ === "string" ? __AXIOM_ASSET_BASE__ : "/";
  return `${base.replace(/\/?$/, "/")}${path.replace(/^\/+/, "")}`;
}
export const isStaticRuntime = typeof __AXIOM_ASSET_BASE__ === "string";
