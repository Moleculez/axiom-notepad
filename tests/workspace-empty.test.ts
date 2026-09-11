import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Empty } from "../apps/web/components/workspace/ui";

describe("workspace empty-state content", () => {
  it("accepts a paragraph without nesting it in another paragraph", () => {
    const html = renderToStaticMarkup(
      createElement(Empty, {
        title: "No matching members",
        children: createElement(
          "p",
          null,
          "Try another filter or clear the search.",
        ),
      }),
    );
    expect(html).toContain(
      '<div class="ws-empty-description"><p>Try another filter or clear the search.</p></div>',
    );
  });

  it("keeps plain text and inline links in the same description wrapper", () => {
    const html = renderToStaticMarkup(
      createElement(Empty, {
        title: "Nothing here yet",
        children: createElement(
          Fragment,
          null,
          "Try ",
          createElement("a", { href: "/workbench/explorer" }, "Explorer"),
          ".",
        ),
      }),
    );
    expect(html).toContain(
      '<div class="ws-empty-description">Try <a href="/workbench/explorer">Explorer</a>.</div>',
    );
  });

  it("allows block content and keeps actions outside the description", () => {
    const html = renderToStaticMarkup(
      createElement(Empty, {
        title: "Next steps",
        children: createElement(
          "ul",
          null,
          createElement("li", null, "Clear the search"),
        ),
        action: createElement("button", { type: "button" }, "Clear"),
      }),
    );
    expect(html).toContain(
      '<div class="ws-empty-description"><ul><li>Clear the search</li></ul></div><button type="button">Clear</button>',
    );
  });
});
