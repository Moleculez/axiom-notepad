export const mathTemplates = [
  {
    name: "Quadratic formula",
    category: "Algebra",
    description: "Roots of a second-degree polynomial.",
    tex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
  },
  {
    name: "Aligned derivation",
    category: "Structure",
    description: "Keep each step aligned at the equals sign.",
    tex: "\\begin{aligned}\nf(x) &= x^2 + 2x + 1 \\\\\n     &= (x + 1)^2\n\\end{aligned}",
  },
  {
    name: "Matrix",
    category: "Linear algebra",
    description: "A two-by-two matrix with parentheses.",
    tex: "\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}",
  },
  {
    name: "Schrödinger equation",
    category: "Physics",
    description: "Time evolution of a quantum state.",
    tex: "i\\hbar \\frac{\\partial}{\\partial t} \\Psi = \\hat{H}\\Psi",
  },
  {
    name: "Bayes' theorem",
    category: "Probability",
    description: "Update a prior using observed evidence.",
    tex: "P(A \\mid B) = \\frac{P(B \\mid A) P(A)}{P(B)}",
  },
  {
    name: "Chemical reaction",
    category: "Chemistry",
    description: "Balanced reaction with mhchem notation.",
    tex: "\\ce{2 H2 + O2 -> 2 H2O}",
  },
  {
    name: "Loss function",
    category: "Machine learning",
    description: "Mean negative log-likelihood over a dataset.",
    tex: "\\mathcal{L}(\\theta) = -\\frac{1}{N}\\sum_{i=1}^{N} y_i \\log p_\\theta(y_i \\mid x_i)",
  },
  {
    name: "Gaussian density",
    category: "Probability",
    description: "A normal distribution with mean and variance.",
    tex: "p(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}}\\exp\\!\\left(-\\frac{(x-\\mu)^2}{2\\sigma^2}\\right)",
  },
  {
    name: "Gradient descent",
    category: "Machine learning",
    description: "A parameter update with learning rate η.",
    tex: "\\theta_{t+1} = \\theta_t - \\eta \\nabla_{\\theta}\\mathcal{L}(\\theta_t)",
  },
  {
    name: "Piecewise function",
    category: "Structure",
    description: "Different expressions for different conditions.",
    tex: "f(x) = \\begin{cases}\nx^2 & x \\geq 0 \\\\\n-x & x < 0\n\\end{cases}",
  },
] as const;

export function matchesMathLibrary(query: string, ...values: string[]) {
  const normalize = (text: string) =>
    text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/\\/g, "")
      .toLowerCase();
  const haystack = normalize(values.join(" "));
  return normalize(query)
    .trim()
    .split(/\s+/)
    .every((term) => haystack.includes(term));
}
