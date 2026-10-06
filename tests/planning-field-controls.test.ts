import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskFieldInput } from "../apps/web/components/workspace/PlanningCustomFields";
import {
  PersonPicker,
  PlanningEntityPicker,
} from "../apps/web/components/workspace/PlanningFields";
import { Field } from "../apps/web/components/ui/controls";
import type { TaskField } from "../packages/shared/src/planning-lab";
const field: TaskField = {
  id: "00000000-0000-4000-8000-000000000001",
  space_id: "00000000-0000-4000-8000-000000000002",
  name: "Mass",
  kind: "number",
  unit: "mg",
  version: 1,
  options: [],
  archived: false,
  position: 0,
};
describe("native planning-field markup (not browser layout acceptance)", () => {
  it("retains partial numeric drafts, units, associated errors and non-submit clear controls", () => {
    const html = renderToStaticMarkup(
      h(TaskFieldInput, { field, value: "-0.", onChange: () => {} }),
    );
    expect(html).toContain('value="-0."');
    expect(html).toContain("Unit: mg");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-label="Clear Mass"');
    expect(html).toContain('type="button"');
    expect(html).not.toContain("data-editor-field");
  });
  it("distinguishes false from Not set while retaining native checkbox semantics", () => {
    const checkbox = {
      ...field,
      name: "Replicated",
      kind: "checkbox" as const,
    };
    const empty = renderToStaticMarkup(
      h(TaskFieldInput, { field: checkbox, value: null, onChange: () => {} }),
    );
    const no = renderToStaticMarkup(
      h(TaskFieldInput, { field: checkbox, value: false, onChange: () => {} }),
    );
    expect(empty).toContain("Not set");
    expect(no).toContain(">No</small>");
    expect(no).toContain('type="checkbox"');
    expect(no).not.toContain('checked=""');
    expect(empty).toContain('disabled=""');
    expect(no).not.toContain('disabled=""');
  });
  it("forwards the native label, descriptions and invalid state through person and entity pickers", () => {
    for (const picker of [
      h(PersonPicker, {
        people: [{ id: "owner", name: "Researcher" }],
        value: "owner",
        label: "Reviewer",
        onChange: () => {},
      }),
      h(PlanningEntityPicker, {
        spaceId: field.space_id,
        kind: "task",
        value: "",
        label: "Task",
        onChange: () => {},
      }),
    ]) {
      const html = renderToStaticMarkup(
        h(Field, {
          id: "property",
          label: "Property",
          error: "Choose a current workspace value",
          children: picker,
        }),
      );
      expect(html).toContain('for="property"');
      expect(html).toMatch(
        /<input[^>]*id="property"[^>]*aria-describedby="property-error"/,
      );
      expect(html).toContain('aria-invalid="true"');
    }
  });
});
