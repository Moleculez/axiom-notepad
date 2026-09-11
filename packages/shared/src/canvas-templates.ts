export const canvasTemplates = [
  {
    id: "question",
    title: "Research question",
    text: "## Question\n\nWhat do we want to understand?\n\n### Why it matters\n\n### Next step\n\n- [ ] Identify the key assumption\n",
  },
  {
    id: "hypothesis",
    title: "Hypothesis",
    text: "## Hypothesis\n\nWe expect…\n\n### Prediction\n\n### How to falsify it\n\n### Evidence needed\n",
  },
  {
    id: "evidence",
    title: "Evidence",
    text: "## Observation\n\n### Source\n\n### Interpretation\n\n### Limitations\n",
  },
  {
    id: "derivation",
    title: "Derivation",
    text: "## Derivation\n\n### Assumptions\n\n$$\nE = mc^2\n$$\n\n### Steps\n\n1. State the model\n2. Apply the constraints\n3. Check dimensions\n\n### Result\n",
  },
  {
    id: "experiment",
    title: "Experiment",
    text: "## Experiment\n\n### Objective\n\n| Variable | Value |\n| --- | --- |\n| Seed | |\n| Baseline | |\n\n### Checklist\n\n- [ ] Record environment\n- [ ] Run baseline\n- [ ] Compare results\n\n### Findings\n",
  },
  {
    id: "paper",
    title: "Paper notes",
    text: "## Paper notes\n\n**Citation:**\n\n### Main claim\n\n### Method\n\n### Evidence\n\n### Limitations\n\n### Connections to our work\n",
  },
] as const;
