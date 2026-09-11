export const templates = [
  {
    id: "blank",
    name: "Blank note",
    description: "A clear page for a new idea.",
    icon: "file",
    body: "",
  },
  {
    id: "paper",
    name: "Paper review",
    description: "Read closely. Connect the ideas.",
    icon: "book",
    body: "## At a glance\n\n**Paper:** \n**Authors:** \n**Research question:** \n\n## Main contribution\n\nWhat changes because of this work?\n\n## Method\n\nDescribe the assumptions, model, and evidence.\n\n## Key equations\n\n$$\n\\mathcal{L}(\\theta) = \\mathbb{E}_{x \\sim p(x)}[\\ell(x; \\theta)]\n$$\n\n## Critical reading\n\n> [!NOTE] Assumptions to revisit\n> Record the conditions under which the claims hold.\n\n## Connections\n\nLink related work with [[note links]].\n\n## Next steps\n\n- [ ] Reproduce a key result\n- [ ] Discuss open questions with the group\n",
  },
  {
    id: "derivation",
    name: "Mathematical derivation",
    description: "From assumptions to a result.",
    icon: "math",
    body: "## Problem statement\n\nState the result to establish.\n\n## Definitions and assumptions\n\n> [!DEFINITION]\n> Define the objects and notation used below.\n\n## Derivation\n\n$$\n\\begin{aligned}\nf(x + h) &= f(x) + h f^{\\prime}(x) + O(h^2)\n\\end{aligned}\n$$\n\n> [!PROOF]\n> Work through each step and justify the transitions.\n\n## Checks and limiting cases\n\n- [ ] Check dimensions\n- [ ] Check boundary conditions\n- [ ] Compare a known special case\n\n## Interpretation\n\nExplain what the result means.\n",
  },
  {
    id: "experiment",
    name: "Experiment log",
    description: "Keep methods and evidence together.",
    icon: "flask",
    body: "## Research question\n\n## Hypothesis\n\n## Setup\n\n| Parameter | Value | Rationale |\n| --- | --- | --- |\n| Random seed | 42 | Reproducibility |\n| Dataset | | |\n| Baseline | | |\n\n## Procedure\n\n```python\nimport numpy as np\nrng = np.random.default_rng(42)\n```\n\n## Observations\n\nRecord observations and attach figures or source data.\n\n## Interpretation\n\nSeparate evidence from explanation.\n\n## Next iteration\n\n- [ ] Verify the baseline\n- [ ] Record environment and dependencies\n",
  },
  {
    id: "proposal",
    name: "Research proposal",
    description: "Turn a promising question into a project.",
    icon: "spark",
    body: "## Motivation\n\n## Research question\n\n## Related work\n\n## Proposed approach\n\n```mermaid\nflowchart LR\n  A[Question] --> B[Model]\n  B --> C[Experiment]\n  C --> D[Evaluation]\n```\n\n## Evaluation criteria\n\n## Risks and alternatives\n\n## Milestones\n\n- [ ] Literature review\n- [ ] First working baseline\n- [ ] Evaluation and group review\n",
  },
  {
    id: "meeting",
    name: "Group meeting",
    description: "Decisions, discussion, and follow-through.",
    icon: "users",
    body: "## Agenda\n\n1. Progress since the last meeting\n2. Open questions\n3. Next experiments\n\n## Discussion\n\n## Decisions\n\n> [!NOTE] Decision log\n> Record the decision and the reasoning behind it.\n\n## Action items\n\n- [ ] Assign an owner and a date\n\n## Related notes\n\n",
  },
];
export const welcomeBody = `> [!NOTE] Working research note
> A shared place to connect mathematical structure with machine learning. This is an illustrative notebook, ready for your group's own work.

## The central idea

Many problems in physics and machine learning can be understood through a single question: **which configuration minimizes an objective?** Variational methods give us a common language for exploring that question.

The principle of stationary action provides a useful starting point. For a trajectory $q(t)$, define the action

$$
S[q] = \\int_{t_0}^{t_1} L(q, \\dot{q}, t)\\,dt \\label{action}
$$

We seek paths for which the first variation vanishes: $\\delta S = 0$.

## From action to dynamics

> [!THEOREM] Euler–Lagrange equation
> For a differentiable Lagrangian and fixed endpoints, stationary paths satisfy the Euler–Lagrange equation.

$$
\\frac{d}{dt}\\left(\\frac{\\partial L}{\\partial \\dot{q}}\\right) - \\frac{\\partial L}{\\partial q} = 0
$$

The boundary condition matters: the perturbation must vanish at the endpoints. This is a useful habit to carry into optimization—always make the admissible set explicit.

## A bridge to learning

| Physical system | Learning analogue | Shared structure |
| :--- | :--- | :--- |
| Action functional | Loss functional | An objective over functions |
| Admissible trajectory | Model hypothesis class | A constrained search space |
| Stationary action | First-order optimality | A vanishing variation |

This analogy motivates [[Physics-informed neural networks]], but it does not establish equivalence between every learning problem and a physical system. Keep the assumptions visible. [@raissi2019]

### A small numerical check

\`\`\`python
import numpy as np

def harmonic_action(q, t, mass=1.0, omega=1.0):
    velocity = np.gradient(q, t)
    lagrangian = 0.5 * mass * (velocity**2 - omega**2 * q**2)
    return np.trapezoid(lagrangian, t)
\`\`\`

## Questions for the group

- [ ] Compare strong and weak formulations of the residual
- [ ] Explore the role of boundary conditions
- [x] Write down the assumptions behind the analogy

See also [[Reading list]] and [[Weekly research meeting]].
`;
