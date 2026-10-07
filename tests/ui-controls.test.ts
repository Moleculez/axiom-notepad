import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ActionRow,
  Button,
  Checkbox,
  Field,
  InputGroup,
  HelpText,
  IconButton,
  Notice,
  Radio,
  Slider,
  Switch,
  TextInput,
  TextArea,
  NativeSelect,
  SearchField,
  Picker,
  sliderProgress,
} from "../apps/web/components/ui/controls";

describe("native-compatible controls", () => {
  it("keeps checkbox labels outside void inputs and rejects content props at compile time", () => {
    // These elements are never rendered. Typecheck must reject void-input content.
    // @ts-expect-error Native checkbox inputs cannot contain children.
    const invalidCheckbox = h(Checkbox, { children: "My requests" });
    // @ts-expect-error Native switches cannot contain children.
    const invalidSwitch = h(Switch, { children: "Enable" });
    const invalidRadio = h(Radio, {
      // @ts-expect-error Native radios cannot contain HTML content.
      dangerouslySetInnerHTML: { __html: "Label" },
    });
    expect([
      invalidCheckbox.type,
      invalidSwitch.type,
      invalidRadio.type,
    ]).toEqual([Checkbox, Switch, Radio]);
    const html = renderToStaticMarkup(
      h("label", null, h(Checkbox, { defaultChecked: true }), "My requests"),
    );
    expect(html).toMatch(
      /<label><input[^>]*type="checkbox"[^>]*\/>My requests<\/label>/,
    );
  });
  it("keeps native application fields and form values without touching editor opt-outs", () => {
    const html = renderToStaticMarkup(
      h(
        "form",
        { id: "profile" },
        h(TextInput, {
          name: "title",
          required: true,
          maxLength: 80,
          defaultValue: "Physics",
          autoComplete: "organization",
        }),
        h(TextArea, { name: "context", rows: 4, defaultValue: "Evidence" }),
        h(
          NativeSelect,
          { name: "scope", defaultValue: "private" },
          h("option", { value: "private" }, "Private"),
        ),
        h(SearchField, {
          "aria-label": "Search members",
          name: "query",
          defaultValue: "Ada",
        }),
        h(TextInput, {
          ...{ "data-editor-field": "true" },
          defaultValue: "Canonical source",
        }),
        h(Picker, {
          label: "Owner",
          name: "owner",
          value: "ada",
          onChange: () => {},
          required: true,
          options: [{ value: "ada", label: "Ada Lovelace" }],
        }),
      ),
    );
    expect(html).toContain('name="title"');
    expect(html).toContain('autoComplete="organization"');
    expect(html).toContain('required=""');
    expect(html).toContain('rows="4"');
    expect(html).toContain('type="search"');
    expect(html).toContain('data-editor-field="true"');
    expect(html).toContain('type="hidden" name="owner" value="ada"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('value="Ada Lovelace"');
  });
  it("preserves radio group names, values and native checked state", () => {
    const html = renderToStaticMarkup(
      h(Radio, { name: "layout", value: "compact", defaultChecked: true }),
    );
    expect(html).toContain('name="layout"');
    expect(html).toContain('value="compact"');
    expect(html).toContain('type="radio"');
    expect(html).toContain('checked=""');
    expect(html).toContain('class="ui-checkbox ui-radio"');
  });
  it("preserves implicit and explicit form submit semantics, handlers, names and values", () => {
    const html = renderToStaticMarkup(
      h(
        "form",
        null,
        h(Button, { name: "operation", value: "save" }, "Save"),
        h(Button, { type: "button" }, "Cancel"),
        h(Button, { type: "submit", form: "another-form" }, "Submit"),
      ),
    );
    expect(html).toContain('name="operation"');
    expect(html).toContain('value="save"');
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    expect(html).toContain('form="another-form"');
  });
  it("keeps a stable pending label and reserves the same class/geometry in either state", () => {
    const idle = renderToStaticMarkup(
        h(
          Button,
          { pending: false, variant: "primary", className: "button primary" },
          "Save changes",
        ),
      ),
      busy = renderToStaticMarkup(
        h(
          Button,
          { pending: true, variant: "primary", className: "button primary" },
          "Save changes",
        ),
      );
    expect(idle).toContain('class="button ui-button primary"');
    expect(busy).toContain('class="button ui-button primary"');
    expect(idle).toContain('data-pending="false"');
    expect(busy).toContain('aria-busy="true" disabled=""');
    expect(busy).toContain(">Save changes</button>");
  });
  it("retains real checkbox/switch inputs for labeling, keyboard and form serialization", () => {
    const html = renderToStaticMarkup(
      h(
        "div",
        null,
        h(Checkbox, {
          name: "choices",
          defaultChecked: true,
          value: "a",
          indeterminate: true,
        }),
        h(Switch, { name: "enabled", defaultChecked: true }),
        h(IconButton, { label: "Close dialog", type: "button" }),
      ),
    );
    expect(html).toContain(
      'type="checkbox" class="ui-checkbox" aria-checked="mixed"',
    );
    expect(html).toContain('role="switch" class="ui-switch"');
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Close dialog" title="Close dialog"');
  });
  it("clamps filled tracks for negative, fractional, missing and invalid ranges", () => {
    expect(sliderProgress(-0.01, -0.02, 0.14)).toBeCloseTo(6.25);
    expect(sliderProgress(1.5, 0.8, 1.5)).toBe(100);
    expect(sliderProgress(-5)).toBe(0);
    expect(sliderProgress(200)).toBe(100);
    expect(sliderProgress(undefined, 50, 150)).toBe(50);
    expect(sliderProgress("bad", 50, 150)).toBe(0);
    expect(sliderProgress(1, 1, 1)).toBe(0);
    const html = renderToStaticMarkup(
      h(Slider, { min: -1, max: 1, step: 0.1, defaultValue: 0 }),
    );
    expect(html).toContain("--slider-progress:50%");
    expect(html).toContain('type="range"');
  });
  it("associates guidance and errors without discarding existing ARIA descriptions", () => {
    const html = renderToStaticMarkup(
      h(Field, {
        id: "sample",
        label: "Name",
        hint: "A clear title",
        error: "Required",
        children: h("input", { "aria-describedby": "external", name: "name" }),
      }),
    );
    expect(html).toContain(
      '<label for="sample"><span class="ui-field-label-text">Name</span></label>',
    );
    expect(html).toContain(
      'aria-describedby="external sample-hint sample-error"',
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="sample-error" role="alert"');
  });
  it("associates icon fields with their native control, not an outer box", () => {
    const html = renderToStaticMarkup(
      h(Field, {
        id: "project-url",
        label: "Project website",
        icon: h("svg", { "data-test": "label-icon" }),
        hint: "Keep the current draft",
        error: "Enter a URL",
        children: h(InputGroup, {
          leading: h("svg", { "data-test": "input-icon" }),
          children: h(TextInput, {
            type: "url",
            name: "url",
            "aria-describedby": "external",
          }),
        }),
      }),
    );
    expect(html).toContain('<label for="project-url">');
    expect(html).toContain('class="ui-field-label-icon" aria-hidden="true"');
    expect(html).toContain('class="ui-input-leading" aria-hidden="true"');
    expect(html).toContain('id="project-url"');
    expect(html).toContain(
      'aria-describedby="external project-url-hint project-url-error"',
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).not.toContain('<span id="project-url"');
    expect(html).toContain('class="ui-input ui-input-group-control"');
    expect(html).toContain('type="url"');
    expect(html).toContain('name="url"');
  });
  it("aligns a field action with the control while retaining its native label", () => {
    const html = renderToStaticMarkup(
      h(Field, {
        id: "mass",
        label: "A long wrapping property label",
        hint: "Unit: mg",
        action: h(IconButton, { type: "button", label: "Clear mass" }, "Clear"),
        children: h(TextInput, { name: "mass", defaultValue: "4" }),
      }),
    );
    expect(html).toContain('for="mass"');
    expect(html).toMatch(/<input[^>]*id="mass"/);
    expect(html).toContain('class="ui-field-control-row"');
    expect(html).toContain('aria-describedby="mass-hint"');
    expect(html).toContain('type="button"');
  });
  it("uses a single search surface and explicit non-submit clear action", () => {
    const html = renderToStaticMarkup(
      h(SearchField, {
        id: "search",
        wrapperClassName: "directory-search",
        name: "q",
        value: "Physics",
        onChange: () => {},
        onClear: () => {},
        clearLabel: "Clear workspace search",
        disabled: true,
      }),
    );
    expect(html).toContain(
      'class="ui-input-group ui-search-field directory-search"',
    );
    expect(html).toContain('aria-label="Clear workspace search"');
    expect(html).toContain('type="button"');
    expect(html).toContain('name="q"');
    expect(html).toContain('id="search"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).not.toContain("wrapperClassName=");
  });
  it("keeps ordinary hints unboxed and notices/actions semantically distinct", () => {
    const html = renderToStaticMarkup(
      h(
        ActionRow,
        { align: "end" },
        h(HelpText, null, "A routine hint"),
        h(Notice, { tone: "warning" }, "Cannot undo"),
      ),
    );
    expect(html).toContain('class="ws-actions ui-actions" data-align="end"');
    expect(html).toContain('<p class="ui-help">A routine hint</p>');
    expect(html).toContain('class="ui-notice" data-tone="warning"');
    expect(html).not.toContain('role="alert"');
  });
  it("opts mixed action groups into one size without changing unsized groups or native fields", () => {
    const ordinary = renderToStaticMarkup(
      h(ActionRow, null, h(IconButton, { label: "Standalone action" })),
    );
    expect(ordinary).not.toContain("data-control-group-size");
    for (const size of ["standard", "compact"] as const) {
      const html = renderToStaticMarkup(
        h(
          "form",
          { id: "research" },
          h(
            ActionRow,
            { size, align: "end", "aria-label": "Research actions" },
            h(TextInput, { name: "query", defaultValue: "equations" }),
            h(Button, { type: "submit", pending: false }, "Search"),
            h(IconButton, { type: "button", label: "Clear query" }),
          ),
        ),
      );
      expect(html).toContain(`data-control-group-size="${size}"`);
      expect(html).not.toContain(` size="${size}"`);
      expect(html).toContain('name="query"');
      expect(html).toContain('type="submit"');
      expect(html).toContain('data-pending="false"');
      expect(html).toContain('aria-label="Research actions"');
    }
  });
});
