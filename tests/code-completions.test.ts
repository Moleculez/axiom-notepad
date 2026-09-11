import { expect, test } from "vitest";
import { codeCompletions } from "../packages/editor/src/code-completions";

test.each([
  ["py", "pri", "print"],
  ["jl", "pri", "println"],
  ["r", "sum", "summary"],
  ["matlab", "lin", "linspace"],
  ["c++", "const", "constexpr"],
  ["c", "mal", "malloc"],
  ["js", "fun", "function"],
  ["ts", "inter", "interface"],
  ["sql", "sel", "SELECT"],
  ["rust", "mat", "match"],
  ["bash", "pri", "printf"],
  ["tex", "\\sec", "\\section"],
])(
  "%s completes language-aware names without changing unrelated text",
  (language, query, label) => {
    const matches = codeCompletions(query, query.length, language);
    expect(matches.find((m) => m.label === label)).toMatchObject({
      from: 0,
      to: query.length,
      value: label,
    });
  },
);

test("nearest local identifiers, Unicode, token-tail replacement and unknown languages", () => {
  const body = "research_value = 1\nαβγ = 2\nresearch_value\nresZZ";
  const match = codeCompletions(body, body.length - 2, "custom")[0];
  expect(match).toMatchObject({
    label: "research_value",
    kind: "variable",
    from: body.length - 5,
    to: body.length,
  });
  expect(codeCompletions("αβγ = 1\nαβ", 10, "python")[0]?.value).toBe("αβγ");
  expect(codeCompletions("alone", 5, "custom")).toEqual([]);
});

test.each([
  ["python", "# pri"],
  ["python", "x = 'pri"],
  ["python", 'x = """multiline\npri'],
  ["julia", "#= multiline\n#= nested =#\npri"],
  ["r", "# sum"],
  ["matlab", "% lin"],
  ["js", "// fun"],
  ["js", "/* fun"],
  ["js", "const pattern = /pri"],
  ["js", "return /[a-z]pri"],
  ["js", "`template ${fun"],
  ["sql", "-- sel"],
  ["tex", "% \\sec"],
])("%s omits comments and literals", (language, text) => {
  expect(
    codeCompletions(text, text.length, language, { explicit: true }),
  ).toEqual([]);
});

test("string/comment names are not mined, and members are only names seen after a dot", () => {
  const source =
    'x = "research_secret"\n# research_comment\nresearch_value = 1\nres';
  expect(
    codeCompletions(source, source.length, "python").map((m) => m.value),
  ).toEqual(["research_value"]);
  const members = "obj.research_method()\nresearch_other = 1\nobj.res";
  expect(
    codeCompletions(members, members.length, "python").map((m) => m.value),
  ).toEqual(["research_method"]);
});

test("automatic suggestions need two characters; manual invocation works at an empty caret", () => {
  expect(codeCompletions("p", 1, "python")).toEqual([]);
  expect(
    codeCompletions("p", 1, "python", { explicit: true }).some(
      (m) => m.value === "print",
    ),
  ).toBe(true);
  expect(
    codeCompletions("", 0, "python", { explicit: true }).length,
  ).toBeGreaterThan(0);
  expect(
    codeCompletions("x".repeat(100_001), 0, "python", { explicit: true }),
  ).toEqual([]);
});

test.each([
  ["julia", "matrix'\npri", "println"],
  ["rust", "fn borrow<'a>() {}\nmat", "match"],
])(
  "%s postfix syntax does not hide later code suggestions",
  (language, text, expected) => {
    expect(
      codeCompletions(text, text.length, language).some(
        (m) => m.value === expected,
      ),
    ).toBe(true);
  },
);

test("snippets preserve surrounding indentation and expose source-relative fields including final caret", () => {
  const snippet = codeCompletions("  def", 5, "python", { indent: 2 }).find(
    (m) => m.kind === "snippet",
  )!;
  expect(snippet.value).toBe("def function_name(parameters):\n    pass");
  expect(snippet.fields!.map(([a, b]) => snippet.value.slice(a, b))).toEqual([
    "function_name",
    "parameters",
    "pass",
    "",
  ]);
  expect(snippet.select).toEqual(snippet.fields![0]);
  expect(
    codeCompletions("value = def", 11, "python").some(
      (m) => m.kind === "snippet",
    ),
  ).toBe(false);
});
