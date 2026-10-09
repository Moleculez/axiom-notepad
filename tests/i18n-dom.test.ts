import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeRuntime } from "../packages/i18n/src/client";
import {
  bindAttribute,
  bindText,
  boundMessage,
  unbindAttribute,
} from "../packages/i18n/src/dom";

class Control {
  textContent = "";
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}
const element = () => new Control() as unknown as HTMLElement;

beforeEach(async () => {
  vi.stubGlobal("document", {});
  vi.stubGlobal("Element", Control);
  vi.stubGlobal("fetch", async (url: string) =>
    Response.json({
      Cancel: url.includes("es.json") ? "Cancelar" : "Annuler",
      Save: url.includes("es.json") ? "Guardar" : "Enregistrer",
    }),
  );
  await localeRuntime.choose("en");
});
afterEach(async () => {
  await localeRuntime.choose("en");
  vi.unstubAllGlobals();
});

describe("source-independent imperative UI bindings", () => {
  it("updates an owned label in place and retains its stable English identity", async () => {
    const control = element(),
      source = element();
    source.textContent = "# Save\n\nCanonical Markdown";
    bindText(control, "Save");
    bindAttribute(control, "aria-label", "Save");
    await localeRuntime.choose("es");
    expect(control.textContent).toBe("Guardar");
    expect(control.getAttribute("aria-label")).toBe("Guardar");
    expect(boundMessage(control, null)).toBe("Save");
    expect(boundMessage(control, "aria-label")).toBe("Save");
    expect(source.textContent).toBe("# Save\n\nCanonical Markdown");
  });
  it("a removed conditional description cannot reappear on a language switch", async () => {
    const control = element();
    bindAttribute(control, "aria-description", "Cancel");
    await localeRuntime.choose("es");
    unbindAttribute(control, "aria-description");
    control.removeAttribute("aria-description");
    await localeRuntime.choose("fr");
    expect(boundMessage(control, "aria-description")).toBeUndefined();
    expect(control.hasAttribute("aria-description")).toBe(false);
    bindAttribute(control, "aria-description", "Save");
    expect(control.getAttribute("aria-description")).toBe("Enregistrer");
  });
});
