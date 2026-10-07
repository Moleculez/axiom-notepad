import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Plus, X } from "lucide-react";
import {
  ActionRow,
  Button,
  Field,
  IconButton,
  NativeSelect,
  Picker,
  SearchField,
  TextInput,
} from "../../apps/web/components/ui/controls";
import { ResearchFilterInput } from "../../apps/web/components/workspace/ResearchSearch";

// In-memory native fixtures consume the exact ordered application cascade.
// No account/API/data writes or invented page-specific control drawing.
// Bundled font URLs are exercised separately by the built showcase, not this
// about:blank layout fixture's fallback-font geometry gate.
const require = createRequire(import.meta.url);
const css = [
  ...readFileSync("apps/web/app/styles.ts", "utf8").matchAll(
    /import "([^\"]+\.css)"/g,
  ),
]
  .map((match) =>
    readFileSync(
      match[1].startsWith(".")
        ? resolve("apps/web/app", match[1])
        : require.resolve(match[1]),
      "utf8",
    ),
  )
  .join("\n")
  .replace(/^@import .+;$/gm, "");

function mixedRow(size: "standard" | "compact", name: string) {
  return h(
    ActionRow,
    { size, className: "fixture-toolbar", "aria-label": name },
    h(SearchField, {
      value: "equations",
      onChange: () => {},
      onClear: () => {},
      "aria-label": `${name} search`,
    }),
    h(
      NativeSelect,
      { "aria-label": `${name} status` },
      h("option", null, "All reading statuses"),
    ),
    h(
      Button,
      { type: "button", pending: false },
      h(Plus, { "aria-hidden": true }),
      "Apply filters",
    ),
    h(IconButton, { type: "button", label: `${name} clear` }, h(X)),
  );
}

const documentFieldProps = {
  className: "editor-property-input",
  "data-editor-field": "cell",
  "aria-label": "Document property",
  value: "transparent source",
  readOnly: true,
};

function planningSelect(label: string, choices: string[]) {
  return h(
    NativeSelect,
    { "aria-label": label },
    ...choices.map((choice) => h("option", { key: choice }, choice)),
  );
}

const html = renderToStaticMarkup(
  h(
    "main",
    {
      className: "ws-app",
      style: {
        height: "auto",
        minHeight: 0,
        overflow: "visible",
        padding: "16px",
      },
    },
    ...["settings-stage", "groups-hub", "productivity-page"].map((className) =>
      h(
        "section",
        { className, key: className },
        h("h3", null, className),
        mixedRow("standard", className),
      ),
    ),
    h(
      "section",
      null,
      h("h3", null, "Compact toolbar"),
      mixedRow("compact", "Compact actions"),
    ),
    h(
      "section",
      {
        className: "library-results",
        style: { width: "100%", paddingInline: 0 },
      },
      h("h3", null, "Reference filters"),
      h(
        ActionRow,
        {
          className: "library-filters",
          size: "standard",
          "aria-label": "Reference filters",
        },
        h(ResearchFilterInput, {
          className: "library-author-filter",
          label: "Author",
          placeholder: "Author",
          value: "Noether",
          onChange: () => {},
        }),
        h(ResearchFilterInput, {
          className: "library-year-filter",
          label: "Year",
          placeholder: "Year",
          value: "1918",
          onChange: () => {},
        }),
        h(
          NativeSelect,
          { "aria-label": "Reading status" },
          h("option", null, "All reading statuses"),
        ),
        h(Button, { type: "button", variant: "ghost" }, "Reset filters"),
      ),
      h(
        ActionRow,
        {
          className: "library-selection",
          size: "standard",
          "aria-label": "Selected references",
        },
        h("strong", null, "2 selected"),
        h(
          NativeSelect,
          { "aria-label": "Selected reading status" },
          h("option", null, "Reading status…"),
        ),
        h(
          IconButton,
          { type: "button", label: "Organize references" },
          h(Plus),
        ),
        h(
          "details",
          { className: "research-export-menu" },
          h(
            "summary",
            {
              className: "button ghost",
              "aria-label": "Export selected references",
            },
            "Export",
          ),
        ),
        h(IconButton, { type: "button", label: "Clear selection" }, h(X)),
      ),
    ),
    h(
      "section",
      null,
      h("h3", null, "Planning filters"),
      h(
        ActionRow,
        {
          className: "planning-filters",
          size: "standard",
          "aria-label": "Planning filter layout",
        },
        h(Button, { type: "button" }, "Properties"),
        h(SearchField, {
          wrapperClassName: "planning-search",
          "aria-label": "Fixture find tasks",
          placeholder: "Find tasks or labels…",
          value: "",
          onChange: () => {},
        }),
        planningSelect("Fixture task status", ["All statuses", "In progress"]),
        h(Picker, {
          label: "Fixture assignee",
          value: "",
          onChange: () => {},
          placeholder: "Search people…",
          options: [],
        }),
        planningSelect("Fixture task priority", ["All priorities", "Urgent"]),
        h(Picker, {
          label: "Fixture milestone",
          value: "",
          onChange: () => {},
          placeholder: "Search workspace milestones…",
          options: [],
        }),
        planningSelect("Fixture planning risk", [
          "All risks",
          "Upcoming · 7 days",
        ]),
        h(IconButton, { type: "button", label: "Fixture deleted tasks" }, h(X)),
        h("span", { className: "planning-count" }, "3 tasks · 0 done"),
      ),
    ),
    h(
      "section",
      null,
      h("h3", null, "Planning condition"),
      h(
        ActionRow,
        { className: "planning-rule-clause", size: "standard" },
        h(Field, {
          label: "A long condition label that wraps at a retained narrow width",
          action: h(
            IconButton,
            { type: "button", label: "Remove condition" },
            h(X),
          ),
          children: h(
            NativeSelect,
            { "aria-label": "Condition property" },
            h("option", null, "Status"),
          ),
        }),
        h(Field, {
          label: "Operator",
          children: h(
            NativeSelect,
            { "aria-label": "Operator" },
            h("option", null, "Equals"),
          ),
        }),
        h(Field, {
          label: "Value",
          hint: "A retained draft",
          children: h(TextInput, {
            "aria-label": "Condition value",
            value: "Todo",
            readOnly: true,
          }),
        }),
      ),
    ),
    h(
      "section",
      null,
      h("h3", null, "Nested size ownership"),
      h(
        ActionRow,
        { size: "standard" },
        h(IconButton, { label: "Sized parent action" }, h(Plus)),
        h(
          ActionRow,
          { "aria-label": "Unsized nested actions" },
          h(IconButton, { label: "Unsized nested action" }, h(X)),
        ),
      ),
    ),
    h(
      "nav",
      {
        className: "ws-page-tabs",
        "aria-label": "Scrolling page sections",
        style: { width: "min(100%, 460px)" },
      },
      ...[
        "Overview",
        "References",
        "Planning",
        "Settings",
        "Activity",
        "Storage",
      ].map((name) => h("a", { href: "#", key: name }, name)),
    ),
    h(
      "section",
      { className: "axiom-prose" },
      h("p", null, "The canonical document boundary remains unchanged."),
      h(TextInput, documentFieldProps),
    ),
  ),
);

export const actionRowFixture = { css, html };
