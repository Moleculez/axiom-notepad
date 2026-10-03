"use client";
import { Button, SearchField } from "../ui/controls";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, BookOpen, Copy, FlaskConical } from "lucide-react";
import { parseMarkdown } from "@axiom/markdown";
import {
  docArticle,
  docArticles,
  docRoute,
  docSections,
  searchDocumentation,
} from "@axiom/shared/documentation";
import {
  editorCommands,
  keysFor,
  shortcutLabel,
  shortcutPlatform,
} from "@axiom/shared/editor";
import { guideBodies } from "../../content/doc-articles";
import ReadingView from "../ReadingView";
import { useLocation, useWorkspace, WorkspaceLink } from "./ui";
const EditorPlayground = dynamic(() => import("../EditorPlayground"), {
  loading: () => <p role="status">Opening editor…</p>,
  ssr: false,
});
const CanvasPlayground = dynamic(() => import("../tools/CanvasPlayground"), {
  loading: () => <p role="status">Opening Canvas…</p>,
  ssr: false,
});

export default function Documentation() {
  const { parts, hash } = useLocation();
  const { appearance, editorSettings, navigate, notify } = useWorkspace();
  const id = parts.slice(1).join("/"),
    article = docArticle(id),
    body = guideBodies[id];
  const [query, setQuery] = useState(""),
    [playing, setPlaying] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const parsed = useMemo(() => parseMarkdown(body?.markdown ?? ""), [body]);
  const context = useMemo(
    () => ({
      disableImages: true,
      theme: appearance.dark ? ("dark" as const) : ("light" as const),
    }),
    [appearance.dark],
  );
  const results = useMemo(() => {
    if (!query.trim()) return docArticles;
    const metadata = new Set(searchDocumentation(query).map((a) => a.id));
    const words = query.trim().toLowerCase().split(/\s+/);
    return docArticles.filter(
      (a) =>
        metadata.has(a.id) ||
        words.every((w) =>
          guideBodies[a.id]?.markdown.toLowerCase().includes(w),
        ),
    );
  }, [query]);
  useEffect(() => {
    setPlaying(null);
    scroll.current?.scrollTo(0, 0);
  }, [id]);
  useEffect(() => {
    if (!hash) return;
    let target: string;
    try {
      target = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    const frame = requestAnimationFrame(() =>
      scroll.current
        ?.querySelector<HTMLElement>(`[id="${CSS.escape(target)}"]`)
        ?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [hash, id]);
  const activeSection = docSections.find(([section]) => section === parts[1]);
  const next = docArticles[docArticles.findIndex((a) => a.id === id) + 1];
  return (
    <main className="docs-layout" aria-label="Product documentation">
      <aside className="docs-navigation">
        <WorkspaceLink to="/docs" className="docs-brand">
          <BookOpen size={18} /> Axiom guide
        </WorkspaceLink>
        <SearchField
          wrapperClassName="docs-search"
          aria-label="Search documentation"
          placeholder="Find a feature…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          clearLabel="Clear documentation search"
        />
        <nav aria-label="Documentation chapters">
          {docSections.map(([section, title]) => {
            const entries = results.filter((a) => a.section === section);
            return entries.length ? (
              <section key={section}>
                <h2>{title}</h2>
                {entries.map((a) => (
                  <WorkspaceLink
                    key={a.id}
                    to={docRoute(a.id)}
                    aria-current={id === a.id ? "page" : undefined}
                  >
                    {a.title}
                  </WorkspaceLink>
                ))}
              </section>
            ) : null;
          })}
          {!results.length && (
            <p className="muted" role="status">
              No guides match. Try “math”, “PDF” or “sharing”.
            </p>
          )}
        </nav>
      </aside>
      <div className="docs-scroll" ref={scroll}>
        {article && body ? (
          <article className="docs-article" key={id}>
            <header>
              <span className="docs-eyebrow">{activeSection?.[1]}</span>
              <h1>{article.title}</h1>
              <p>{article.summary}</p>
              <Button
                className="button ghost docs-copy"
                onClick={() =>
                  void navigator.clipboard.writeText(location.href).then(
                    () => notify("Guide link copied."),
                    () => notify("Could not access the clipboard."),
                  )
                }
              >
                <Copy size={14} />
                Copy link
              </Button>
            </header>
            <ReadingView
              parsed={parsed}
              context={context}
              source={body.markdown}
              onLink={(target) => {
                if (target.startsWith("#")) navigate(docRoute(id) + target);
                else if (target.startsWith("/docs")) navigate(target);
                else if (/^https?:\/\//.test(target))
                  window.open(target, "_blank", "noopener,noreferrer");
              }}
            />
            {id === "editor/shortcuts" && (
              <div className="docs-command-list">
                {editorCommands.map((command) => (
                  <div key={command.id}>
                    <span>
                      {command.label}
                      <small>{command.category}</small>
                    </span>
                    <span>
                      {keysFor(
                        command.id,
                        editorSettings.effective,
                        shortcutPlatform(),
                      ).map((key) => (
                        <kbd key={key}>
                          {shortcutLabel(key, shortcutPlatform())}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {article.playground && (
              <section
                className={`docs-playground ${article.playground === "canvas" ? "docs-playground-canvas" : ""}`}
                aria-label="Interactive example"
              >
                <div className="docs-playground-heading">
                  <div>
                    <h2>
                      <FlaskConical size={18} />
                      Try this feature
                    </h2>
                    <p>
                      Temporary sample · no files, uploads or cloud connection.
                    </p>
                  </div>
                  <Button
                    className="button secondary"
                    onClick={() => setPlaying(playing === id ? null : id)}
                  >
                    {playing === id ? "Close example" : "Open example"}
                  </Button>
                </div>
                {playing === id &&
                  (article.playground === "canvas" ? (
                    <CanvasPlayground />
                  ) : (
                    <EditorPlayground
                      preferences={editorSettings.effective}
                      appearance={appearance.effective}
                      category={article.title}
                      sample={body.sample}
                    />
                  ))}
              </section>
            )}
            <footer className="docs-next">
              {next && (
                <WorkspaceLink to={docRoute(next.id)}>
                  Next: {next.title}
                  <ArrowRight size={16} />
                </WorkspaceLink>
              )}
            </footer>
          </article>
        ) : (
          <article className="docs-article docs-home">
            <span className="docs-eyebrow">The Axiom handbook</span>
            <h1>
              {activeSection?.[1] ??
                (id ? "Guide not found" : "A place for thoughtful work.")}
            </h1>
            <p>
              {id && !activeSection
                ? "This guide may have moved. Choose a chapter on the left."
                : "Learn the editor, connect evidence, and work together. Real examples, without changing your files."}
            </p>
            <div className="docs-guide-grid">
              {results
                .filter((a) => !activeSection || a.section === activeSection[0])
                .map((a) => (
                  <WorkspaceLink key={a.id} to={docRoute(a.id)}>
                    <span className="docs-eyebrow">
                      {docSections.find(([s]) => s === a.section)?.[1]}
                    </span>
                    <h2>{a.title}</h2>
                    <p>{a.summary}</p>
                    <ArrowRight size={16} />
                  </WorkspaceLink>
                ))}
            </div>
          </article>
        )}
      </div>
      {article && (
        <nav className="docs-toc" aria-label="On this page">
          <strong>On this page</strong>
          {parsed.outline.map((h) => (
            <WorkspaceLink key={h.id} to={docRoute(id) + `#${h.id}`}>
              {h.text}
            </WorkspaceLink>
          ))}
        </nav>
      )}
    </main>
  );
}
