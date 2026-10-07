"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Braces,
  ExternalLink,
  FileText,
  Sigma,
  Link2,
  Image,
} from "lucide-react";
import {
  parseMarkdownFragment,
  type ParsedDocument,
  type RenderContext,
} from "@axiom/markdown";
import {
  mindmapBranchIds,
  mindmapBranchEvidence,
  mindmapTaskChecked,
  type MindmapNode,
  type MindmapProjection,
  type MindmapResearchIndex,
} from "@axiom/mindmap";
import ReadingView from "../ReadingView";
import {
  Button,
  IconButton,
  HelpText,
  ActionRow,
  Checkbox,
} from "../ui/controls";

export type MindmapDetailTab = "block" | "evidence" | "tasks";

/** One auxiliary owner. All actions use canonical map ranges, never fragment
 * offsets or derived research cards, and previews do not grant edit access. */
export default function MindmapDetails({
  node,
  projection,
  research,
  source,
  liveSource,
  context,
  document,
  readOnly,
  tab,
  onTab: setTab,
  onLink,
  onNavigate,
  onSource,
  onDocument,
  onToggleTask,
  onVisual,
}: {
  node: MindmapNode;
  projection: MindmapProjection;
  research: MindmapResearchIndex;
  source: string;
  liveSource: string;
  context: RenderContext;
  document: ParsedDocument;
  readOnly: boolean;
  tab: MindmapDetailTab;
  onTab: (tab: MindmapDetailTab) => void;
  onLink: (target: string) => void;
  onNavigate: (from: number) => void;
  onSource: (from: number, to: number) => void;
  onDocument?: (from: number) => void;
  onToggleTask: (node: MindmapNode) => void;
  onVisual?: (node: MindmapNode) => void;
}) {
  const [limit, setLimit] = useState(40);
  const tabs = useRef<HTMLDivElement>(null),
    id = useId();
  const facts = useMemo(() => {
    const ids = mindmapBranchIds(projection, node.id);
    const tasks = projection.nodes.filter(
      (n) => ids.has(n.id) && n.checked !== undefined,
    );
    return {
      tasks,
      evidence: mindmapBranchEvidence(projection, research, node),
      count: ids.size,
    };
  }, [projection, research, node]);
  const body = source.slice(node.from, node.branchTo);
  const parsed = useMemo(
    () => parseMarkdownFragment(body, document),
    [body, document],
  );
  const readingContext = useMemo(
    () => ({ ...context, document, fragment: true }),
    [context, document],
  );
  const [fromLine, toLine] = useMemo(
    () => [
      source.slice(0, node.from).split("\n").length,
      source.slice(0, node.branchTo).split("\n").length,
    ],
    [source, node.from, node.branchTo],
  );
  const footnoteDocuments = useMemo(
    () =>
      new Map(
        Object.entries(document.footnotes).map(([key, footnote]) => [
          key,
          {
            ...document,
            definitions: [],
            ast: { ...document.ast, children: footnote },
          },
        ]),
      ),
    [document],
  );
  useEffect(() => setLimit(40), [node.id, tab]);
  const choices: { id: MindmapDetailTab; label: string; count?: number }[] = [
    { id: "block", label: "Block" },
    { id: "evidence", label: "Evidence", count: facts.evidence.length },
    { id: "tasks", label: "Tasks", count: facts.tasks.length },
  ];
  const icon = (kind: string) =>
    kind === "note" ? (
      <FileText size={16} />
    ) : kind === "citation" || kind === "footnote" ? (
      <BookOpen size={16} />
    ) : kind === "equation" ? (
      <Sigma size={16} />
    ) : (
      <Link2 size={16} />
    );
  return (
    <>
      <div className="mindmap-detail-summary">
        <HelpText as="span">
          Lines {fromLine}–{toLine} · {facts.count} nodes
        </HelpText>
        {facts.tasks.length > 0 && (
          <HelpText as="span">
            {
              facts.tasks.filter((n) => mindmapTaskChecked(n, liveSource))
                .length
            }
            /{facts.tasks.length} tasks complete
          </HelpText>
        )}
      </div>
      <div
        className="mindmap-detail-tabs"
        ref={tabs}
        role="tablist"
        aria-label="Branch research"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const at = choices.findIndex((choice) => choice.id === tab);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? 2
                : (at + (event.key === "ArrowRight" ? 1 : -1) + 3) % 3;
          setTab(choices[next].id);
          tabs.current
            ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
            [next]?.focus();
        }}
      >
        {choices.map((choice) => (
          <Button
            key={choice.id}
            id={`${id}-tab-${choice.id}`}
            role="tab"
            variant="ghost"
            aria-selected={tab === choice.id}
            aria-controls={`${id}-panel-${choice.id}`}
            tabIndex={tab === choice.id ? 0 : -1}
            onClick={() => setTab(choice.id)}
          >
            {choice.label}
            {choice.count !== undefined && (
              <span className="mindmap-detail-count">{choice.count}</span>
            )}
          </Button>
        ))}
      </div>
      <div
        className="mindmap-detail-content"
        role="tabpanel"
        id={`${id}-panel-${tab}`}
        aria-labelledby={`${id}-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "block" && (
          <>
            <ReadingView
              parsed={parsed}
              source={body}
              context={readingContext}
              onLink={onLink}
              onInternalAnchor={onLink}
            />
            <ActionRow className="mindmap-detail-actions">
              <Button
                onClick={() => onSource(node.from, node.to)}
                disabled={!node.to}
              >
                <Braces size={16} />
                {readOnly ? "View source" : "Edit in Source"}
              </Button>
              {onDocument && (
                <Button onClick={() => onDocument(node.from)}>
                  <FileText size={16} />
                  Open document
                </Button>
              )}
              {onVisual && (
                <Button onClick={() => onVisual(node)}>
                  <Image size={16} />
                  Inspect visual
                </Button>
              )}
            </ActionRow>
          </>
        )}
        {tab === "evidence" && (
          <>
            {!facts.evidence.length && (
              <HelpText>
                No linked evidence in this branch. Link a note, cite a
                reference, or add a footnote or equation reference in Markdown.
              </HelpText>
            )}
            <ul className="mindmap-evidence-list">
              {facts.evidence.slice(0, limit).map((item) => {
                const reference =
                  item.kind === "citation"
                    ? context.references?.[item.target]
                    : undefined;
                const resolved =
                  item.kind === "note"
                    ? context.resolveLink?.(item.target)
                    : undefined;
                const footnote =
                  item.kind === "footnote"
                    ? document.footnotes[item.target]
                    : undefined;
                const title = reference?.title ?? resolved?.title ?? item.label;
                const open =
                  item.kind === "note" ||
                  item.kind === "link" ||
                  (item.kind === "citation" && reference?.url);
                return (
                  <li
                    className="mindmap-evidence-item"
                    key={`${item.kind}:${item.target}`}
                  >
                    <div className="mindmap-research-row">
                      <span
                        className="mindmap-evidence-icon"
                        aria-hidden="true"
                      >
                        {icon(item.kind)}
                      </span>
                      <div className="mindmap-evidence-text">
                        <span>{title}</span>
                        <HelpText>
                          {item.kind === "citation"
                            ? [
                                reference?.authors,
                                reference?.year,
                                "@" + item.target,
                              ]
                                .filter(Boolean)
                                .join(" · ")
                            : item.kind === "note"
                              ? resolved
                                ? "Linked note"
                                : "Unresolved note · " + item.target
                              : item.kind === "link"
                                ? item.target
                                : item.kind === "equation" &&
                                    item.targetFrom === undefined
                                  ? "Unresolved equation"
                                  : item.kind === "footnote" && !footnote
                                    ? "Unresolved footnote"
                                    : item.kind}
                        </HelpText>
                      </div>
                      {open && (
                        <IconButton
                          label={`Open ${title}`}
                          onClick={() => onLink(reference?.url ?? item.target)}
                        >
                          <ExternalLink size={16} />
                        </IconButton>
                      )}
                      {item.kind === "equation" &&
                        item.targetFrom !== undefined && (
                          <IconButton
                            label={`Go to ${title}`}
                            onClick={() => onNavigate(item.targetFrom!)}
                          >
                            <Sigma size={16} />
                          </IconButton>
                        )}
                      <IconButton
                        label={`Reveal ${title} in Source`}
                        onClick={() => onSource(item.from, item.to)}
                      >
                        <Braces size={16} />
                      </IconButton>
                    </div>
                    {footnote && (
                      <div className="mindmap-footnote-evidence">
                        <ReadingView
                          parsed={footnoteDocuments.get(item.target)!}
                          source={source}
                          context={readingContext}
                          onLink={onLink}
                          onInternalAnchor={onLink}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {facts.evidence.length > limit && (
              <Button onClick={() => setLimit((n) => n + 40)}>
                Show more evidence
              </Button>
            )}
          </>
        )}
        {tab === "tasks" && (
          <>
            {!facts.tasks.length && (
              <HelpText>
                No tasks in this branch. Add a Markdown task item to track
                research work.
              </HelpText>
            )}
            <ul className="mindmap-task-list">
              {facts.tasks.slice(0, limit).map((task) => (
                <li className="mindmap-task-row" key={task.id}>
                  <Checkbox
                    aria-label={`${mindmapTaskChecked(task, liveSource) ? "Reopen" : "Complete"} task ${task.label}`}
                    disabled={readOnly}
                    checked={mindmapTaskChecked(task, liveSource)}
                    onChange={() => onToggleTask(task)}
                  />
                  <Button
                    variant="ghost"
                    onClick={() => onNavigate(task.from)}
                    className="mindmap-task-title"
                  >
                    {task.label}
                  </Button>
                  <HelpText as="span">
                    {mindmapTaskChecked(task, liveSource) ? "Complete" : "Open"}
                  </HelpText>
                </li>
              ))}
            </ul>
            {facts.tasks.length > limit && (
              <Button onClick={() => setLimit((n) => n + 40)}>
                Show more tasks
              </Button>
            )}
          </>
        )}
      </div>
    </>
  );
}
