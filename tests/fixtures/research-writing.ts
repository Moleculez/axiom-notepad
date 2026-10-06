import type { LatexReference } from "../../packages/shared/src/latex-export";
export const researchWritingSource = `# Reproducible research

A **precise** result with *explicit assumptions*, a citation [@einstein1905], and an observation[^checked]. 中文研究笔记.

## Conservation

$$
\\newcommand{\\RR}{\\mathbb{R}}
$$

A scalar $x \\in \\RR$.

$$
E = mc^2 \\label{energy}
$$

The measured energy agrees with \\eqref{energy}. Inline $\\alpha + \\beta = \\gamma$ is selectable.

| Quantity | Estimate |
| :--- | ---: |
| Energy | $E$ |
| Mass | $m$ |

- [x] Check units
- [ ] Replicate experiment
  - Control environmental conditions
    1. Measure temperature
    2. Record uncertainty

> A research note with a nested observation.
>
> > Independently verified.

> [!NOTE] Assumptions
> Keep the derivation explicit.

\`\`\`python
energy = mass * c**2
print(energy)
\`\`\`

---

[^checked]: An independently checked observation with $\\sigma$ uncertainty.

    $$
    \\sigma^2 = \\sum_i (x_i-\\mu)^2
    $$
`;
export const researchWritingReferences: LatexReference[] = [{
  cite_key: "einstein1905", canonical_key: "einstein1905", identity: "11111111-1111-4111-8111-111111111111", version: 1,
  title: "Energy & mass", authors: "Albert Einstein", year: "1905", url: "https://example.org/energy_mass",
  bibtex: "@string{journal = {Annalen der Physik}}\n@article(einstein1905, title={Energy & mass}, author={Einstein, Albert}, year={1905}, journal=journal, volume={18}, pages={639--641})",
}];
