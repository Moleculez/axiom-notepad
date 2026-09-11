import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { z } from "zod";
import { contrastRatio, paletteSchema } from "./appearance";
import type { ThemePackManifest } from "./theme-packs";

const path = z
  .string()
  .regex(/^[a-zA-Z0-9_./-]+$/)
  .refine(
    (v) => !v.startsWith("/") && !v.split("/").includes(".."),
    "Use a repository-relative path.",
  );
export const themePackManifestSchema = z
  .object({
    format: z.literal("axiom-theme-pack"),
    version: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]{1,50}$/),
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(500),
    author: z.string().min(1).max(100),
    license: z.string().min(1).max(100),
    minimumAppearanceSchema: z.literal(5),
    css: path,
    assets: z.array(path).max(30),
    fixtures: z.array(path).min(1).max(20),
    palettes: z.object({ light: paletteSchema, dark: paletteSchema }).strict(),
  })
  .strict();
const safeProperties = new Set([
  "color",
  "background-color",
  "border-color",
  "border-top-color",
  "border-bottom-color",
  "border-left-color",
  "border-right-color",
  "border-style",
  "border-radius",
  "box-shadow",
  "text-decoration-color",
  "text-decoration-thickness",
  "text-underline-offset",
  "font-family",
  "font-weight",
]);
/** Build-time guardrails, not a sandbox. Pack authors remain trusted developers. */
export function validateThemePackCss(css: string, id: string): string[] {
  const errors: string[] = [];
  if (css.length > 50000) errors.push("Keep a theme stylesheet below 50 KB.");
  let root;
  try {
    root = postcss.parse(css);
  } catch (error) {
    return [(error as Error).message];
  }
  root.walkAtRules((rule) => {
    errors.push(
      `@${rule.name} is not supported in a theme pack. Shared assets and accessibility rules belong to the application.`,
    );
  });
  root.walkRules((rule) => {
    try {
      selectorParser((selectors) =>
        selectors.each((selector) => {
          const first = selector.nodes.find((node) => node.type !== "comment");
          if (
            first?.type !== "attribute" ||
            first.attribute !== "data-theme-pack" ||
            first.operator !== "=" ||
            first.value !== id
          )
            errors.push(`Unscoped selector: ${selector.toString()}`);
          selector.walk((node) => {
            if (
              node.type === "combinator" &&
              ["+", "~"].includes(node.value.trim())
            )
              errors.push(
                `Sibling selectors can escape the pack boundary: ${selector.toString()}`,
              );
            if (
              node.type === "nesting" ||
              (node.type === "pseudo" &&
                [":has", ":global", ":host", ":root"].includes(node.value))
            )
              errors.push(`Unsupported selector: ${selector.toString()}`);
            if (
              node.type === "tag" &&
              ["html", "body", "script", "iframe"].includes(node.value)
            )
              errors.push(
                `Do not style document or security boundaries: ${node.value}`,
              );
          });
        }),
      ).processSync(rule.selector);
    } catch {
      errors.push(`Invalid selector: ${rule.selector}`);
    }
  });
  root.walkDecls((decl) => {
    if (!safeProperties.has(decl.prop))
      errors.push(
        `Property ${decl.prop} changes layout or behavior; use shared tokens/components instead.`,
      );
    if (decl.important)
      errors.push(
        "!important cannot override user or accessibility preferences.",
      );
    if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(decl.value))
      errors.push("Theme CSS cannot fetch URLs or execute expressions.");
    if (
      ["font-family", "font-weight", "box-shadow", "border-radius"].includes(
        decl.prop,
      ) &&
      !/^var\(--(?:font-(?:ui|prose|heading|code)|weight-(?:ui|prose|heading|code)|shadow|radius)\)$/.test(
        decl.value,
      )
    )
      errors.push(`${decl.prop} must use its user-controlled semantic token.`);
    if (decl.prop.endsWith("color") && !/^var\(--[a-z-]+\)$/.test(decl.value))
      errors.push(
        "Component colors must use semantic variables; put literal colors in the paired manifest palettes.",
      );
  });
  return [...new Set(errors)];
}
export function themePackContrast(pack: Pick<ThemePackManifest, "palettes">) {
  return (["light", "dark"] as const).flatMap((mode) => {
    const p = pack.palettes[mode];
    return (
      [
        ["Body / paper", p.text, p.paper, 4.5],
        ["Secondary / paper", p.muted, p.paper, 4.5],
        ["Interface / sidebar", p.text, p.sidebar, 4.5],
        ["Secondary / surface", p.muted, p.surface, 4.5],
        ["Links / paper", p.accent, p.paper, 4.5],
        ["Button label", p.onAccent, p.accent, 4.5],
        ["Code", p.codeText, p.code, 4.5],
        ["Focus / surface", p.focus, p.surface, 3],
      ] as const
    ).map(([label, foreground, background, minimum]) => ({
      mode,
      label,
      ratio: contrastRatio(foreground, background),
      minimum,
    }));
  });
}
