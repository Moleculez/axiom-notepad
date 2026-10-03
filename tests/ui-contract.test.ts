import { describe, expect, it } from "vitest";
import {
  nativeControlOwner,
  validateUiSource,
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
