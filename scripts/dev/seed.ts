import { auth } from "../../packages/shared/src/auth";
import { query, pool } from "../../packages/shared/src/db";
import { createNote, indexNote } from "../../packages/shared/src/documents";
import { welcomeBody, templates } from "../../packages/shared/src/templates";
if (
  process.env.NODE_ENV === "production" ||
  !["localhost", "127.0.0.1"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw new Error(
    "Demo seeding is restricted to a local development database.",
  );
const email = "researcher@axiom.local",
  password = "AxiomResearch2026!";
if ((await query('SELECT id FROM "user" WHERE email=$1', [email])).length) {
  console.log("Demo already exists; preserving its notes.");
  await pool.end();
  process.exit(0);
}
const { user } = await auth.api.signUpEmail({
  body: { email, name: "Mira Chen", password },
  headers: new Headers({ "x-axiom-internal": process.env.SYNC_SECRET! }),
});
const [group] = await query(
  "INSERT INTO groups(name,description) VALUES($1,$2) RETURNING id",
  [
    "Theory & Learning Lab",
    "An interdisciplinary research workspace for mathematical structure, physical systems, and learning.",
  ],
);
await query(
  "INSERT INTO members(group_id,user_id,role) VALUES($1,$2,'owner')",
  [group.id, user.id],
);
const projects = await Promise.all(
  [
    [
      "Physics & learning",
      "Connecting physical principles and machine learning.",
      "blue",
    ],
    [
      "Mathematical foundations",
      "Definitions, proofs, and useful abstractions.",
      "purple",
    ],
    ["Lab notebook", "Experiments, meetings, and open questions.", "green"],
  ].map(
    async ([name, description, color]) =>
      (
        await query(
          "INSERT INTO projects(group_id,name,description,color) VALUES($1,$2,$3,$4) RETURNING id",
          [group.id, name, description, color],
        )
      )[0].id,
  ),
);
const samples = [
  {
    title: "Variational principles & learning",
    body: welcomeBody,
    projectId: projects[0],
    tags: ["variational methods", "physics", "machine learning"],
  },
  {
    title: "Physics-informed neural networks",
    body: "## Learning with physical constraints\n\nA physics-informed objective combines observations with a differential-equation residual. [@raissi2019]\n\n$$\n\\mathcal{L} = \\mathcal{L}_{data} + \\lambda_r \\mathcal{L}_{residual} + \\lambda_b \\mathcal{L}_{boundary}\n$$\n\n## Open questions\n\n- [ ] How should the loss terms be weighted?\n- [ ] Which boundary conditions are built into the architecture?\n\nConnect this with [[Variational principles & learning]].\n",
    projectId: projects[0],
    tags: ["neural networks", "differential equations"],
  },
  {
    title: "Reading list",
    body: "## On the desk\n\n- [ ] Physics-informed neural networks [@raissi2019]\n- [ ] Attention is all you need [@vaswani2017]\n\n## Reading practice\n\nFor each paper, write the research question, main assumption, and most useful connection. Create a **Paper review** from the template library.\n",
    projectId: projects[0],
    tags: ["papers"],
  },
  {
    title: "Inner products & geometry",
    body: "## Geometry from an inner product\n\n> [!DEFINITION] Inner product\n> A real inner product is a symmetric, positive-definite bilinear form.\n\n$$\n\\langle x,y\\rangle_A = x^{\\mathsf{T}} A y, \\qquad A \\succ 0\n$$\n\nThe induced norm is $\\|x\\|_A = \\sqrt{\\langle x,x\\rangle_A}$.\n\n## A useful connection\n\nThe geometry of parameter space changes the meaning of a steepest-descent step. Explore this alongside [[Variational principles & learning]].\n",
    projectId: projects[1],
    tags: ["linear algebra", "geometry"],
  },
  {
    title: "Weekly research meeting",
    body:
      templates.find((t) => t.id === "meeting")!.body +
      "\n[[Variational principles & learning]] · [[Reading list]]\n",
    projectId: projects[2],
    tags: ["meeting"],
  },
  {
    title: "Ideas worth returning to",
    body: "## A question to keep\n\nWhen can a conservation law become a useful inductive bias?\n\nThis is a private draft. Publish it into a shared project when it is ready for discussion.\n",
    visibility: "private",
    tags: ["ideas"],
  },
];
for (const sample of samples) {
  const n = await createNote({ groupId: group.id, userId: user.id, ...sample });
  await indexNote(`${n.id}:1`, n.body);
}
for (const n of await query("SELECT id,body FROM notes WHERE group_id=$1", [
  group.id,
]))
  await indexNote(`${n.id}:1`, n.body);
await query(
  "INSERT INTO bibliography(group_id,cite_key,title,authors,year,url) VALUES($1,$2,$3,$4,$5,$6),($1,$7,$8,$9,$10,$11)",
  [
    group.id,
    "raissi2019",
    "Physics-informed neural networks: A deep learning framework for solving forward and inverse problems involving nonlinear partial differential equations",
    "M. Raissi, P. Perdikaris, G. E. Karniadakis",
    "2019",
    "https://doi.org/10.1016/j.jcp.2018.10.045",
    "vaswani2017",
    "Attention Is All You Need",
    "A. Vaswani et al.",
    "2017",
    "https://arxiv.org/abs/1706.03762",
  ],
);
console.log(`Local demo ready. Email: ${email}  Password: ${password}`);
await pool.end();
