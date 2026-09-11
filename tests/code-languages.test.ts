import { expect, test } from "vitest";
import {
  codeFenceQuery,
  codeLanguages,
  codeLanguageSuggestions,
  codeLanguageSyntax,
} from "../packages/editor/src/code-languages";

test("the installed catalog has unique safe info strings and research-first defaults", () => {
  expect(codeLanguages.length).toBeGreaterThan(100);
  expect(new Set(codeLanguages.map((l) => l.value)).size).toBe(
    codeLanguages.length,
  );
  expect(new Set(codeLanguages.map((l) => l.label)).size).toBe(
    codeLanguages.length,
  );
  for (const language of codeLanguages)
    expect(language.value).toMatch(/^[\w+#.-]{1,40}$/);
  expect(
    codeLanguageSuggestions("")
      .slice(0, 5)
      .map((l) => l.value),
  ).toEqual(["python", "julia", "r", "matlab", "latex"]);
  expect(codeLanguageSuggestions("", "julia")[0].value).toBe("julia");
  expect(codeLanguageSuggestions("", "py")[0].value).toBe("python");
  expect(codeLanguageSuggestions("custom-not-installed")).toEqual([]);
});

test.each([
  ["PY", "python", "python"],
  ["jl", "julia", "julia"],
  ["r", "r", "r"],
  ["c++", "cpp", "cpp"],
  ["ts", "typescript", "typescript"],
  ["sh", "bash", "shell"],
  ["wolfram", "mathematica", "mathematica"],
  ["matlab", "matlab", "octave"],
  ["tex", "latex", "latex"],
  ["plaintext", "text", "text"],
  ["diagram", "mermaid", "mermaid"],
])(
  "%s matches a canonical fence token without importing its grammar",
  (query, value, syntax) => {
    expect(codeLanguageSuggestions(query)[0].value).toBe(value);
    expect(codeLanguageSyntax(query)).toBe(syntax);
  },
);

test.each([
  "```",
  "~~~",
  "````",
  "> ```",
  "> > ```",
  "- ```",
  "> - ```",
  "- > ```",
])("suggestions map only the info string for %s", (prefix) => {
  for (const ending of ["\n", "\r\n"]) {
    const source = "Before" + ending.repeat(2) + prefix + "python";
    const from = source.length - 6;
    expect(codeFenceQuery(source, from + 2)).toMatchObject({
      from,
      to: source.length,
      query: "py",
    });
    expect(codeFenceQuery(source, from - 1)).toBeNull();
    expect(codeFenceQuery(source.slice(0, from), from)?.query).toBe("");
  }
});

test.each([
  "`py",
  "``py",
  "before ```py",
  "\\```py",
  "```python extra",
  "$$\n```py\n$$",
  "---\ntitle: Example\n```py\n---",
  "    ```py",
  "````python\n```py\n````",
  "```py\nx = 1\n```",
  "> ```py\n> x\n> ```",
])(
  "ordinary content and closing fences never offer a language: %s",
  (source) => {
    const at =
      source.includes("```py\n") &&
      !source.startsWith("```py") &&
      !source.startsWith("> ```py")
        ? source.lastIndexOf("```py") + 5
        : source.length;
    expect(codeFenceQuery(source, at)).toBeNull();
  },
);

test("existing closed headers and spacing remain source-exact", () => {
  const source = "> ```  python\r\n> x\r\n> ```";
  expect(codeFenceQuery(source, 9)).toEqual({
    from: 7,
    to: 13,
    query: "py",
    header: 0,
  });
  expect(codeLanguageSyntax("my-custom-language")).toBe("my-custom-language");
});
