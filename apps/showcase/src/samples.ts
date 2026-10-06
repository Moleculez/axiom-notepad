import { defaults, type Preferences } from "@axiom/shared/appearance";
import type { CanvasData } from "@axiom/shared/canvas";

export const paperAppearance: Preferences = {
  ...defaults,
  themePack: "paper-research",
  proseFont: "latinModern",
  headingFont: "latinModern",
  uiFont: "inter",
  documentDecorations: "latex",
  proseSize: 18,
  lineHeight: 1.8,
};
export const researchId = "3f000000-0000-4000-8000-000000000001";
export const canvasId = "3f000000-0000-4000-8000-000000000002";
export const mindmapId = "3f000000-0000-4000-8000-000000000007";
export const mindmapSample = {
  id: mindmapId,
  title: "Research mind map",
  kind: "markdown" as const,
  view: "mindmap" as const,
  source: `# Research programme

## Question

- How does structure shape learning?
  - Hypothesis: **stable representations** transfer better
  - Evidence
    - Spectral measurements
    - Replication studies

## Methods

- [x] Literature review
- [ ] Reproduce the baseline
  - Record seeds and data versions
  - Compare $L = D - A$
- [ ] Evaluate robustness

$$
L u_k = \\lambda_k u_k
$$

## Discussion

> [!NOTE] Research diary
> Separate observations from interpretation.
> - Open questions
> - Competing explanations

## Next steps

- Write the protocol
- Collect evidence
- Draft the paper
`,
};
export const imageId = "3f000000-0000-4000-8000-000000000003";
export const imagePath = `assets/${imageId}/spectral-model.svg`;
export const figure = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360" viewBox="0 0 900 360"><rect width="900" height="360" fill="#f5f0e5"/><g stroke="#9ea59c" stroke-width="2"><path d="M135 180L285 90 435 180 285 275ZM435 180L595 90 755 180 595 275ZM285 90L595 90M285 275L595 275M135 180L755 180" fill="none"/></g><g fill="#447869">${[
  [135, 180],
  [285, 90],
  [435, 180],
  [285, 275],
  [595, 90],
  [755, 180],
  [595, 275],
]
  .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="12"/>`)
  .join(
    "",
  )}</g><text x="450" y="335" text-anchor="middle" fill="#61594d" font-family="Georgia,serif" font-size="18">Structure → representation → evidence</text></svg>`;

