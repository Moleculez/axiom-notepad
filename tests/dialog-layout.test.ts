import {
  Children,
  createElement as h,
  Fragment,
  isValidElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  DialogBody,
  DialogContent,
  DialogFooter,
} from "../apps/web/components/Dialog";

test("explicit bodies keep one scrollport with sibling footer", () => {
  const html = renderToStaticMarkup(
    h(
      DialogContent,
      null,
      h(
        Fragment,
        null,
        h(DialogBody, null, h("p", null, "Fields")),
        h(DialogFooter, null, h("button", null, "Save")),
      ),
    ),
  );
  expect(html).toBe(
    '<div class="dialog-body"><p>Fields</p></div><div class="dialog-footer"><button>Save</button></div>',
  );
});

test("legacy form actions stay submitted by the same form, outside its scrollport", () => {
  const html = renderToStaticMarkup(
    h(
      DialogContent,
      null,
      h(
        "form",
        { className: "legacy" },
        h("label", null, "Title", h("input", { name: "title" })),
        h(
          "div",
          { className: "dialog-actions" },
          h("button", { type: "submit" }, "Create"),
        ),
      ),
    ),
  );
  expect(html).toContain(
    '<form class="legacy dialog-form"><div class="dialog-body">',
  );
  expect(html).toContain(
    '</div><div class="dialog-footer"><button type="submit">Create</button></div></form>',
  );
});

function regions(children: ReactNode) {
  const result = DialogContent({ children });
  const siblings = Children.toArray(result.props.children).filter(
    isValidElement<{ children?: ReactNode }>,
  );
  const body = siblings.find((node) => node.type === DialogBody);
  return {
    body: Children.toArray(body?.props.children).filter(
      isValidElement<{ "data-field"?: string }>,
    ),
    footer: siblings.filter((node) => node.type === DialogFooter),
  };
}

test("a loaded sharing fragment cannot reuse a sibling's generated key", () => {
  const content = (loaded: boolean) =>
    regions([
      h("p", null, "Error notice"),
      loaded
        ? h(
            Fragment,
            null,
            h("section", null, "File access"),
            h("section", null, "People with access"),
            h("section", null, "File link"),
          )
        : h("p", null, "Checking access"),
      h(DialogFooter, null, h("button", null, "Done")),
    ]);
  for (const loaded of [false, true]) {
    const { body, footer } = content(loaded);
    expect(body).toHaveLength(loaded ? 4 : 2);
    expect(new Set(body.map((node) => node.key)).size).toBe(body.length);
    expect(footer).toHaveLength(1);
  }
});

test("fragment, body and footer groups preserve separate scopes for reused local keys", () => {
  const content = regions([
    h(Fragment, { key: "first" }, h("input", { key: "field" })),
    h(Fragment, { key: "second" }, h("input", { key: "field" })),
    h(DialogBody, { key: "third", children: h("input", { key: "field" }) }),
    h(DialogBody, { key: "fourth", children: h("input", { key: "field" }) }),
    h(
      Fragment,
      { key: "primary" },
      h(DialogFooter, { key: "actions", children: "Save" }),
    ),
    h(
      Fragment,
      { key: "secondary" },
      h(DialogFooter, { key: "actions", children: "Cancel" }),
    ),
  ]);
  expect(content.body).toHaveLength(4);
  expect(new Set(content.body.map((node) => node.key)).size).toBe(4);
  expect(new Set(content.footer.map((node) => node.key)).size).toBe(2);
});

test("keyed fields keep their identities when nested groups reorder", () => {
  const ids = ["first", "second", "a/b", "a:b", "a=b", "a//b", ".0"];
  const fields = (order: string[]) =>
    new Map(
      regions(
        order.map((id) =>
          h(
            Fragment,
            { key: id },
            h(
              DialogBody,
              null,
              h(Fragment, null, h("input", { key: "field", "data-field": id })),
            ),
          ),
        ),
      ).body.map((node) => [node.props["data-field"], node.key]),
    );
  const before = fields(ids),
    after = fields(["inserted", ...[...ids].reverse()]);
  expect(new Set(before.values()).size).toBe(ids.length);
  for (const id of ids) expect(after.get(id)).toBe(before.get(id));
});
