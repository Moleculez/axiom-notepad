import { describe, expect, it } from "vitest";
import {
  nativeControlOwner,
  validateUiSource,
  validateUiStyles,
} from "../scripts/verify/ui-contract";

const file = "apps/web/components/Example.tsx";
describe("shared UI drift guard", () => {
  it("rejects raw native ranges/checkboxes, including expression branches", () => {
    const source = `<><input type="range"/><input type={'checkbox'}/><input type={mixed ? "checkbox" : "text"}/></>`;
    expect(validateUiSource(file, source)).toHaveLength(3);
  });
  it("rejects hint cards and raw action groups/buttons without matching unrelated names", () => {
    const source = `<><p className="ws-note">Help</p><label className={warning ? "ws-note" : "plain"}/><div className="ws-actions"/><button className="button primary"/><button className="icon-button"/><p className="ws-note-meta"/><HelpText className={error ? "form-error" : "ws-note"}/></>`;
    expect(validateUiSource(file, source)).toHaveLength(6);
  });
  it("allows shared text fields, editor opt-outs and the one native owner", () => {
    const source = `<><Slider/><Checkbox/><Switch/><HelpText/><Notice/><ActionRow><Button/><IconButton label="Close"/></ActionRow><TextInput type="number"/><input data-editor-field/><input type="file"/><button role="tab">Read</button></>`;
    expect(validateUiSource(file, source)).toEqual([]);
    expect(
      validateUiSource(nativeControlOwner, '<input type="checkbox"/>'),
    ).toEqual([]);
    expect(
      validateUiSource(
        "apps/web/components/ui/Another.tsx",
        '<input type="checkbox"/>',
      ),
    ).toHaveLength(1);
  });
  it("rejects raw application fields but preserves editor source fields", () => {
    expect(
      validateUiSource(
        file,
        '<><input/><textarea/><select/><input type="email"/><input data-editor-field/><textarea data-editor-field/></>',
      ),
    ).toHaveLength(4);
  });
  it("does not inspect comments or string examples; preserves useful line numbers", () => {
    expect(
      validateUiSource(
        file,
        '// <input type="range"/>\nconst example = "ws-note";',
      ),
    ).toEqual([]);
    expect(
      validateUiSource(file, '\nconst content = <input type="range"/>;')[0],
    ).toMatchObject({ file, line: 2 });
  });
  it("does not let a preference impersonate a selection checkbox", () => {
    expect(validateUiSource(file, '<Checkbox role="switch"/>')).toHaveLength(1);
  });
  it("rejects ad-hoc adjacent icon fields, including aliased icons", () => {
    expect(
      validateUiSource(
        file,
        'import { Search as Find } from "lucide-react"; const ui = <label><Find/><TextInput /></label>;',
      ),
    ).toHaveLength(1);
    expect(
      validateUiSource(
        file,
        'import { Search } from "lucide-react"; const ui = <div><Search/><SearchField /></div>;',
      ),
    ).toHaveLength(1);
    expect(
      validateUiSource(
        file,
        'import { Globe2 } from "lucide-react"; const ui = <Field icon={<Globe2/>} label="Website"><InputGroup leading={<Globe2/>}><TextInput /></InputGroup></Field>;',
      ),
    ).toEqual([]);
    expect(
      validateUiSource(
        file,
        'import { Globe2 } from "lucide-react"; const ui = <div><Globe2/><TextInput data-editor-field /></div>;',
      ),
    ).toEqual([]);
  });
});

describe("shared control cascade guard", () => {
  const file = "apps/web/app/example.css";
  it("rejects general button drawing and aggregated page resets", () => {
    const errors = validateUiStyles(
      file,
      `.button { min-height: 38px; font-size: 0.8em; }
      .ws-app :is(.settings-stage, .productivity-page) .button { line-height: 1.25; }
      .ws-app button { padding: 5px; }`,
    );
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatchObject({ file, line: 1 });
  });
  it("rejects fixed page action text while allowing scoped layout and functional focus", () => {
    expect(
      validateUiStyles(
        file,
        `.library-filters .button { font-size: 11px; }
      .library-filters { display:flex; gap:8px; }
      .library-filters > .button { flex: none; white-space: nowrap; }
      .ws-app .ws-page-tabs a:focus-visible { outline:2px solid var(--focus); outline-offset:-2px; box-shadow:none; }
      .button:focus-visible { box-shadow:none; }`,
      ),
    ).toHaveLength(1);
  });
  it("keeps explicit owners, specialized tabs/editor fields and the legacy layer separate", () => {
    expect(
      validateUiStyles(
        "apps/web/app/ui-controls.css",
        ".button { min-height:36px; }",
      ),
    ).toEqual([]);
    expect(
      validateUiStyles(
        "apps/web/app/interface-styles.css",
        ".button.secondary { border-radius:var(--radius); }",
      ),
    ).toEqual([]);
    expect(
      validateUiStyles(
        file,
        `@layer legacy { .button { padding:4px; } }
      .tab-strip button[role="tab"] { padding:8px; font-size:var(--size-ui-small); }
      input[data-editor-field] { background:transparent; }
      .button > svg { display:block; }
      /* .button { font-size:11px; } */`,
      ),
    ).toEqual([]);
  });
  it("does not accept an invalid CSS/selector as an audited stylesheet", () => {
    expect(validateUiStyles(file, ".button { ")).toHaveLength(1);
  });
});