export const samples = [
  {
    id: researchId,
    title: "Spectral graph methods",
    kind: "markdown" as const,
    source: `---
title: Spectral graph methods
author: Spectral Lab
tags: [graphs, reproducibility]
---

# Spectral graph methods

A research notebook that keeps **mathematics**, observations and interpretation together. Try editing this document, or press **⌘ / · Ctrl /** to see its Markdown.

[TOC]

## A shared representation

Let the graph encode relationships between observations. We seek features that preserve local structure while remaining stable under perturbation.

$$
L_{\\mathrm{sym}} = I - D^{-1/2} A D^{-1/2}, \\qquad L u_k = \\lambda_k u_k.
$$

![A small graph model](${imagePath})

> [!note] Research question
> Which spectral features transfer when the graph changes?

## From theory to evidence

| Representation | Signal | Next step |
| :--- | :--- | :--- |
| Eigenvectors | Global geometry | Check stability |
| Diffusion coordinates | Local neighborhoods | Compare scales |
| Learned features | Task structure | Measure transfer |

## Reproducible protocol

- [x] Define the graph and normalization
- [x] Save the baseline configuration
- [ ] Compare results across random seeds
  - Record the environment
  - Report uncertainty

\`\`\`python
laplacian = identity - d_inv @ adjacency @ d_inv
values, vectors = eigh(laplacian)
embedding = vectors[:, 1:9]
\`\`\`

## Follow the evidence

\`\`\`mermaid
flowchart LR
  Q[Question] --> M[Model]
  M --> E[Experiment]
  E --> R[Review]
  R --> Q
\`\`\`

Compare the assumptions before comparing the metrics.[^protocol] See [[Mathematical notebook]] for another derivation, or cite a source [@spectral2026].

[^protocol]: Record seeds, parameter choices and failed trials alongside the result.

    Keep interpretation separate from measurement.

---

*All people, sources and research here are fictional. Your changes stay in this browser.*
`,
  },
  {
    id: "3f000000-0000-4000-8000-000000000004",
    title: "Mathematical notebook",
    kind: "markdown" as const,
    source: `# Mathematical notebook

## A Gaussian integral

The normalization of the Gaussian appears throughout probability and statistical physics.

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}.
$$

> A useful derivation preserves its assumptions.
>
> $$
> \\left(\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx\\right)^2
> = \\int_0^{2\\pi}\\!\\int_0^{\\infty} e^{-r^2}r\\,dr\\,d\\theta = \\pi.
> $$

## An observation

For a normalized distribution, $\\mathbb{E}[X]=0$ and $\\operatorname{Var}(X)=\\sigma^2$.

1. State the assumptions
   1. Choose the domain
   2. Check convergence
2. Apply the transformation
3. Verify dimensions

[^details]: Try adding several paragraphs to a footnote.

    $$
    Z = \\sum_i e^{-\\beta E_i}
    $$

The complete argument belongs beside its details.[^details]
`,
  },
  {
    id: "3f000000-0000-4000-8000-000000000005",
    title: "Tables & code",
    kind: "markdown" as const,
    source: `# Tables & code

Hover near the right or bottom edge of the table to add a column or row. Right-click a cell for table actions.

| Method | Accuracy | Uncertainty |
| :--- | ---: | ---: |
| Baseline | 0.82 | $\\pm 0.03$ |
| Spectral | 0.87 | $\\pm 0.02$ |

## A reproducible experiment

\`\`\`python
import numpy as np

rng = np.random.default_rng(42)
observations = rng.normal(size=(100, 8))
covariance = np.cov(observations, rowvar=False)
\`\`\`

## A checklist

- [ ] Record the random seed
- [ ] Save hyperparameters
- [ ] Describe limitations

> **Tip:** hover a code block for its controls. Change its language to see syntax highlighting.
`,
  },
  {
    id: "3f000000-0000-4000-8000-000000000006",
    title: "A blank page",
    kind: "markdown" as const,
    source: "# A blank page\n\n",
  },
];
export const sampleCanvas: CanvasData = {
  schemaVersion: 1,
  nodes: [
    {
      id: "question",
      type: "text",
      title: "Research question",
      text: "## What survives a change?\n\nWhich spectral features transfer when the graph changes?\n\nDouble-click to edit this card.",
      x: 0,
      y: 0,
      width: 310,
      height: 310,
      color: "4",
    },
    {
      id: "model",
      type: "text",
      title: "Mathematical model",
      text: "## A representation\n\n$$\nL = I - D^{-1/2} A D^{-1/2}\n$$\n\nKeep the assumptions beside the model.",
      x: 415,
      y: 0,
      width: 330,
      height: 325,
      color: "5",
    },
    {
      id: "evidence",
      type: "text",
      title: "Experiment",
      text: "## Test the prediction\n\n- [x] Save the baseline\n- [ ] Compare random seeds\n- [ ] Measure uncertainty",
      x: 415,
      y: 370,
      width: 330,
      height: 230,
    },
    {
      id: "notebook",
      type: "file",
      title: "Working notebook",
      file: "notes/spectral-graph-methods.md",
      resourceId: researchId,
      x: 0,
      y: 365,
      width: 310,
      height: 280,
    },
  ],
  edges: [
    {
      id: "question-model",
      fromNode: "question",
      toNode: "model",
      fromSide: "right",
      toSide: "left",
      label: "formalize",
      toEnd: "arrow",
    },
    {
      id: "model-evidence",
      fromNode: "model",
      toNode: "evidence",
      fromSide: "bottom",
      toSide: "top",
      label: "test",
      toEnd: "arrow",
    },
    {
      id: "evidence-notebook",
      fromNode: "evidence",
      toNode: "notebook",
      fromSide: "left",
      toSide: "right",
      label: "record",
      toEnd: "arrow",
    },
  ],
};
