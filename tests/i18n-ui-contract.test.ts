import { describe, expect, it } from "vitest";
import { validateI18nUiSource } from "../scripts/verify/i18n-ui-contract";

describe("literal UI message registry", () => {
  it("rejects silent English fallback in imported compatibility adapters", () => {
    const source = `
      import {uiText as text, I18nText as Copy} from '@axiom/i18n/react';
      import {bindAttribute as attribute} from '@axiom/i18n/dom';
      text('Unregistered status');
      text(active ? 'Save' : 'Another unregistered status');
      attribute(input, 'aria-label', 'Unregistered accessible name');
      const content = <Copy id="Unregistered visible message" />;
    `;
    expect(
      validateI18nUiSource("fixture.tsx", source).map((value) => value.message),
    ).toEqual([
      "Unregistered interface message: Unregistered status",
      "Unregistered interface message: Another unregistered status",
      "Unregistered interface message: Unregistered accessible name",
      "Unregistered interface message: Unregistered visible message",
    ]);
  });
  it("accepts registered messages, empty resets and dynamically typed registries", () => {
    expect(
      validateI18nUiSource(
        "fixture.tsx",
        `
      import {uiText} from '@axiom/i18n/react';
      import {bindAttribute, bindText} from '@axiom/i18n/dom';
      uiText('Save'); uiText(registry[status]);
      bindText(control, '');
      bindAttribute(input, 'aria-label', 'Value for {name}', {name: property.key});
      const content = <p>{source}</p>;
    `,
      ),
    ).toEqual([]);
  });
  it("ignores unrelated label functions and authored technical syntax", () => {
    expect(
      validateI18nUiSource(
        "fixture.ts",
        `
      import {label} from './source-model';
      label('Authored name');
      input.placeholder = 'paper';
      const source = '# A source document';
    `,
      ),
    ).toEqual([]);
  });
});
