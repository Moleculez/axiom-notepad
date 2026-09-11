/** One presentation/insertion catalog for the editor and Math Studio. */
export type MathSymbol = {
  id: string;
  category: string;
  title: string;
  insert: string;
  preview: string;
  fields: string[];
};
const template = (
  id: string,
  category: string,
  title: string,
  insert: string,
  preview: string,
  fields: string[] = [],
): MathSymbol => ({ id, category, title, insert, preview, fields });
const symbols = (category: string, names: string) =>
  names
    .split(" ")
    .map((id) => template(id, category, id, "\\" + id, "\\" + id));
export const mathSymbols: readonly MathSymbol[] = [
  template(
    "frac",
    "Fractions & roots",
    "Fraction",
    "\\frac{numerator}{denominator}",
    "\\frac{a}{b}",
    ["numerator", "denominator"],
  ),
  template(
    "sqrt",
    "Fractions & roots",
    "Square root",
    "\\sqrt{expression}",
    "\\sqrt{x}",
    ["expression"],
  ),
  template("sum", "Calculus", "Summation", "\\sum_{i=1}^{n} term", "\\sum", [
    "i=1",
    "n",
    "term",
  ]),
  template("int", "Calculus", "Integral", "\\int_{a}^{b} f(x)\\,dx", "\\int", [
    "a",
    "b",
    "f(x)",
  ]),
  template(
    "matrix",
    "Matrices & environments",
    "Bracketed matrix",
    "\\begin{bmatrix}\na & b \\\\\nc & d\n\\end{bmatrix}",
    "\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}",
    ["a", "b", "c", "d"],
  ),
  template(
    "cases",
    "Matrices & environments",
    "Piecewise cases",
    "\\begin{cases}\nexpression & condition\n\\end{cases}",
    "\\begin{cases}x&x>0\\\\0&x\\leq0\\end{cases}",
    ["expression", "condition"],
  ),
  template(
    "aligned",
    "Matrices & environments",
    "Aligned equations",
    "\\begin{aligned}\na &= b\n\\end{aligned}",
    "\\begin{aligned}a&=b\\\\c&=d\\end{aligned}",
    ["a", "b"],
  ),
  template(
    "ce",
    "Physics & chemistry",
    "Chemical formula",
    "\\ce{H2O}",
    "\\ce{H2O}",
    ["H2O"],
  ),
  template(
    "pu",
    "Physics & chemistry",
    "Physical units",
    "\\pu{1 m s^-2}",
    "\\pu{m s^-2}",
    ["1 m s^-2"],
  ),
  ...symbols(
    "Greek",
    "alpha beta gamma delta epsilon theta lambda mu sigma omega nabla partial",
  ),
  ...symbols(
    "Relations & operators",
    "infty approx propto times cdot rightarrow Rightarrow",
  ),
  ...[
    "mathbb",
    "mathbf",
    "mathrm",
    "operatorname",
    "underbrace",
    "overbrace",
  ].map((id) =>
    template(
      id,
      "Typography",
      id,
      "\\" + id,
      "\\" + id + (id === "mathbb" ? "{R}" : "{x}"),
    ),
  ),
  ...symbols("Calculus", "lim log sin cos tanh"),
  ...symbols("Brackets", "langle rangle"),
  ...symbols(
    "Greek",
    "zeta eta iota kappa nu xi pi rho tau upsilon phi chi psi Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega varepsilon vartheta varpi varrho varsigma varphi",
  ),
  ...symbols(
    "Relations & operators",
    "pm mp div ast star circ bullet otimes oplus odot leq geq neq equiv sim simeq cong ll gg parallel perp mid nmid",
  ),
  ...symbols(
    "Sets & logic",
    "in notin ni subset supset subseteq supseteq cup cap bigcup bigcap emptyset forall exists nexists neg land lor setminus top bot therefore because",
  ),
  ...symbols(
    "Arrows",
    "leftarrow leftrightarrow Leftarrow Leftrightarrow longrightarrow longleftarrow mapsto longmapsto uparrow downarrow updownarrow hookrightarrow hookleftarrow",
  ),
  ...symbols(
    "Calculus",
    "prod coprod iint iiint oint oiint bigoplus bigotimes bigvee bigwedge min max inf sup det dim gcd tan cot sec csc sinh cosh exp ln",
  ),
  template(
    "dfrac",
    "Fractions & roots",
    "Display fraction",
    "\\dfrac{numerator}{denominator}",
    "\\dfrac{a}{b}",
    ["numerator", "denominator"],
  ),
  template(
    "binom",
    "Fractions & roots",
    "Binomial coefficient",
    "\\binom{n}{k}",
    "\\binom{n}{k}",
    ["n", "k"],
  ),
  template(
    "root",
    "Fractions & roots",
    "Indexed root",
    "\\sqrt[n]{expression}",
    "\\sqrt[n]{x}",
    ["n", "expression"],
  ),
  template(
    "pmatrix",
    "Matrices & environments",
    "Parenthesized matrix",
    "\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}",
    "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}",
    ["a", "b", "c", "d"],
  ),
  template(
    "vmatrix",
    "Matrices & environments",
    "Determinant",
    "\\begin{vmatrix}\na & b \\\\\nc & d\n\\end{vmatrix}",
    "\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}",
    ["a", "b", "c", "d"],
  ),
  template("vector", "Typography", "Vector", "\\vec{v}", "\\vec{v}", ["v"]),
  template("hat", "Typography", "Hat accent", "\\hat{x}", "\\hat{x}", ["x"]),
  template("bar", "Typography", "Bar accent", "\\bar{x}", "\\bar{x}", ["x"]),
  template("dot", "Typography", "Time derivative", "\\dot{x}", "\\dot{x}", [
    "x",
  ]),
  template(
    "ddot",
    "Typography",
    "Second time derivative",
    "\\ddot{x}",
    "\\ddot{x}",
    ["x"],
  ),
  ...symbols("Brackets", "lceil rceil lfloor rfloor lvert rvert lVert rVert"),
  template(
    "braket",
    "Physics & chemistry",
    "Inner product",
    "\\braket{a|b}",
    "\\braket{a|b}",
    ["a", "b"],
  ),
  template("ket", "Physics & chemistry", "Ket", "\\ket{psi}", "\\ket{\\psi}", [
    "psi",
  ]),
  template("bra", "Physics & chemistry", "Bra", "\\bra{psi}", "\\bra{\\psi}", [
    "psi",
  ]),
  template(
    "cancel",
    "Typography",
    "Cancellation",
    "\\cancel{x}",
    "\\cancel{x}",
    ["x"],
  ),
];
export const mathSymbolById = new Map(
  mathSymbols.map((symbol) => [symbol.id, symbol]),
);
export const mathCategories = [
  ...new Set(mathSymbols.map((symbol) => symbol.category)),
];
export function mathSymbolFields(symbol: MathSymbol): [number, number][] {
  let cursor = symbol.insert.startsWith("\\begin{")
    ? symbol.insert.indexOf("\n") + 1
    : symbol.insert.indexOf("{") + 1;
  const ranges: [number, number][] = [];
  for (const field of symbol.fields) {
    const at = symbol.insert.indexOf(field, cursor);
    if (at >= 0) {
      ranges.push([at, at + field.length]);
      cursor = at + field.length;
    }
  }
  return ranges;
}
