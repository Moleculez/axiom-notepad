import {
  ArrowRight,
  Braces,
  Network,
  FlaskConical,
  Layers,
  LockKeyhole,
  BookOpen,
  ArrowUpRight,
  CalendarRange,
  Globe,
  Bot,
  ScanText,
} from "lucide-react";
import { useDemo } from "./context";
import { runtimeAsset } from "../../web/lib/runtime-assets";
import { canvasId, researchId } from "./samples";

const capabilities = [
  {
    icon: Braces,
    title: "Write at the speed of thought",
    text: "Canonical Markdown. Live equations, precise tables, syntax-highlighted code, footnotes, citations and Mermaid diagrams.",
    page: "editor" as const,
    action: "Try the editor",
  },
  {
    icon: Network,
    title: "Give ideas a little space",
    text: "Connect rich-text cards and local files on an infinite canvas. Group, name, resize and arrange a research argument.",
    page: "canvas" as const,
    action: "Explore Canvas",
  },
  {
    icon: LockKeyhole,
    title: "Your demo, on your device",
    text: "No sign-up, tracking or cloud sync here. Drafts and uploads save in your browser; export a portable copy whenever you need.",
  },
];
const gallery = [
  {
    file: "research-library",
    title: "A library with context",
    text: "References, reading lists, evidence and a connected knowledge graph.",
    icon: BookOpen,
  },
  {
    file: "planning",
    title: "Turn questions into a plan",
    text: "Workspace tasks, timelines, Gantt charts and collaborative planning.",
    icon: CalendarRange,
  },
  {
    file: "assistant",
    title: "A research copilot",
    text: "Provider-backed assistance with scoped evidence and reviewed changes.",
    icon: Bot,
  },
  {
    file: "docs-playground",
    title: "A workbench that feels like yours",
    text: "Coherent themes, accessible typography and thoughtful editing controls.",
    icon: Layers,
  },
  {
    file: "research",
    title: "Read, annotate, investigate",
    text: "PDF research workflows, provenance and evidence close to your notes.",
    icon: ScanText,
  },
  {
    file: "portfolio",
    title: "One place for the team",
    text: "Shared files, workspace management and a wider productivity toolkit.",
    icon: FlaskConical,
  },
];
export default function Tour() {
  const { dark, navigate } = useDemo();
  return (
    <main className="demo-tour">
      <section className="demo-hero">
        <div className="demo-eyebrow">
          <span />A thinking space for research
        </div>
        <h1>
          From a question
          <br />
          to a clearer <em>idea.</em>
        </h1>
        <p>
          Write with mathematics. Connect your evidence.
          <br />
          Make room for the work that matters.
        </p>
        <div className="demo-hero-actions">
          <button
            className="button"
            onClick={() => navigate("editor", researchId)}
          >
            Start writing <ArrowRight size={16} />
          </button>
          <button
            className="button secondary"
            onClick={() => navigate("canvas", canvasId)}
          >
            <Network size={16} />
            Open Canvas
          </button>
        </div>
        <small>Real Axiom editor and Canvas · no account required</small>
      </section>
      <section
        className="demo-hero-image"
        aria-label="Axiom research workbench"
      >
        <img
          key={String(dark)}
          src={runtimeAsset(`gallery/banner-${dark ? "dark" : "light"}.png`)}
          alt="Axiom’s research notebook, collaborative canvas and planning workspace"
          fetchPriority="high"
        />
        <span className="demo-image-caption">
          One workbench. Many ways to think.
        </span>
      </section>
      <section
        className="demo-capabilities"
        aria-label="Interactive showcase features"
      >
        {capabilities.map(({ icon: Icon, title, text, page, action }) => (
          <article key={title}>
            <Icon size={24} strokeWidth={1.35} />
            <h2>{title}</h2>
            <p>{text}</p>
            {page && (
              <button
                onClick={() =>
                  navigate(page, page === "canvas" ? canvasId : researchId)
                }
              >
                {action}
                <ArrowRight size={14} />
              </button>
            )}
          </article>
        ))}
      </section>
      <section className="demo-editor-invitation">
        <div>
          <span className="demo-eyebrow">A notebook, not a form</span>
          <h2>
            The page stays quiet.
            <br />
            The ideas don’t have to.
          </h2>
          <p>
            Paper-inspired typography, rich Markdown and source editing share
            one document. Make an equation, edit a table or follow a footnote.
            Nothing is simulated.
          </p>
          <button
            className="button secondary"
            onClick={() => navigate("editor", researchId)}
          >
            Try a research notebook <ArrowRight size={15} />
          </button>
        </div>
        <button
          className="demo-screenshot-button"
          onClick={() => navigate("editor", researchId)}
          aria-label="Open the interactive Markdown editor"
        >
          <img
            src={runtimeAsset(`gallery/editor-${dark ? "dark" : "light"}.png`)}
            alt="Axiom editor with mathematics, a table and a research outline"
            loading="lazy"
          />
        </button>
      </section>
      <section className="demo-gallery">
        <header>
          <span className="demo-eyebrow">Beyond the local demo</span>
          <h2>A complete research workbench.</h2>
          <p>
            These are screenshots of the full, self-hosted application—not
            active services in this showcase. All demonstration data is
            fictional.
          </p>
        </header>
        <div>
          {gallery.map(({ file, title, text, icon: Icon }) => (
            <article key={file}>
              <img
                src={runtimeAsset(
                  `gallery/${file}-${dark ? "dark" : "light"}.png`,
                )}
                alt={title}
                loading="lazy"
              />
              <div>
                <Icon size={18} />
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="demo-selfhost">
        <Globe size={28} strokeWidth={1.25} />
        <h2>Bring your own workspace.</h2>
        <p>
          The full application adds accounts, team collaboration, cloud
          synchronization, version history, research libraries, publishing and
          AI integrations. Deploy it on infrastructure you control.
        </p>
        <a
          className="button secondary"
          href="https://github.com/Moleculez/axiom-notepad#deployment"
          target="_blank"
          rel="noopener noreferrer"
        >
          Explore the project <ArrowUpRight size={15} />
        </a>
      </section>
      <footer className="demo-tour-footer">
        <strong>Axiom</strong>
        <span>Built for research, open for exploration.</span>
        <a
          href="https://github.com/Moleculez/axiom-notepad"
          target="_blank"
          rel="noopener noreferrer"
        >
          Source & documentation <ArrowUpRight size={13} />
        </a>
      </footer>
    </main>
  );
}
