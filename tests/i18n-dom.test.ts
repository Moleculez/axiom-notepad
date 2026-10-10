import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localeRuntime } from "../packages/i18n/src/client";
import { readFile } from "node:fs/promises";
import { foldDescription } from "../packages/editor/src/folding";
import { parseMarkdown } from "../packages/markdown/src/index";
import {
  bindFoldAction,
  bindFoldCaption,
} from "../apps/web/lib/editor-vnext/fold-presentation";
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
  it("repaints metadata labels in place without translating property keys or values", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json(
        JSON.parse(
          await readFile("packages/i18n/src/messages/de.json", "utf8"),
        ),
      ),
    );
    const control = element();
    control.textContent = "literal content";
    const name = "Settings {draft}";
    bindAttribute(control, "aria-label", "Value for {name}", { name });
    await localeRuntime.choose("de");
    expect(control.getAttribute("aria-label")).toBe(
      "Wert für Settings {draft}",
    );
    expect(control.textContent).toBe("literal content");
    bindAttribute(control, "aria-label", "Value for {name}", {
      name: "新しいキー",
    });
    await localeRuntime.choose("en");
    expect(control.getAttribute("aria-label")).toBe("Value for 新しいキー");
  });
  it("resolves nested fold labels in the new locale on every repaint", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      Response.json(
        JSON.parse(
          await readFile(
            `packages/i18n/src/messages/${url.includes("de.json") ? "de" : "ja"}.json`,
            "utf8",
          ),
        ),
      ),
    );
    const source = "```Python\n# authored Summary\nvalue = 1\n```";
    const node = parseMarkdown(source).ast.children![0];
    const description = foldDescription(source, node);
    const caption = element(),
      button = element() as HTMLButtonElement;
    bindFoldCaption(caption, description);
    bindFoldAction(button, description, true);
    await localeRuntime.choose("de");
    expect(caption.textContent).toBe("Python-Code");
    expect(button.getAttribute("aria-label")).toBe(
      "Python-Code einklappen: # authored Summary",
    );
    await localeRuntime.choose("ja");
    expect(caption.textContent).toBe("Python のコード");
    expect(button.getAttribute("aria-label")).toBe(
      "Python のコードを折りたたむ：# authored Summary",
    );
    expect(source).toBe("```Python\n# authored Summary\nvalue = 1\n```");
    expect(boundMessage(button, "aria-label")).toBe(
      "Collapse {label}: {summary}",
    );
  });
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
