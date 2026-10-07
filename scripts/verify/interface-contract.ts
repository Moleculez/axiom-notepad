import {
  interfaceStyles,
  interfaceStyleIds,
  interfaceRecipeTokens,
  type InterfaceStyleDefinition,
} from "../../packages/shared/src/interface-styles";
import type { UiDiagnostic } from "./ui-contract";

/** Structural treatments, not font, palette, optional elevation or radius alone. */
const distinguishingRoles = [
  "--field-rule",
  "--field-focus-rule",
  "--field-adornment-edge",
  "--action-rule",
  "--ui-nav-rule",
  "--ui-nav-line",
  "--ui-panel-rule",
  "--ui-overlay-rule",
  "--slider-track-height",
  "--slider-thumb-width",
  "--slider-thumb-height",
  "--switch-knob-radius",
  "--ui-chrome-pattern",
] as const;
const fieldOrSelectionRoles = [
  "--field-rule",
  "--field-focus-rule",
  "--field-adornment-edge",
  "--ui-nav-rule",
  "--ui-nav-line",
] as const;

/** Run in validate:ui as well as unit tests, so incomplete profiles fail early. */
export function validateInterfaceRegistry(
  styles: readonly InterfaceStyleDefinition[] = interfaceStyles,
): UiDiagnostic[] {
  const errors: UiDiagnostic[] = [];
  const report = (message: string) =>
    errors.push({
      file: "packages/shared/src/interface-styles.ts",
      line: 1,
      message,
    });
  if (
    styles.length !== interfaceStyleIds.length ||
    interfaceStyleIds.some(
      (id) => styles.filter((s) => s.id === id).length !== 1,
    )
  )
    report("Every canonical interface identity requires exactly one recipe.");
  for (const style of styles) {
    const keys = Object.keys(style.recipe);
    if (
      keys.length !== interfaceRecipeTokens.length ||
      interfaceRecipeTokens.some((key) => !Object.hasOwn(style.recipe, key))
    )
      report(`${style.id}: recipe roles are incomplete or unregistered.`);
    if (new Set(style.signatures).size !== 3)
      report(`${style.id}: document three distinct structural signatures.`);
    for (const [key, value] of Object.entries(style.recipe)) {
      if (
        !value.trim() ||
        /url\s*\(|expression\s*\(|!important|https?:|#[0-9a-f]{3,8}\b/i.test(
          value,
        ) ||
        /^--(?:font-|size-|weight-|reading-|shadow$|radius$)/.test(key)
      )
        report(
          `${style.id}: ${key} must be safe and palette/font-independent.`,
        );
    }
  }
  for (const [index, style] of styles.entries())
    for (const other of styles.slice(index + 1))
      if (
        distinguishingRoles.filter(
          (role) => style.recipe[role] !== other.recipe[role],
        ).length < 3 ||
        !fieldOrSelectionRoles.some(
          (role) => style.recipe[role] !== other.recipe[role],
        )
      )
        report(
          `${style.id}/${other.id}: require three non-color structural differences, including fields or selection.`,
        );
  return errors;
}
